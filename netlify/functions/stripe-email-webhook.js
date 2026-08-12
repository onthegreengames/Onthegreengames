'use strict';

// Netlify Function: netlify/functions/stripe-email-webhook.js
//
// Separate Stripe webhook used for transactional customer emails and
// internal new-booking notifications.
// It deliberately does NOT replace the existing payment webhook.
//
// Required Netlify environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   RESEND_FROM_NAME
//   STRIPE_EMAIL_WEBHOOK_SECRET
//
// Optional later, when Stripe goes live:
//   STRIPE_EMAIL_WEBHOOK_SECRET_LIVE
//   SITE_URL
//   INTERNAL_BOOKING_RECIPIENT (defaults to bookings@onthegreengames.co.uk)
//   INTERNAL_BOOKING_FROM_EMAIL (defaults to notifications@onthegreengames.co.uk)

const crypto = require('crypto');

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const PAYMENT_WAIT_ATTEMPTS = 6;
const PAYMENT_WAIT_MS = 650;
const CLAIM_RETRY_AFTER_MS = 5 * 60 * 1000;

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(value) {
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

function setupLabel(value) {
  return ({
    outdoor: 'Outdoors (grass)',
    indoor: 'Indoors (carpet)',
    unsure: 'Not sure yet'
  })[String(value || '').toLowerCase()] || 'Not specified';
}

function rawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
}

function parseStripeSignature(header) {
  const result = { timestamp: null, signatures: [] };

  String(header || '').split(',').forEach(part => {
    const index = part.indexOf('=');
    if (index < 0) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === 't') result.timestamp = Number(value);
    if (key === 'v1') result.signatures.push(value);
  });

  return result;
}

function safeHexEqual(leftHex, rightHex) {
  try {
    const left = Buffer.from(String(leftHex), 'hex');
    const right = Buffer.from(String(rightHex), 'hex');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function verifyStripeSignature(body, signatureHeader) {
  const secrets = [
    process.env.STRIPE_EMAIL_WEBHOOK_SECRET,
    process.env.STRIPE_EMAIL_WEBHOOK_SECRET_LIVE
  ].map(value => String(value || '').trim()).filter(Boolean);

  if (!secrets.length) {
    const error = new Error('Missing Stripe email webhook signing secret.');
    error.statusCode = 500;
    throw error;
  }

  const parsed = parseStripeSignature(signatureHeader);

  if (!parsed.timestamp || !parsed.signatures.length) {
    const error = new Error('Invalid Stripe-Signature header.');
    error.statusCode = 400;
    throw error;
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (age > SIGNATURE_TOLERANCE_SECONDS) {
    const error = new Error('Stripe webhook signature timestamp is outside the allowed window.');
    error.statusCode = 400;
    throw error;
  }

  const signedPayload = `${parsed.timestamp}.${body}`;

  const valid = secrets.some(secret => {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload, 'utf8')
      .digest('hex');

    return parsed.signatures.some(signature => safeHexEqual(signature, expected));
  });

  if (!valid) {
    const error = new Error('Stripe webhook signature verification failed.');
    error.statusCode = 400;
    throw error;
  }
}

function config() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
  const fromName = String(process.env.RESEND_FROM_NAME || 'On The Green Games').trim();
  const siteUrl = String(
    process.env.SITE_URL || 'https://onthegreengames.co.uk'
  ).replace(/\/$/, '');
  const internalBookingRecipient = String(
    process.env.INTERNAL_BOOKING_RECIPIENT || 'bookings@onthegreengames.co.uk'
  ).trim().toLowerCase();
  const internalBookingFromEmail = String(
    process.env.INTERNAL_BOOKING_FROM_EMAIL || 'notifications@onthegreengames.co.uk'
  ).trim().toLowerCase();

  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase server configuration.');
  if (!resendApiKey) throw new Error('Missing RESEND_API_KEY.');
  if (!fromEmail) throw new Error('Missing RESEND_FROM_EMAIL.');

  return {
    supabaseUrl,
    serviceKey,
    resendApiKey,
    fromEmail,
    fromName,
    siteUrl,
    internalBookingRecipient,
    internalBookingFromEmail
  };
}

async function supabase(path, options = {}) {
  const { supabaseUrl, serviceKey } = config();

  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });

  const raw = await result.text();
  let data = null;

  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = raw; }
  }

  if (!result.ok) {
    const error = new Error(
      data?.message || data?.details || data?.hint ||
      `Supabase request failed (${result.status}).`
    );
    error.statusCode = result.status >= 500 ? 502 : result.status;
    error.supabaseCode = data?.code;
    throw error;
  }

  return data;
}

