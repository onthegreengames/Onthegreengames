'use strict';

// netlify/functions/send-balance-reminders.js
//
// OTGG balance reminder + overdue cancellation job.
// Designed to be called once per day by Supabase Cron.
// Package-free: uses native fetch.
//
// Required Netlify environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   RESEND_FROM_NAME
//   BALANCE_REMINDER_CRON_SECRET
//
// Optional:
//   SITE_URL
//
// Current reminder journey (selected by Supabase):
//   1) 60 days after booking creation, where applicable
//   2) 30 days before the balance due date (= 60 days before event)
//   3) on the balance due date (= 30 days before event)
//   4) one day overdue
//
// The database owns all timing rules. This function only sends the email
// type returned by public.get_due_balance_reminders().

const crypto = require('crypto');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLAIM_RETRY_MS = 5 * 60 * 1000;
const CANCEL_RECOVERY_DAYS = 30;

const REMINDER_TYPES = new Set([
  'balance_reminder_60d_after_booking',
  'balance_reminder_30d_before_due',
  'balance_due_today',
  'balance_overdue_1d'
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function cfg() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
  const fromName = String(
    process.env.RESEND_FROM_NAME || 'On The Green Games'
  ).trim();

  const cronSecret = String(
    process.env.BALANCE_REMINDER_CRON_SECRET || ''
  ).trim();

  const siteUrl = String(
    process.env.SITE_URL || 'https://onthegreengames.co.uk'
  )
    .trim()
    .replace(/\/$/, '');

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase server configuration.');
  }
  if (!resendApiKey) throw new Error('Missing RESEND_API_KEY.');
  if (!fromEmail) throw new Error('Missing RESEND_FROM_EMAIL.');
  if (!cronSecret) throw new Error('Missing BALANCE_REMINDER_CRON_SECRET.');

  return {
    supabaseUrl,
    serviceKey,
    resendApiKey,
    fromEmail,
    fromName,
    cronSecret,
    siteUrl
  };
}

function header(event, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (key.toLowerCase() === wanted) return String(value || '');
  }
  return '';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorize(event) {
  const auth = header(event, 'authorization');
  const supplied = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : header(event, 'x-otgg-cron-secret').trim();

  if (!supplied || !safeEqual(supplied, cfg().cronSecret)) {
    const error = new Error('Unauthorized.');
    error.statusCode = 401;
    throw error;
  }
}

function parseBody(event) {
  if (!event.body) return {};

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw);
  } catch {
    const error = new Error('Request body is not valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  }).format(Number.isFinite(number) ? number : 0);
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');

  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  ));

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function addDays(value, days) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days
  ));

  return date.toISOString().slice(0, 10);
}

async function sb(path, options = {}) {
  const { supabaseUrl, serviceKey } = cfg();

  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {})
  });

  const raw = await result.text();
  let data = null;

  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = raw; }
  }

  if (!result.ok) {
    const error = new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      `Supabase request failed (${result.status}).`
    );
    error.statusCode = result.status >= 500 ? 502 : result.status;
    error.supabaseCode = data?.code;
    throw error;
  }

  return data;
}

