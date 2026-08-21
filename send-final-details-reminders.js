'use strict';

// Netlify Function: netlify/functions/send-final-details-reminders.js
//
// Daily final-details email automation.
// Production mode is called by Supabase Cron.
// Test mode can safely send either template to a nominated recipient.
//
// Reuses BALANCE_REMINDER_CRON_SECRET as the private bearer secret so the
// existing Supabase Vault secret can authenticate both daily automation jobs.
//
// Required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   RESEND_FROM_NAME
//   BALANCE_REMINDER_CRON_SECRET
//
// Optional:
//   SITE_URL

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 32 * 1024;
const CLAIM_RETRY_AFTER_MS = 5 * 60 * 1000;

const EMAIL_TYPES = new Set([
  'final_details_request',
  'final_details_reminder_7d'
]);

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function rawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
}

function parseBody(event) {
  const raw = rawBody(event);

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw createError('The request is too large.', 413);
  }

  try {
    const parsed = JSON.parse(raw || '{}');

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }

    return parsed;

  } catch {
    throw createError('The request is not valid JSON.');
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
  const cronSecret = String(process.env.BALANCE_REMINDER_CRON_SECRET || '').trim();

  const siteUrl = String(
    process.env.SITE_URL ||
    process.env.URL ||
    'https://onthegreengames.co.uk'
  ).replace(/\/$/, '');

  if (!supabaseUrl || !serviceKey) {
    throw createError('Missing Supabase server configuration.', 500);
  }

  if (!resendApiKey || !fromEmail) {
    throw createError('Missing Resend configuration.', 500);
  }

  if (!cronSecret) {
    throw createError('Missing BALANCE_REMINDER_CRON_SECRET.', 500);
  }

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

function bearerToken(event) {
  const header =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    '';

  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function verifyAuthorization(event) {
  const { cronSecret } = config();

  if (bearerToken(event) !== cronSecret) {
    throw createError('Unauthorized.', 401);
  }
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

async function rpc(functionName, body = {}) {
  return supabase(`rpc/${encodeURIComponent(functionName)}`, {
    method: 'POST',
    body
  });
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

function buildEmail({
  reminderType,
  bookingReference,
  customerFirstName,
  eventDate,
  venueName,
  finalDetailsUrl
}) {
  const isSevenDay = reminderType === 'final_details_reminder_7d';

  const subject = isSevenDay
    ? `We still need your wedding details — ${bookingReference}`
    : `Time to add your final wedding details — ${bookingReference}`;

  const eyebrow = isSevenDay
    ? 'Wedding in 7 days'
    : 'Final wedding details';

  const title = isSevenDay
    ? 'We still need a few details'
    : 'Help us get everything ready';

  const intro = isSevenDay
    ? `Your wedding is now only seven days away and we still don't have your final delivery, access and wedding-day contact details. Please add them as soon as you can so we can prepare properly for the day.`
    : `Now that your booking is paid in full, please take a few minutes to confirm the practical details we'll need for delivery, setup and collection on your wedding day.`;

  const buttonText = isSevenDay
    ? 'Add your wedding details now'
    : 'Add final wedding details';

  return {
    subject,
    html: `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,Helvetica,sans-serif;color:#1b2a20;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#173b2b;padding:26px 30px;color:#fff;">
<div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#d5b06b;margin-bottom:7px;">${escapeHtml(eyebrow)}</div>
<div style="font-size:28px;line-height:1.2;font-weight:700;">${escapeHtml(title)}</div>
</td></tr>
<tr><td style="padding:30px;">
<p style="margin:0 0 18px;font-size:16px;line-height:1.65;">Hi ${escapeHtml(customerFirstName)},</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.65;">${escapeHtml(intro)}</p>

<div style="background:#f7f4ec;border-radius:12px;padding:20px;margin-bottom:24px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Your booking</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Booking reference</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(bookingReference)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Wedding date</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatDate(eventDate))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Venue</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(venueName || '')}</td></tr>
</table>
</div>

<p style="margin:0 0 20px;font-size:14px;line-height:1.65;color:#4f5f54;">The form lets you review the details already on your booking and confirm your timings, wedding-day contact, setup location, access and parking information, wet-weather arrangements and anything else we should know.</p>

<div style="text-align:center;margin:26px 0;">
<a href="${escapeHtml(finalDetailsUrl)}" style="display:inline-block;background:#c0913c;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:9px;">${escapeHtml(buttonText)}</a>
</div>

<p style="margin:24px 0 0;font-size:14px;line-height:1.65;color:#667269;">You can return to the same private link and update the details again if anything changes before your wedding. If you'd rather speak to us, simply reply to this email.</p>
</td></tr>
<tr><td style="background:#173b2b;padding:20px 30px;text-align:center;color:#dfe8e2;font-size:12px;line-height:1.6;">On The Green Games · Wedding mini golf &amp; giant games</td></tr>
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

async function claimDelivery({
  bookingId,
  emailType,
  dedupeKey,
  recipientEmail
}) {
  try {
    const rows = await supabase('email_deliveries', {
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

    return {
      claimed: true,
      delivery: rows[0]
    };

  } catch (error) {
    if (error.supabaseCode !== '23505' && error.statusCode !== 409) {
      throw error;
    }
  }

  const existing = await getDelivery(dedupeKey);

  if (!existing) {
    throw new Error('Could not load existing email delivery after a dedupe conflict.');
  }

  if (existing.status === 'sent') {
    return {
      claimed: false,
      delivery: existing
    };
  }

  if (
    existing.status === 'pending' &&
    existing.last_attempt_at
  ) {
    const lastAttempt =
      new Date(existing.last_attempt_at).getTime();

    if (
      Date.now() - lastAttempt <
      CLAIM_RETRY_AFTER_MS
    ) {
      return {
        claimed: false,
        delivery: existing
      };
    }
  }

  const rows = await supabase(
    `email_deliveries?id=eq.${encodeURIComponent(existing.id)}`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        status: 'pending',
        attempts:
          Number(existing.attempts || 0) + 1,
        last_attempt_at:
          new Date().toISOString(),
        last_error: null
      }
    }
  );

  return {
    claimed: true,
    delivery: rows[0]
  };
}

async function markSent(deliveryId, resendId) {
  await supabase(
    `email_deliveries?id=eq.${encodeURIComponent(deliveryId)}`,
    {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        status: 'sent',
        provider_email_id: resendId,
        sent_at: new Date().toISOString(),
        last_error: null
      }
    }
  );
}

async function markFailed(deliveryId, error) {
  if (!deliveryId) return;

  try {
    await supabase(
      `email_deliveries?id=eq.${encodeURIComponent(deliveryId)}`,
      {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          status: 'failed',
          last_error: String(
            error?.message ||
            error ||
            'Unknown error'
          ).slice(0, 3000)
        }
      }
    );
  } catch (loggingError) {
    console.error(
      'Could not log failed final-details email.',
      {
        message: loggingError.message
      }
    );
  }
}

async function sendEmail({
  to,
  subject,
  html,
  dedupeKey
}) {
  const {
    resendApiKey,
    fromEmail,
    fromName
  } = config();

  const result = await fetch(
    'https://api.resend.com/emails',
    {
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${resendApiKey}`,
        'Content-Type':
          'application/json',
        'Idempotency-Key':
          dedupeKey
      },
      body: JSON.stringify({
        from:
          `${fromName} <${fromEmail}>`,
        to: [to],
        subject,
        html
      })
    }
  );

  const raw = await result.text();

  let data = null;

  try {
    data =
      raw
        ? JSON.parse(raw)
        : {};
  } catch {
    data = raw;
  }

  if (!result.ok) {
    const error =
      new Error(
        data?.message ||
        data?.error?.message ||
        `Resend rejected the email (${result.status}).`
      );

    error.statusCode =
      result.status >= 500 ||
      result.status === 429
        ? 503
        : 500;

    throw error;
  }

  if (!data?.id) {
    throw new Error(
      'Resend did not return an email ID.'
    );
  }

  return data;
}

async function loadFormByToken(token) {
  return rpc('get_final_details_form', {
    p_token: token
  });
}

async function loadTokenForBooking(bookingId) {
  const rows = await supabase(
    `booking_final_details?booking_id=eq.${encodeURIComponent(bookingId)}` +
    '&select=final_details_token&limit=1'
  );

  const row =
    Array.isArray(rows)
      ? rows[0]
      : null;

  if (!row?.final_details_token) {
    throw createError(
      'The booking does not have a final-details token.',
      404
    );
  }

  return row.final_details_token;
}

function finalDetailsUrl(token) {
  const { siteUrl } = config();

  return `${siteUrl}/additional-details.html?token=${encodeURIComponent(token)}`;
}

async function sendProductionCandidate(candidate) {
  const token =
    String(candidate.final_details_token || '').trim();

  if (!UUID_REGEX.test(token)) {
    throw new Error(
      `Booking ${candidate.booking_reference} has an invalid final-details token.`
    );
  }

  const formData =
    await loadFormByToken(token);

  // Recheck right before sending in case details were submitted
  // after the SQL candidate query was evaluated.
  if (
    formData?.booking_status !== 'paid' ||
    !formData?.can_edit
  ) {
    return {
      status: 'skipped',
      reason: 'booking_not_editable',
      bookingReference:
        candidate.booking_reference
    };
  }

  if (
    formData?.final_details?.received_at
  ) {
    return {
      status: 'skipped',
      reason: 'details_already_received',
      bookingReference:
        candidate.booking_reference
    };
  }

  const reminderType =
    String(candidate.reminder_type || '');

  if (!EMAIL_TYPES.has(reminderType)) {
    throw new Error(
      `Unsupported final-details reminder type: ${reminderType}`
    );
  }

  const recipientEmail =
    String(candidate.customer_email || '')
      .trim()
      .toLowerCase();

  if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) {
    throw new Error(
      `Booking ${candidate.booking_reference} has an invalid customer email.`
    );
  }

  const email = buildEmail({
    reminderType,
    bookingReference:
      candidate.booking_reference,
    customerFirstName:
      candidate.customer_first_name,
    eventDate:
      candidate.event_date,
    venueName:
      candidate.venue_name,
    finalDetailsUrl:
      finalDetailsUrl(token)
  });

  const dedupeKey =
    `${reminderType}/${candidate.booking_id}`;

  const claim =
    await claimDelivery({
      bookingId:
        candidate.booking_id,
      emailType:
        reminderType,
      dedupeKey,
      recipientEmail
    });

  const deliveryId =
    claim.delivery?.id || null;

  if (!claim.claimed) {
    return {
      status: 'duplicate',
      emailType:
        reminderType,
      bookingReference:
        candidate.booking_reference
    };
  }

  try {
    const resend =
      await sendEmail({
        to: recipientEmail,
        subject: email.subject,
        html: email.html,
        dedupeKey
      });

    await markSent(
      deliveryId,
      resend.id
    );

    return {
      status: 'sent',
      emailType:
        reminderType,
      bookingReference:
        candidate.booking_reference
    };

  } catch (error) {
    await markFailed(
      deliveryId,
      error
    );

    throw error;
  }
}

async function runProduction() {
  const candidates =
    await rpc(
      'get_due_final_details_emails',
      {}
    );

  const rows =
    Array.isArray(candidates)
      ? candidates
      : [];

  const results = [];
  const errors = [];

  for (const candidate of rows) {
    try {
      results.push(
        await sendProductionCandidate(
          candidate
        )
      );
    } catch (error) {
      console.error(
        'Final-details candidate failed.',
        {
          bookingId:
            candidate?.booking_id || null,
          bookingReference:
            candidate?.booking_reference || null,
          reminderType:
            candidate?.reminder_type || null,
          message:
            error.message
        }
      );

      errors.push({
        bookingId:
          candidate?.booking_id || null,
        bookingReference:
          candidate?.booking_reference || null,
        reminderType:
          candidate?.reminder_type || null,
        error:
          error.message
      });
    }
  }

  return {
    ok:
      errors.length === 0,
    candidates:
      rows.length,
    results,
    errors
  };
}

async function runTest(body) {
  const bookingId =
    String(
      body.testBookingId || ''
    ).trim();

  const reminderType =
    String(
      body.testReminderType || ''
    ).trim();

  const recipient =
    String(
      body.testRecipient || ''
    ).trim()
    .toLowerCase();

  if (!UUID_REGEX.test(bookingId)) {
    throw createError(
      'A valid testBookingId is required.'
    );
  }

  if (!EMAIL_TYPES.has(reminderType)) {
    throw createError(
      'testReminderType must be final_details_request or final_details_reminder_7d.'
    );
  }

  if (!/^\S+@\S+\.\S+$/.test(recipient)) {
    throw createError(
      'A valid testRecipient is required.'
    );
  }

  const token =
    await loadTokenForBooking(
      bookingId
    );

  const data =
    await loadFormByToken(
      token
    );

  const email =
    buildEmail({
      reminderType,
      bookingReference:
        data.booking_reference,
      customerFirstName:
        data.customer?.first_name || 'there',
      eventDate:
        data.event_date,
      venueName:
        data.venue?.venue_name || '',
      finalDetailsUrl:
        finalDetailsUrl(token)
    });

  const testKey =
    `test-${reminderType}-${bookingId}-${Date.now()}`;

  const resend =
    await sendEmail({
      to: recipient,
      subject:
        `[TEST] ${email.subject}`,
      html:
        email.html,
      dedupeKey:
        testKey
    });

  return {
    ok: true,
    test: true,
    emailType:
      reminderType,
    bookingReference:
      data.booking_reference,
    recipient,
    resendEmailId:
      resend.id
  };
}

exports.handler =
async function handler(event) {

  if (event.httpMethod !== 'POST') {
    return response(
      405,
      {
        error:
          'Method not allowed.'
      }
    );
  }

  try {
    verifyAuthorization(event);

    const body =
      parseBody(event);

    const isTest =
      body.testBookingId !== undefined ||
      body.testReminderType !== undefined ||
      body.testRecipient !== undefined;

    const result =
      isTest
        ? await runTest(body)
        : await runProduction();

    return response(
      result.ok === false
        ? 207
        : 200,
      result
    );

  } catch (error) {
    console.error(
      'send-final-details-reminders failed',
      {
        message:
          error.message,
        statusCode:
          error.statusCode,
        supabaseCode:
          error.supabaseCode
      }
    );

    return response(
      error.statusCode || 500,
      {
        error:
          error.message ||
          'Final-details email automation failed.'
      }
    );
  }
};