async function getOne(path, message) {
  const rows = await supabase(path);
  if (!Array.isArray(rows) || !rows.length) throw new Error(message);
  return rows[0];
}

async function waitForPaidPayment(sessionId) {
  for (let attempt = 1; attempt <= PAYMENT_WAIT_ATTEMPTS; attempt += 1) {
    const rows = await supabase(
      `payments?stripe_session_id=eq.${encodeURIComponent(sessionId)}` +
      '&select=id,booking_id,payment_type,amount,payment_status,paid_at' +
      '&limit=1'
    );

    const payment = Array.isArray(rows) ? rows[0] : null;
    if (payment?.payment_status === 'paid') return payment;

    if (attempt < PAYMENT_WAIT_ATTEMPTS) await sleep(PAYMENT_WAIT_MS);
  }

  const error = new Error(
    'The payment webhook has not finished updating Supabase yet. Stripe can retry this email webhook.'
  );
  error.statusCode = 503;
  throw error;
}

async function loadBookingData(bookingId, payment) {
  const booking = await getOne(
    `bookings?id=eq.${encodeURIComponent(bookingId)}` +
    '&select=id,booking_reference,customer_id,venue_id,event_date,delivery_time,collection_time,status,total_price,deposit_required,balance_due_date,selection_type,package_id,setup_preference,subtotal,travel_fee,balance_payment_token' +
    '&limit=1',
    'Booking not found.'
  );

  const customer = await getOne(
    `customers?id=eq.${encodeURIComponent(booking.customer_id)}` +
    '&select=id,first_name,last_name,email,phone&limit=1',
    'Customer not found.'
  );

  const venue = await getOne(
    `venues?id=eq.${encodeURIComponent(booking.venue_id)}` +
    '&select=id,venue_name,address_line_1,address_line_2,town_city,county,postcode&limit=1',
    'Venue not found.'
  );

  let packageInfo = null;
  if (booking.package_id) {
    const rows = await supabase(
      `packages?id=eq.${encodeURIComponent(booking.package_id)}` +
      '&select=id,name,price&limit=1'
    );
    packageInfo = Array.isArray(rows) ? rows[0] || null : null;
  }

  const items = await supabase(
    `booking_items?booking_id=eq.${encodeURIComponent(booking.id)}` +
    '&select=product_name_snapshot,pricing_type,quantity,unit_price,total_price' +
    '&order=product_name_snapshot.asc'
  );

  const paidPayments = await supabase(
    `payments?booking_id=eq.${encodeURIComponent(booking.id)}` +
    '&payment_status=eq.paid' +
    '&select=id,payment_type,amount,payment_status,paid_at'
  );

  const totalPaid = (Array.isArray(paidPayments) ? paidPayments : [])
    .filter(row => ['deposit', 'balance', 'full'].includes(row.payment_type))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const remainingBalance = Math.max(
    0,
    Math.round((Number(booking.total_price || 0) - totalPaid) * 100) / 100
  );

  return {
    booking,
    customer,
    venue,
    packageInfo,
    items: Array.isArray(items) ? items : [],
    payment,
    totalPaid,
    remainingBalance
  };
}

function venueText(venue) {
  return [
    venue.venue_name,
    venue.address_line_1,
    venue.address_line_2,
    venue.town_city,
    venue.county,
    venue.postcode
  ].filter(Boolean).join(', ');
}

