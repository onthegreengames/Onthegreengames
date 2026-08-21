'use strict';

// Netlify Function: netlify/functions/save-final-details.js
//
// Saves final wedding-day logistics through the service-role-only Supabase RPC,
// then sends a confirmation email. A successful database save is never reported
// as failed merely because Resend is temporarily unavailable.
//
// Required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   RESEND_FROM_NAME
//
// Optional:
//   SITE_URL

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_BODY_BYTES = 64 * 1024;
const CLAIM_RETRY_AFTER_MS = 5 * 60 * 1000;

const ALLOWED_FIELDS = new Set([
  'delivery_time',
  'collection_time',
  'setup_preference',
  'venue_contact_name',
  'venue_contact_phone',
  'wedding_day_contact_name',
  'wedding_day_contact_phone',
  'arrival_instructions',
  'parking_loading_instructions',
  'access_restrictions',
  'venue_restrictions',
  'setup_notes',
  'weather_contingency',
  'special_requests',
  'additional_notes'
]);

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
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

function parseBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

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

  if (!supabaseUrl || !serviceKey) {
    throw createError('Missing Supabase server configuration.', 500);
  }

  return {
    supabaseUrl,
    serviceKey,
    resendApiKey,
    fromEmail,
    fromName
  };
}

async function supabase(path, options = {}) {
  const { supabaseUrl, serviceKey } = config();

  let result;
  try {
    result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
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
  } catch (cause) {
    const error = createError('The booking service could not reach Supabase.', 502);
    error.cause = cause;
    throw error;
  }

  const raw = await result.text();
  let data = null;

  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = raw; }
  }

  if (!result.ok) {
    const message =
      data && typeof data === 'object'
        ? data.message || data.details || data.hint
        : null;

    const error = createError(
      message || `Supabase request failed (${result.status}).`,
      result.status >= 500 ? 502 : result.status
    );

    error.supabaseCode = data?.code;
    throw error;
  }

  return data;
}

async function rpc(functionName, body) {
  return supabase(`rpc/${encodeURIComponent(functionName)}`, {
    method: 'POST',
    body
  });
}

function text(value, maxLength) {
  if (value === null || value === undefined) return '';
  const normalised = String(value).trim();
  if (normalised.length > maxLength) {
    throw createError(`One of the supplied fields is longer than the ${maxLength}-character limit.`);
  }
  return normalised;
}

function normaliseDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createError('Final wedding details must be supplied.');
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw createError(`Unsupported final-details field: ${key}`);
    }
  }

  const details = {
    delivery_time: text(input.delivery_time, 5),
    collection_time: text(input.collection_time, 5),
    setup_preference: text(input.setup_preference, 20).toLowerCase(),

    venue_contact_name: text(input.venue_contact_name, 200),
    venue_contact_phone: text(input.venue_contact_phone, 50),
    wedding_day_contact_name: text(input.wedding_day_contact_name, 200),
    wedding_day_contact_phone: text(input.wedding_day_contact_phone, 50),

    arrival_instructions: text(input.arrival_instructions, 5000),
    parking_loading_instructions: text(input.parking_loading_instructions, 5000),
    access_restrictions: text(input.access_restrictions, 5000),
    venue_restrictions: text(input.venue_restrictions, 5000),

    setup_notes: text(input.setup_notes, 3000),
    weather_contingency: text(input.weather_contingency, 3000),
    special_requests: text(input.special_requests, 3000),
    additional_notes: text(input.additional_notes, 5000)
  };

  if (!TIME_REGEX.test(details.delivery_time) || !TIME_REGEX.test(details.collection_time)) {
    throw createError('Please provide valid delivery and collection times.');
  }

  if (details.collection_time <= details.delivery_time) {
    throw createError('Collection time must be later than the delivery/setup time.');
  }

  if (!['outdoor', 'indoor', 'unsure'].includes(details.setup_preference)) {
    throw createError('Setup preference must be outdoor, indoor or unsure.');
  }

  if (!details.wedding_day_contact_name) {
    throw createError('A wedding-day contact name is required.');
  }

  if (!details.wedding_day_contact_phone || details.wedding_day_contact_phone.length < 7) {
    throw createError('A valid wedding-day contact phone number is required.');
  }

  return details;
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

function formatTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  if (!match) return String(value || '');

  const hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes}${suffix}`;
}

function setupLabel(value) {
  return ({
    outdoor: 'Outdoors',
    indoor: 'Indoors',
    unsure: 'Not sure yet'
  })[String(value || '').toLowerCase()] || 'Not specified';
}

function buildConfirmationEmail(data, saveResult) {
  const booking = data.booking || {};
  const customer = data.customer || {};
  const venue = data.venue || {};
  const details = data.final_details || {};

  const venueText = [
    venue.venue_name,
    venue.town_city,
    venue.postcode
  ].filter(Boolean).join(', ');

  return {
    subject: `Wedding details received — ${data.booking_reference}`,
    html: `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,Helvetica,sans-serif;color:#1b2a20;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#173b2b;padding:26px 30px;color:#fff;">