function rpc(name, body = {}) {
  return sb(`rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    body
  });
}

async function one(path, message) {
  const rows = await sb(path);
  if (!Array.isArray(rows) || !rows.length) throw new Error(message);
  return rows[0];
}

async function loadBooking(bookingId) {
  const booking = await one(
    `bookings?id=eq.${encodeURIComponent(bookingId)}` +
    '&select=id,booking_reference,customer_id,event_date,status,total_price,balance_due_date,balance_payment_token,balance_cancelled_at' +
    '&limit=1',
    'Booking not found.'
  );

  const customer = await one(
    `customers?id=eq.${encodeURIComponent(booking.customer_id)}` +
    '&select=id,first_name,last_name,email&limit=1',
    'Customer not found.'
  );

  const payments = await sb(
    `payments?booking_id=eq.${encodeURIComponent(booking.id)}` +
    '&payment_status=eq.paid' +
    '&select=payment_type,amount'
  );

  const totalPaid = (Array.isArray(payments) ? payments : [])
    .filter(payment => ['deposit', 'balance', 'full'].includes(payment.payment_type))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const remainingBalance = Math.max(
    0,
    Math.round((Number(booking.total_price || 0) - totalPaid) * 100) / 100
  );

  return {
    booking,
    customer,
    totalPaid,
    remainingBalance
  };
}

function validEmail(value) {
  return /^\S+@\S+\.\S+$/.test(String(value || '').trim());
}

function paymentUrl(data) {
  const token = data?.booking?.balance_payment_token;
  if (!token) return null;

  return (
    `${cfg().siteUrl}/pay-balance.html?token=` +
    encodeURIComponent(token)
  );
}

function paymentSummary(data) {
  return `
<div style="border:1px solid #e5ded0;border-radius:12px;padding:20px;margin-top:22px;">
  <div style="font-size:18px;font-weight:700;margin-bottom:12px;">Payment summary</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
    <tr>
      <td style="padding:5px 0;color:#667269;">Total booking price</td>
      <td style="padding:5px 0;text-align:right;font-weight:700;">${money(data.booking.total_price)}</td>
    </tr>
    <tr>
      <td style="padding:5px 0;color:#667269;">Paid so far</td>
      <td style="padding:5px 0;text-align:right;font-weight:700;">${money(data.totalPaid)}</td>
    </tr>
    <tr>
      <td style="padding:5px 0;color:#667269;">Remaining balance</td>
      <td style="padding:5px 0;text-align:right;font-weight:700;">${money(data.remainingBalance)}</td>
    </tr>
    <tr>
      <td style="padding:5px 0;color:#667269;">Balance due</td>
      <td style="padding:5px 0;text-align:right;font-weight:700;">${esc(formatDate(data.booking.balance_due_date))}</td>
    </tr>
  </table>
</div>`;
}

function button(url, label, note = '') {
  return `
<div style="text-align:center;margin-top:24px;">
  <a href="${esc(url)}" style="display:inline-block;background:#c0913c;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:9px;">
    ${esc(label)}
  </a>
  ${note ? `<div style="font-size:12px;color:#788078;margin-top:10px;">${esc(note)}</div>` : ''}
</div>`;
}

function shell({ title, eyebrow, intro, data, body = '', action = '', footer = '' }) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,Helvetica,sans-serif;color:#1b2a20;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e5ded0;border-radius:16px;overflow:hidden;">
<tr><td style="background:#173b2b;padding:26px 30px;color:#fff;">
  <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#d3ad62;font-weight:700;">On The Green Games</div>
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.18;margin-top:8px;">${esc(title)}</div>
</td></tr>
<tr><td style="padding:30px;">
  <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#9b7430;font-weight:700;margin-bottom:8px;">${esc(eyebrow)}</div>
  <p style="margin:0 0 18px;font-size:16px;line-height:1.65;">Hi ${esc(data.customer.first_name)},</p>
  <div style="font-size:16px;line-height:1.65;margin-bottom:24px;">${intro}</div>

  <div style="background:#f7f4ec;border-radius:12px;padding:20px;margin-bottom:22px;">
    <div style="font-size:18px;font-weight:700;margin-bottom:12px;">Your booking</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
      <tr>
        <td style="padding:5px 0;color:#667269;">Booking reference</td>
        <td style="padding:5px 0;text-align:right;font-weight:700;">${esc(data.booking.booking_reference)}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;color:#667269;">Wedding date</td>
        <td style="padding:5px 0;text-align:right;font-weight:700;">${esc(formatDate(data.booking.event_date))}</td>
      </tr>
    </table>
  </div>

  ${body}
  ${action}

  <p style="margin:28px 0 0;font-size:14px;line-height:1.65;color:#667269;">
    ${footer || 'If you need to contact us, simply reply to this email.'}
  </p>
</td></tr>
<tr><td style="background:#173b2b;padding:20px 30px;text-align:center;color:#dfe8e2;font-size:12px;line-height:1.6;">
  On The Green Games · Wedding mini golf &amp; giant games
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function reminderEmail(type, data) {
  const url = paymentUrl(data);
  if (!url) throw new Error('The booking does not have a balance payment token.');

  const due = formatDate(data.booking.balance_due_date);
  const graceEnd = formatDate(addDays(data.booking.balance_due_date, 3));
  const ref = data.booking.booking_reference;
  const amount = money(data.remainingBalance);

  const definitions = {
    balance_reminder_60d_after_booking: {
      emailType: 'balance_reminder_60d_after_booking_v2',
      dedupeKey: `balance-reminder-60d-after-booking-v2/${data.booking.id}/${data.booking.balance_due_date}`,
      subject: `A reminder about your wedding balance — ${ref}`,
      title: 'A quick balance reminder',
      eyebrow: 'Your wedding booking',
      intro: `Just a quick reminder that your remaining balance is <strong>${amount}</strong>. It is due on <strong>${esc(due)}</strong>, 30 days before your wedding. You can pay early at any time using the secure button below.`,
      note: `Your balance is due on ${due}.`
    },

    balance_reminder_30d_before_due: {
      emailType: 'balance_reminder_30d_before_due_v2',
      dedupeKey: `balance-reminder-30d-before-due-v2/${data.booking.id}/${data.booking.balance_due_date}`,
      subject: `Your wedding balance is due in 30 days — ${ref}`,
      title: 'Your balance is due in 30 days',
      eyebrow: 'Payment reminder',
      intro: `Your remaining balance of <strong>${amount}</strong> is due on <strong>${esc(due)}</strong>. Please use the secure payment button below when you're ready.`,
      note: `Your balance is due on ${due}.`
    },

    balance_due_today: {
      emailType: 'balance_due_today_v2',
      dedupeKey: `balance-due-today-v2/${data.booking.id}/${data.booking.balance_due_date}`,
      subject: `Your wedding balance is due today — ${ref}`,
      title: 'Your balance is due today',
      eyebrow: 'Payment due',
      intro: `Your remaining balance of <strong>${amount}</strong> is due today. Please make payment using the secure button below.`,
      warning: 'If payment is not received today, your booking will enter a three-day grace period. If the balance remains unpaid after that grace period, the booking will be cancelled and the wedding date released.'
    },

    balance_overdue_1d: {
      emailType: 'balance_overdue_1d_v2',
      dedupeKey: `balance-overdue-1d-v2/${data.booking.id}/${data.booking.balance_due_date}`,
      subject: `Action needed: your wedding balance is overdue — ${ref}`,
      title: 'Your balance is overdue',
      eyebrow: 'Action needed',
      intro: `We haven't yet received your remaining balance of <strong>${amount}</strong>. Your wedding date is still reserved during the grace period, but payment is now overdue.`,
      warning: `Please pay by <strong>${esc(graceEnd)}</strong> to keep your booking. If the balance remains unpaid after that date, the booking will be cancelled automatically and your wedding date will become available to other customers.`,
      buttonLabel: `Pay overdue balance — ${amount}`
    }
  };

  const definition = definitions[type];
  if (!definition) throw new Error(`Unsupported reminder type: ${type}`);

  const warning = definition.warning
    ? `<div style="margin-top:18px;background:#fff1ec;border:1px solid #e8c0b1;border-radius:12px;padding:16px;font-size:14px;line-height:1.6;">${definition.warning}</div>`
    : '';

  return {
    emailType: definition.emailType,
    dedupeKey: definition.dedupeKey,
    subject: definition.subject,
    html: shell({
      title: definition.title,
      eyebrow: definition.eyebrow,
      intro: definition.intro,
      data,
      body: paymentSummary(data) + warning,
      action: button(
        url,
        definition.buttonLabel || `Pay ${amount} now`,
        definition.note || ''
      )
    })
  };
}