function bookedItemsRows(data) {
  const rows = [];

  if (data.packageInfo) {
    rows.push(`
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #e9e4d8;font-weight:700;">${escapeHtml(data.packageInfo.name)} package</td>
        <td style="padding:9px 0;border-bottom:1px solid #e9e4d8;text-align:right;font-weight:700;">${money(data.packageInfo.price)}</td>
      </tr>`);
  }

  data.items.forEach(item => {
    const amount = item.pricing_type === 'included'
      ? 'Included'
      : money(item.total_price);

    rows.push(`
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #e9e4d8;">${escapeHtml(item.product_name_snapshot)}</td>
        <td style="padding:9px 0;border-bottom:1px solid #e9e4d8;text-align:right;">${amount}</td>
      </tr>`);
  });

  if (Number(data.booking.travel_fee || 0) > 0) {
    rows.push(`
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #e9e4d8;">Travel</td>
        <td style="padding:9px 0;border-bottom:1px solid #e9e4d8;text-align:right;">${money(data.booking.travel_fee)}</td>
      </tr>`);
  }

  return rows.join('');
}

function emailShell({ title, eyebrow, intro, data, paymentBlock, actionBlock = '' }) {
  const { booking, customer, venue } = data;

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,Helvetica,sans-serif;color:#1b2a20;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e5ded0;border-radius:16px;overflow:hidden;">
<tr><td style="background:#173b2b;padding:26px 30px;color:#fff;">
<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#d3ad62;font-weight:700;">On The Green Games</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.18;margin-top:8px;">${escapeHtml(title)}</div>
</td></tr>
<tr><td style="padding:30px;">
<div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#9b7430;font-weight:700;margin-bottom:8px;">${escapeHtml(eyebrow)}</div>
<p style="margin:0 0 18px;font-size:16px;line-height:1.65;">Hi ${escapeHtml(customer.first_name)},</p>
<div style="font-size:16px;line-height:1.65;margin-bottom:26px;">${intro}</div>

<div style="background:#f7f4ec;border-radius:12px;padding:20px;margin-bottom:24px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Your booking</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Booking reference</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(booking.booking_reference)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Wedding date</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatDate(booking.event_date))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;vertical-align:top;">Venue</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(venueText(venue))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Setup</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(setupLabel(booking.setup_preference))}</td></tr>
</table>
</div>

<div style="margin-bottom:24px;">
<div style="font-size:18px;font-weight:700;margin-bottom:8px;">What you've booked</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${bookedItemsRows(data)}</table>
</div>

${paymentBlock}
${actionBlock}