<div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#d5b06b;margin-bottom:7px;">Final wedding details</div>
<div style="font-size:28px;line-height:1.2;font-weight:700;">We've received your details</div>
</td></tr>
<tr><td style="padding:30px;">
<p style="margin:0 0 18px;font-size:16px;line-height:1.65;">Hi ${escapeHtml(customer.first_name)},</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.65;">Thanks — we've saved the latest practical details for your wedding. You can use the same private link again if anything changes before the day.</p>

<div style="background:#f7f4ec;border-radius:12px;padding:20px;margin-bottom:24px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Your wedding</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Booking reference</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(data.booking_reference)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Wedding date</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatDate(data.event_date))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;vertical-align:top;">Venue</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(venueText)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Delivery / setup</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatTime(booking.delivery_time))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Collection</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatTime(booking.collection_time))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Setup</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(setupLabel(booking.setup_preference))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Wedding-day contact</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(details.wedding_day_contact_name || '')}</td></tr>
</table>
</div>

<p style="margin:0;font-size:14px;line-height:1.65;color:#667269;">This was submission ${escapeHtml(saveResult.submission_version)} of your final details. If you need to change anything, use the same private final-details link from our email.</p>
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

async function claimDelivery({ bookingId, emailType, dedupeKey, recipientEmail }) {
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

    return { claimed: true, delivery: rows[0] };

  } catch (error) {
    if (error.supabaseCode !== '23505' && error.statusCode !== 409) throw error;
  }

  const existing = await getDelivery(dedupeKey);
  if (!existing) {
    throw new Error('Could not load existing email delivery after a dedupe conflict.');
  }

  if (existing.status === 'sent') {
    return { claimed: false, delivery: existing };
  }

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
    console.error('Could not log failed final-details confirmation email.', {
      message: loggingError.message
    });
  }
}

async function sendEmail({ to, subject, html, dedupeKey }) {
  const {
    resendApiKey,
    fromEmail,
    fromName
  } = config();

  if (!resendApiKey || !fromEmail) {
    throw new Error('Resend customer-email configuration is missing.');
  }

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

    error.statusCode =
      result.status >= 500 || result.status === 429
        ? 503
        : 500;

    throw error;
  }

  if (!data?.id) {
    throw new Error('Resend did not return an email ID.');
  }

  return data;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return response(204, {});
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed.' });
  }

  let saveResult = null;

  try {
    const body = parseBody(event);
    const token = String(body.token || '').trim();

    if (!UUID_REGEX.test(token)) {
      throw createError('This final wedding details link is not valid.', 404);
    }

    const details = normaliseDetails(body.details);

    saveResult = await rpc('save_final_details_form', {
      p_token: token,
      p_payload: details
    });

    if (!saveResult?.ok || !UUID_REGEX.test(String(saveResult.booking_id || ''))) {
      throw createError('Supabase returned an invalid save result.', 502);
    }

    const data = await rpc('get_final_details_form', {
      p_token: token
    });

    const recipientEmail =
      String(data?.customer?.email || '')
        .trim()
        .toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) {
      console.error('Final details saved but customer email is invalid.', {
        bookingId: saveResult.booking_id
      });

      return response(200, {
        ...saveResult,
        emailSent: false,
        emailWarning: 'The details were saved, but the confirmation email could not be addressed.'
      });
    }

    const emailType = 'final_details_received';
    const dedupeKey =
      `final-details-received/${saveResult.booking_id}/v${saveResult.submission_version}`;

    let deliveryId = null;

    try {
      const claim = await claimDelivery({
        bookingId: saveResult.booking_id,
        emailType,
        dedupeKey,
        recipientEmail
      });

      deliveryId = claim.delivery?.id || null;

      if (!claim.claimed) {
        return response(200, {
          ...saveResult,
          emailSent: claim.delivery?.status === 'sent',
          emailDuplicate: true
        });
      }

      const email = buildConfirmationEmail(data, saveResult);

      const resend = await sendEmail({
        to: recipientEmail,
        subject: email.subject,
        html: email.html,
        dedupeKey
      });

      await markSent(deliveryId, resend.id);

      return response(200, {
        ...saveResult,
        emailSent: true
      });

    } catch (emailError) {
      await markFailed(deliveryId, emailError);

      console.error('Final details saved but confirmation email failed.', {
        bookingId: saveResult.booking_id,
        message: emailError.message
      });

      return response(200, {
        ...saveResult,
        emailSent: false,
        emailWarning: 'The details were saved, but the confirmation email could not be sent.'
      });
    }

  } catch (error) {
    console.error('save-final-details failed', {
      message: error.message,
      statusCode: error.statusCode,
      supabaseCode: error.supabaseCode,
      bookingId: saveResult?.booking_id || null
    });

    return response(error.statusCode || 500, {
      error: error.message || 'We could not save the final wedding details.'
    });
  }
};