function cancellationEmail(data) {
  const ref = data.booking.booking_reference;

  return {
    emailType: 'balance_overdue_cancelled_v2',
    dedupeKey: `balance-overdue-cancelled-v2/${data.booking.id}/${data.booking.balance_due_date}`,
    subject: `Your On The Green Games booking has been cancelled — ${ref}`,
    html: shell({
      title: 'Your booking has been cancelled',
      eyebrow: 'Booking cancelled',
      intro: `We did not receive the remaining balance by the end of the payment grace period, so booking <strong>${esc(ref)}</strong> has now been cancelled and the wedding date has been released.`,
      data,
      body: `
<div style="background:#fff1ec;border:1px solid #e8c0b1;border-radius:12px;padding:18px;font-size:14px;line-height:1.65;">
  The secure balance-payment link for this booking is no longer active.
  If you believe this cancellation is a mistake or you would still like to book with us, reply to this email and we can check whether your date is still available.
</div>`,
      footer: 'If you believe this cancellation is a mistake, reply to this email and we will look into it.'
    })
  };
}

async function getDelivery(dedupeKey) {
  const rows = await sb(
    `email_deliveries?dedupe_key=eq.${encodeURIComponent(dedupeKey)}` +
    '&select=id,status,attempts,last_attempt_at,provider_email_id&limit=1'
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function claim({ bookingId, emailType, dedupeKey, recipientEmail }) {
  try {
    const rows = await sb('email_deliveries', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        booking_id: bookingId,
        payment_id: null,
        email_type: emailType,
        dedupe_key: dedupeKey,
        recipient_email: recipientEmail,
        provider: 'resend',
        status: 'pending',
        attempts: 1,
        last_attempt_at: new Date().toISOString()
      }
    });

    return { claimed: true, delivery: rows[0] };
  } catch (error) {
    if (error.supabaseCode !== '23505' && error.statusCode !== 409) {
      throw error;
    }
  }

  const existing = await getDelivery(dedupeKey);
  if (!existing) {
    throw new Error('Could not load existing email delivery after dedupe conflict.');
  }

  if (existing.status === 'sent') {
    return { claimed: false, delivery: existing };
  }

  if (existing.status === 'pending' && existing.last_attempt_at) {
    const lastAttempt = new Date(existing.last_attempt_at).getTime();
    if (Date.now() - lastAttempt < CLAIM_RETRY_MS) {
      return { claimed: false, delivery: existing };
    }
  }

  const rows = await sb(
    `email_deliveries?id=eq.${encodeURIComponent(existing.id)}`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'pending',
        attempts: Number(existing.attempts || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: null
      }
    }
  );

  return { claimed: true, delivery: rows[0] };
}