<p style="margin:28px 0 0;font-size:14px;line-height:1.65;color:#667269;">Keep this email for your records. If you need to contact us, simply reply to this email.</p>
</td></tr>
<tr><td style="background:#173b2b;padding:20px 30px;text-align:center;color:#dfe8e2;font-size:12px;line-height:1.6;">On The Green Games · Wedding mini golf &amp; giant games</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildEmail(data, paymentType, siteUrl) {
  const { booking, payment, remainingBalance, totalPaid } = data;

  if (paymentType === 'deposit') {
    const balanceUrl = booking.balance_payment_token
      ? `${siteUrl}/pay-balance.html?token=${encodeURIComponent(booking.balance_payment_token)}`
      : null;

    const paymentBlock = `
<div style="border:1px solid #e5ded0;border-radius:12px;padding:20px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Payment summary</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Total booking price</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(booking.total_price)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Deposit paid</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(payment.amount)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Remaining balance</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(remainingBalance)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Balance due</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatDate(booking.balance_due_date))}</td></tr>
</table>
</div>`;

    const actionBlock = balanceUrl ? `
<div style="text-align:center;margin-top:24px;">
<a href="${escapeHtml(balanceUrl)}" style="display:inline-block;background:#c0913c;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:9px;">Pay remaining balance</a>
<div style="font-size:12px;color:#788078;margin-top:10px;">You can pay at any time before the due date.</div>
</div>` : '';

    return {
      emailType: 'booking_confirmation_deposit',
      dedupeKey: `booking-confirmation/${booking.id}`,
      subject: `Your wedding booking is confirmed — ${booking.booking_reference}`,
      html: emailShell({
        title: 'Your date is secured',
        eyebrow: 'Booking confirmed',
        intro: `We've received your deposit of <strong>${money(payment.amount)}</strong> and your wedding date is now secured with On The Green Games.`,
        data,
        paymentBlock,
        actionBlock
      })
    };
  }

  if (paymentType === 'full') {
    const paymentBlock = `
<div style="border:1px solid #e5ded0;border-radius:12px;padding:20px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Payment summary</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Total booking price</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(booking.total_price)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Paid</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(totalPaid)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Balance remaining</td><td style="padding:5px 0;text-align:right;font-weight:700;">£0.00</td></tr>
</table>
</div>`;

    return {
      emailType: 'booking_confirmation_full',
      dedupeKey: `booking-confirmation/${booking.id}`,
      subject: `Your wedding booking is confirmed and paid in full — ${booking.booking_reference}`,
      html: emailShell({
        title: "You're booked and paid in full",
        eyebrow: 'Booking confirmed',
        intro: `We've received your full payment of <strong>${money(payment.amount)}</strong>. Your wedding booking is confirmed and there is nothing else to pay.`,
        data,
        paymentBlock
      })
    };
  }

  if (paymentType === 'balance') {
    const paymentBlock = `
<div style="border:1px solid #e5ded0;border-radius:12px;padding:20px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Payment summary</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Balance payment received</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(payment.amount)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Total paid</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(totalPaid)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Balance remaining</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(remainingBalance)}</td></tr>
</table>
</div>`;

    return {
      emailType: 'balance_payment_confirmation',
      dedupeKey: `balance-payment-confirmation/${payment.id}`,
      subject: `Your balance is paid — ${booking.booking_reference}`,
      html: emailShell({
        title: 'Your balance is paid',
        eyebrow: 'Payment received',
        intro: `We've received your remaining balance payment of <strong>${money(payment.amount)}</strong>. Your booking is now paid in full.`,
        data,
        paymentBlock
      })
    };
  }

  throw new Error(`Unsupported payment type: ${paymentType}`);
}