async function markSent(deliveryId, resendId) {
  await sb(`email_deliveries?id=eq.${encodeURIComponent(deliveryId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      status: 'sent',
      provider_email_id: resendId,
      sent_at: new Date().toISOString(),
      last_error: null
    }
  });
}

async function markFailed(deliveryId, error) {
  if (!deliveryId) return;

  try {
    await sb(`email_deliveries?id=eq.${encodeURIComponent(deliveryId)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        status: 'failed',
        last_error: String(error?.message || error || 'Unknown error').slice(0, 3000)
      }
    });
  } catch (loggingError) {
    console.error('Could not log failed email delivery', loggingError.message);
  }
}

async function sendEmail({ to, subject, html, dedupeKey }) {
  const { resendApiKey, fromEmail, fromName } = cfg();

  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': dedupeKey
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      reply_to: fromEmail,
      subject,
      html
    })
  });

  const raw = await result.text();
  let data = null;

  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = raw; }

  if (!result.ok) {
    const error = new Error(
      data?.message ||
      data?.error?.message ||
      `Resend rejected the email (${result.status}).`
    );
    error.statusCode = (result.status >= 500 || result.status === 429) ? 503 : 500;
    throw error;
  }

  if (!data?.id) throw new Error('Resend did not return an email ID.');
  return data;
}

async function sendTracked(data, email) {
  const recipient = String(data.customer.email || '').trim().toLowerCase();
  if (!validEmail(recipient)) {
    throw new Error('The customer does not have a valid email address.');
  }

  const deliveryClaim = await claim({
    bookingId: data.booking.id,
    emailType: email.emailType,
    dedupeKey: email.dedupeKey,
    recipientEmail: recipient
  });

  const deliveryId = deliveryClaim.delivery?.id || null;

  if (!deliveryClaim.claimed) {
    return {
      status: 'duplicate',
      emailType: email.emailType,
      bookingReference: data.booking.booking_reference
    };
  }

  try {
    const sent = await sendEmail({
      to: recipient,
      subject: email.subject,
      html: email.html,
      dedupeKey: email.dedupeKey
    });

    await markSent(deliveryId, sent.id);

    return {
      status: 'sent',
      emailType: email.emailType,
      bookingReference: data.booking.booking_reference,
      resendEmailId: sent.id
    };
  } catch (error) {
    await markFailed(deliveryId, error);
    throw error;
  }
}

async function getReminderCandidates() {
  const rows = await rpc('get_due_balance_reminders');
  return Array.isArray(rows) ? rows : [];
}

async function processReminders() {
  const candidates = await getReminderCandidates();
  const results = [];
  const errors = [];

  for (const row of candidates) {
    try {
      if (!REMINDER_TYPES.has(row.reminder_type)) {
        throw new Error(`Unknown reminder type: ${row.reminder_type}`);
      }

      const data = await loadBooking(row.booking_id);

      // Recheck immediately before sending so a customer who has just paid
      // does not knowingly receive an outdated reminder.
      if (
        data.booking.status !== 'confirmed_part_paid' ||
        data.remainingBalance <= 0.005 ||
        !data.booking.balance_due_date ||
        !data.booking.balance_payment_token
      ) {
        results.push({
          status: 'skipped_after_recheck',
          bookingReference: data.booking.booking_reference,
          reminderType: row.reminder_type
        });
        continue;
      }

      results.push(await sendTracked(
        data,
        reminderEmail(row.reminder_type, data)
      ));
    } catch (error) {
      console.error('Balance reminder failed', {
        bookingId: row.booking_id,
        reminderType: row.reminder_type,
        message: error.message
      });

      errors.push({
        bookingId: row.booking_id,
        reminderType: row.reminder_type,
        error: error.message
      });
    }
  }

  return {
    candidates: candidates.length,
    results,
    errors
  };
}

async function processCancellations() {
  const rows = await rpc('cancel_overdue_balance_bookings');
  const cancelled = Array.isArray(rows) ? rows : [];

  return {
    cancelledCount: cancelled.length,
    bookingIds: cancelled.map(row => row.booking_id)
  };
}

async function recentAutoCancelled() {
  const since = new Date(
    Date.now() - CANCEL_RECOVERY_DAYS * 86400000
  ).toISOString();

  const rows = await sb(
    'bookings?status=eq.cancelled' +
    '&balance_cancelled_at=not.is.null' +
    `&balance_cancelled_at=gte.${encodeURIComponent(since)}` +
    '&select=id,booking_reference,balance_cancelled_at' +
    '&order=balance_cancelled_at.desc' +
    '&limit=100'
  );

  return Array.isArray(rows) ? rows : [];
}