function buildInternalNewBookingEmail(data, paymentType) {
  if (!['deposit', 'full'].includes(paymentType)) return null;

  const { booking, customer, venue, packageInfo, payment, remainingBalance } = data;
  const bookingLabel = packageInfo
    ? `${packageInfo.name} package`
    : booking.selection_type === 'build_your_own'
      ? 'Build Your Own'
      : 'Wedding games booking';

  const paymentLabel = paymentType === 'deposit'
    ? '25% deposit paid'
    : 'Paid in full';

  const balanceRows = paymentType === 'deposit'
    ? `
<tr><td style="padding:5px 0;color:#667269;">Remaining balance</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(remainingBalance)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Balance due</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatDate(booking.balance_due_date))}</td></tr>`
    : `
<tr><td style="padding:5px 0;color:#667269;">Remaining balance</td><td style="padding:5px 0;text-align:right;font-weight:700;">£0.00</td></tr>`;

  return {
    emailType: 'internal_new_booking',
    dedupeKey: `internal-new-booking/${booking.id}`,
    subject: `New booking — ${formatDate(booking.event_date)} — ${venue.venue_name}`,
    html: `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,Helvetica,sans-serif;color:#1b2a20;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#fff;border:1px solid #e5ded0;border-radius:16px;overflow:hidden;">
<tr><td style="background:#173b2b;padding:26px 30px;color:#fff;">
<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#d3ad62;font-weight:700;">On The Green Games</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.18;margin-top:8px;">New wedding booking</div>
</td></tr>
<tr><td style="padding:30px;">
<p style="margin:0 0 22px;font-size:16px;line-height:1.65;">A new booking has been successfully paid and confirmed.</p>

<div style="background:#f7f4ec;border-radius:12px;padding:20px;margin-bottom:22px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Wedding</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Booking reference</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(booking.booking_reference)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Wedding date</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatDate(booking.event_date))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;vertical-align:top;">Venue</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(venueText(venue))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Booking</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(bookingLabel)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Setup</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(setupLabel(booking.setup_preference))}</td></tr>
</table>
</div>

<div style="border:1px solid #e5ded0;border-radius:12px;padding:20px;margin-bottom:22px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Customer</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Name</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(`${customer.first_name} ${customer.last_name}`.trim())}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Email</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(customer.email)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Phone</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(customer.phone || 'Not provided')}</td></tr>
</table>
</div>

<div style="margin-bottom:22px;">
<div style="font-size:18px;font-weight:700;margin-bottom:8px;">What they booked</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${bookedItemsRows(data)}</table>
</div>

<div style="border:1px solid #e5ded0;border-radius:12px;padding:20px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Payment</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Booking total</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(booking.total_price)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Payment status</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(paymentLabel)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Received now</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(payment.amount)}</td></tr>${balanceRows}
</table>
</div>

<p style="margin:26px 0 0;font-size:13px;line-height:1.65;color:#667269;">This is an internal notification. The booking is also available in the On The Green Games operations dashboard.</p>
</td></tr>
<tr><td style="background:#173b2b;padding:20px 30px;text-align:center;color:#dfe8e2;font-size:12px;line-height:1.6;">On The Green Games · Internal booking notification</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
  };
}

async function getDelivery(dedupeKey) {
  const rows = await supabase(
    `email_deliveries?dedupe_key=eq.${encodeURIComponent(dedupeKey)}` +
    '&select=id,status,attempts,last_attempt_at,provider_email_id&limit=1'
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function claimDelivery({ bookingId, paymentId, emailType, dedupeKey, recipientEmail }) {
  try {
    const rows = await supabase('email_deliveries', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        booking_id: bookingId,
        payment_id: paymentId,
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
    if (error.supabaseCode !== '23505' && error.statusCode !== 409) throw error;
  }

  const existing = await getDelivery(dedupeKey);
  if (!existing) throw new Error('Could not load existing email delivery after a dedupe conflict.');

  if (existing.status === 'sent') return { claimed: false, delivery: existing };

  if (existing.status === 'pending' && existing.last_attempt_at) {
    const lastAttempt = new Date(existing.last_attempt_at).getTime();
    if (Date.now() - lastAttempt < CLAIM_RETRY_AFTER_MS) {
      return { claimed: false, delivery: existing };
    }
  }

  const rows = await supabase(
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
  await supabase(`email_deliveries?id=eq.${encodeURIComponent(deliveryId)}`, {
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
    await supabase(`email_deliveries?id=eq.${encodeURIComponent(deliveryId)}`, {
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

async function sendEmail({
  to,
  subject,
  html,
  dedupeKey,
  fromEmailOverride = null,
  fromNameOverride = null
}) {
  const { resendApiKey, fromEmail, fromName } = config();
  const senderEmail = String(fromEmailOverride || fromEmail).trim();
  const senderName = String(fromNameOverride || fromName).trim();

  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': dedupeKey
    },
    body: JSON.stringify({
      from: `${senderName} <${senderEmail}>`,
      to: [to],
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
      data?.message || data?.error?.message || `Resend rejected the email (${result.status}).`
    );
    error.statusCode = (result.status >= 500 || result.status === 429) ? 503 : 500;
    throw error;
  }

  if (!data?.id) throw new Error('Resend did not return an email ID.');
  return data;
}

async function sendManagedEmail({
  bookingId,
  paymentId,
  recipientEmail,
  email,
  fromEmailOverride = null,
  fromNameOverride = null
}) {
  const claim = await claimDelivery({
    bookingId,
    paymentId,
    emailType: email.emailType,
    dedupeKey: email.dedupeKey,
    recipientEmail
  });

  const deliveryId = claim.delivery?.id || null;

  if (!claim.claimed) {
    return {
      duplicate: true,
      emailType: email.emailType,
      deliveryStatus: claim.delivery?.status || null,
      resendEmailId: claim.delivery?.provider_email_id || null
    };
  }

  try {
    const resend = await sendEmail({
      to: recipientEmail,
      subject: email.subject,
      html: email.html,
      dedupeKey: email.dedupeKey,
      fromEmailOverride,
      fromNameOverride
    });

    await markSent(deliveryId, resend.id);

    return {
      duplicate: false,
      emailed: true,
      emailType: email.emailType,
      resendEmailId: resend.id
    };
  } catch (error) {
    await markFailed(deliveryId, error);
    error.deliveryId = deliveryId;
    throw error;
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed.' });
  }

  let deliveryId = null;

  try {
    const body = rawBody(event);
    const signature =
      event.headers?.['stripe-signature'] ||
      event.headers?.['Stripe-Signature'];

    verifyStripeSignature(body, signature);

    const stripeEvent = JSON.parse(body);

    if (![
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded'
    ].includes(stripeEvent.type)) {
      return response(200, { received: true, ignored: true });
    }

    const session = stripeEvent.data?.object;

    if (!session || session.object !== 'checkout.session') {
      return response(200, { received: true, ignored: true });
    }

    if (session.mode !== 'payment' || session.payment_status !== 'paid') {
      return response(200, { received: true, ignored: true });
    }

    const bookingId = String(session.metadata?.booking_id || '').trim();
    const paymentType = String(session.metadata?.payment_type || '').trim().toLowerCase();

    if (!bookingId || !['deposit', 'full', 'balance'].includes(paymentType)) {
      return response(200, {
        received: true,
        ignored: true,
        reason: 'Not an OTGG payment session.'
      });
    }

    // Stripe doesn't guarantee delivery order across separate webhook endpoints.
    // Wait briefly for the existing payment webhook to finish first.
    const payment = await waitForPaidPayment(session.id);

    if (payment.booking_id !== bookingId || payment.payment_type !== paymentType) {
      throw new Error('Stripe metadata does not match the OTGG payment row.');
    }

    const data = await loadBookingData(bookingId, payment);
    const customerRecipient = String(data.customer.email || '').trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(customerRecipient)) {
      throw new Error('The customer does not have a valid email address.');
    }

    const {
      siteUrl,
      internalBookingRecipient,
      internalBookingFromEmail
    } = config();

    const customerEmail = buildEmail(data, paymentType, siteUrl);

    const customerResult = await sendManagedEmail({
      bookingId,
      paymentId: payment.id,
      recipientEmail: customerRecipient,
      email: customerEmail
    });

    const results = {
      customer: customerResult,
      internalNewBooking: null
    };

    // Only the first successful payment that confirms a new booking should alert
    // the OTGG inbox. A later balance payment must not create a second "new booking" alert.
    if (['deposit', 'full'].includes(paymentType)) {
      if (!/^\S+@\S+\.\S+$/.test(internalBookingRecipient)) {
        throw new Error('The internal booking notification recipient is invalid.');
      }

      const internalEmail = buildInternalNewBookingEmail(data, paymentType);

      const internalResult = await sendManagedEmail({
        bookingId,
        paymentId: payment.id,
        recipientEmail: internalBookingRecipient,
        email: internalEmail,
        fromEmailOverride: internalBookingFromEmail,
        fromNameOverride: 'On The Green Games Notifications'
      });

      results.internalNewBooking = internalResult;
    }

    return response(200, {
      received: true,
      paymentType,
      results
    });

  } catch (error) {
    deliveryId = error.deliveryId || deliveryId;

    console.error('stripe-email-webhook failed', {
      message: error.message,
      statusCode: error.statusCode,
      deliveryId
    });

    return response(error.statusCode || 500, {
      error: error.message || 'Email webhook failed.'
    });
  }
};