async function processCancellationEmails() {
  const rows = await recentAutoCancelled();
  const results = [];
  const errors = [];

  for (const row of rows) {
    try {
      const data = await loadBooking(row.id);

      if (
        data.booking.status !== 'cancelled' ||
        !data.booking.balance_cancelled_at
      ) {
        continue;
      }

      results.push(await sendTracked(data, cancellationEmail(data)));
    } catch (error) {
      console.error('Cancellation email failed', {
        bookingId: row.id,
        message: error.message
      });

      errors.push({
        bookingId: row.id,
        error: error.message
      });
    }
  }

  return {
    candidates: rows.length,
    results,
    errors
  };
}

async function dryRun() {
  const reminders = await getReminderCandidates();
  const cancellationRows = await rpc('get_balance_cancellation_candidates');
  const cancellations = Array.isArray(cancellationRows) ? cancellationRows : [];

  return {
    dryRun: true,
    reminderCandidates: reminders.map(row => ({
      bookingId: row.booking_id,
      bookingReference: row.booking_reference,
      reminderType: row.reminder_type,
      eventDate: row.event_date,
      balanceDueDate: row.balance_due_date,
      remainingBalance: row.remaining_balance
    })),
    cancellationCandidates: cancellations.map(row => ({
      bookingId: row.booking_id,
      bookingReference: row.booking_reference,
      eventDate: row.event_date,
      balanceDueDate: row.balance_due_date,
      remainingBalance: row.remaining_balance
    }))
  };
}

async function runTest(body) {
  const bookingId = String(body.testBookingId || '').trim();
  const type = String(body.testReminderType || '').trim();
  const recipient = String(body.testRecipient || '').trim().toLowerCase();

  if (!UUID_RE.test(bookingId)) {
    const error = new Error('A valid testBookingId is required.');
    error.statusCode = 400;
    throw error;
  }

  if (!REMINDER_TYPES.has(type)) {
    const error = new Error('Invalid testReminderType.');
    error.statusCode = 400;
    throw error;
  }

  if (!validEmail(recipient)) {
    const error = new Error('A valid testRecipient is required.');
    error.statusCode = 400;
    throw error;
  }

  const data = await loadBooking(bookingId);

  if (
    data.booking.status !== 'confirmed_part_paid' ||
    data.remainingBalance <= 0.005 ||
    !data.booking.balance_payment_token
  ) {
    const error = new Error(
      'The test booking must be deposit-paid with an outstanding balance.'
    );
    error.statusCode = 400;
    throw error;
  }

  const email = reminderEmail(type, data);

  const sent = await sendEmail({
    to: recipient,
    subject: `[TEST] ${email.subject}`,
    html: email.html,
    dedupeKey: `test-v2/${type}/${bookingId}/${Date.now()}`
  });

  // Test sends deliberately do not write to email_deliveries, so they cannot
  // consume a genuine production reminder dedupe key.
  return {
    test: true,
    bookingReference: data.booking.booking_reference,
    reminderType: type,
    recipient,
    resendEmailId: sent.id
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  try {
    authorize(event);
    const body = parseBody(event);

    if (body.dryRun === true) {
      return json(200, await dryRun());
    }

    if (
      body.testBookingId ||
      body.testReminderType ||
      body.testRecipient
    ) {
      return json(200, await runTest(body));
    }

    const reminders = await processReminders();
    const cancellations = await processCancellations();

    // Scan recent auto-cancellations rather than only this invocation's rows.
    // If cancellation succeeded previously but the cancellation email failed,
    // a later run can retry the missing email safely through email_deliveries.
    const cancellationEmails = await processCancellationEmails();

    const errors = [
      ...reminders.errors,
      ...cancellationEmails.errors
    ];

    return json(errors.length ? 500 : 200, {
      ok: errors.length === 0,
      reminders,
      cancellations,
      cancellationEmails
    });
  } catch (error) {
    console.error('send-balance-reminders failed', {
      message: error.message,
      statusCode: error.statusCode
    });

    return json(error.statusCode || 500, {
      error: error.message || 'Balance reminder job failed.'
    });
  }
};
