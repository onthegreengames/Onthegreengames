'use strict';

const crypto = require('crypto');

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 256 * 1024;
const EMAIL_CLAIM_RETRY_AFTER_MS = 5 * 60 * 1000;


/* ============================================================
   RESPONSE
   ============================================================ */

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


function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}


/* ============================================================
   RAW WEBHOOK BODY
   ============================================================ */

function getRawBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer
        .from(
          event.body || '',
          'base64'
        )
        .toString('utf8')

    : event.body || '';


  if (
    Buffer.byteLength(
      rawBody,
      'utf8'
    ) > MAX_BODY_BYTES
  ) {
    throw createError(
      'Webhook payload is too large.',
      413
    );
  }


  return rawBody;
}


/* ============================================================
   HEADERS
   ============================================================ */

function getHeader(headers, name) {
  if (!headers) {
    return null;
  }


  const target =
    name.toLowerCase();


  for (
    const [key, value]
    of Object.entries(headers)
  ) {
    if (
      String(key).toLowerCase()
      === target
    ) {
      return Array.isArray(value)
        ? value[0]
        : value;
    }
  }


  return null;
}


/* ============================================================
   STRIPE WEBHOOK SECRET
   ============================================================ */

function getWebhookSecret() {
  const secret =
    String(
      process.env.STRIPE_WEBHOOK_SECRET ||
      ''
    )
      .trim();


  if (!secret) {
    throw createError(
      'Missing STRIPE_WEBHOOK_SECRET in Netlify.',
      500
    );
  }


  if (
    !secret.startsWith(
      'whsec_'
    )
  ) {
    throw createError(
      'STRIPE_WEBHOOK_SECRET does not look valid.',
      500
    );
  }


  return secret;
}


/* ============================================================
   STRIPE SIGNATURE VERIFICATION
   ============================================================ */

function parseStripeSignature(header) {
  const parts =
    String(header || '')
      .split(',')
      .map(
        part =>
          part.trim()
      )
      .filter(Boolean);


  let timestamp =
    null;


  const v1Signatures =
    [];


  for (const part of parts) {
    const separator =
      part.indexOf('=');


    if (separator === -1) {
      continue;
    }


    const key =
      part.slice(
        0,
        separator
      );


    const value =
      part.slice(
        separator + 1
      );


    if (
      key === 't' &&
      timestamp === null
    ) {
      timestamp =
        Number(value);
    }


    if (
      key === 'v1' &&
      value
    ) {
      v1Signatures.push(
        value
      );
    }
  }


  if (
    !Number.isFinite(timestamp) ||
    v1Signatures.length === 0
  ) {
    throw createError(
      'Stripe signature header is malformed.',
      400
    );
  }


  return {
    timestamp,
    v1Signatures
  };
}


function safeHexEqual(a, b) {
  try {
    const aBuffer =
      Buffer.from(
        String(a),
        'hex'
      );


    const bBuffer =
      Buffer.from(
        String(b),
        'hex'
      );


    if (
      aBuffer.length === 0 ||
      aBuffer.length !==
        bBuffer.length
    ) {
      return false;
    }


    return crypto.timingSafeEqual(
      aBuffer,
      bBuffer
    );

  } catch {
    return false;
  }
}


function verifyStripeSignature(
  rawBody,
  signatureHeader
) {
  const secret =
    getWebhookSecret();


  const {
    timestamp,
    v1Signatures
  } =
    parseStripeSignature(
      signatureHeader
    );


  const ageSeconds =
    Math.abs(
      Math.floor(
        Date.now() / 1000
      ) -
      timestamp
    );


  if (
    ageSeconds >
    SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw createError(
      'Stripe webhook timestamp is outside the allowed tolerance.',
      400
    );
  }


  const signedPayload =
    `${timestamp}.${rawBody}`;


  const expectedSignature =
    crypto
      .createHmac(
        'sha256',
        secret
      )
      .update(
        signedPayload,
        'utf8'
      )
      .digest('hex');


  const matched =
    v1Signatures.some(
      signature =>
        safeHexEqual(
          signature,
          expectedSignature
        )
    );


  if (!matched) {
    throw createError(
      'Stripe webhook signature verification failed.',
      400
    );
  }
}


/* ============================================================
   PARSE EVENT
   ============================================================ */

function parseEvent(rawBody) {
  try {
    const event =
      JSON.parse(rawBody);


    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event)
    ) {
      throw new Error();
    }


    return event;

  } catch {
    throw createError(
      'Stripe webhook payload is not valid JSON.',
      400
    );
  }
}


/* ============================================================
   SUPABASE CONFIG
   ============================================================ */

function getSupabaseConfig() {
  const baseUrl =
    String(
      process.env.SUPABASE_URL ||
      ''
    )
      .replace(
        /\/$/,
        ''
      );


  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;


  if (
    !baseUrl ||
    !serviceKey
  ) {
    throw createError(
      'Missing Supabase server configuration.',
      500
    );
  }


  return {
    baseUrl,
    serviceKey
  };
}


/* ============================================================
   SUPABASE RPC
   ============================================================ */

async function supabaseRpc(
  functionName,
  body
) {
  const {
    baseUrl,
    serviceKey
  } =
    getSupabaseConfig();


  let result;


  try {
    result =
      await fetch(
        `${baseUrl}/rest/v1/rpc/${functionName}`,
        {
          method: 'POST',

          headers: {
            apikey:
              serviceKey,

            Authorization:
              `Bearer ${serviceKey}`,

            Accept:
              'application/json',

            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(
              body
            )
        }
      );

  } catch (cause) {
    const error =
      createError(
        'The webhook could not reach Supabase.',
        502
      );


    error.cause =
      cause;


    throw error;
  }


  const raw =
    await result.text();


  let data =
    null;


  if (raw) {
    try {
      data =
        JSON.parse(raw);

    } catch {
      data =
        raw;
    }
  }


  if (!result.ok) {
    const message =
      data &&
      typeof data === 'object'

        ? (
            data.message ||
            data.details ||
            data.hint
          )

        : null;


    throw createError(
      message ||
      'Supabase rejected the Stripe webhook update.',

      result.status >= 500
        ? 502
        : 400
    );
  }


  return data;
}



/* ============================================================
   SUPABASE REST (for the internal abandoned-checkout email only)
   ============================================================ */

async function supabaseRequest(path, options = {}) {
  const {
    baseUrl,
    serviceKey
  } = getSupabaseConfig();

  const result = await fetch(
    `${baseUrl}/rest/v1/${path}`,
    {
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
    }
  );

  const raw = await result.text();

  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!result.ok) {
    const error = createError(
      data?.message ||
      data?.details ||
      data?.hint ||
      `Supabase request failed (${result.status}).`,
      result.status >= 500 ? 502 : result.status
    );

    error.supabaseCode = data?.code;
    throw error;
  }

  return data;
}


async function getOne(path, notFoundMessage) {
  const rows = await supabaseRequest(path);

  if (!Array.isArray(rows) || rows.length === 0) {
    throw createError(notFoundMessage, 404);
  }

  return rows[0];
}


function getAbandonedEmailConfig() {
  const resendApiKey =
    String(process.env.RESEND_API_KEY || '').trim();

  const fromEmail =
    String(process.env.RESEND_FROM_EMAIL || '').trim();

  const fromName =
    String(process.env.RESEND_FROM_NAME || 'On The Green Games').trim();

  const recipient =
    String(
      process.env.ABANDONED_CHECKOUT_RECIPIENT ||
      'onthegreengames@gmail.com'
    )
      .trim()
      .toLowerCase();

  if (!resendApiKey) {
    throw createError('Missing RESEND_API_KEY.', 500);
  }

  if (!fromEmail) {
    throw createError('Missing RESEND_FROM_EMAIL.', 500);
  }

  return {
    resendApiKey,
    fromEmail,
    fromName,
    recipient
  };
}


function escapeHtml(value) {
  return String(value ?? '')
    .replace(
      /[&<>'"]/g,
      char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[char]
    );
}


function money(value) {
  const amount = Number(value || 0);

  return new Intl.NumberFormat(
    'en-GB',
    {
      style: 'currency',
      currency: 'GBP'
    }
  ).format(amount);
}


function formatDate(value) {
  if (!value) {
    return 'Not supplied';
  }

  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleDateString(
    'en-GB',
    {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }
  );
}


async function getEmailDelivery(dedupeKey) {
  const rows = await supabaseRequest(
    `email_deliveries?dedupe_key=eq.${encodeURIComponent(dedupeKey)}` +
    '&select=id,status,attempts,last_attempt_at,provider_email_id&limit=1'
  );

  return Array.isArray(rows)
    ? rows[0] || null
    : null;
}


async function claimAbandonedEmailDelivery({
  bookingId,
  paymentId,
  dedupeKey,
  recipientEmail
}) {
  try {
    const rows = await supabaseRequest(
      'email_deliveries',
      {
        method: 'POST',
        prefer: 'return=representation',

        body: {
          booking_id: bookingId,
          payment_id: paymentId,
          email_type: 'internal_abandoned_checkout',
          dedupe_key: dedupeKey,
          recipient_email: recipientEmail,
          provider: 'resend',
          status: 'pending',
          attempts: 1,
          last_attempt_at: new Date().toISOString()
        }
      }
    );

    return {
      claimed: true,
      delivery: rows?.[0] || null
    };

  } catch (error) {
    if (
      error.supabaseCode !== '23505' &&
      error.statusCode !== 409
    ) {
      throw error;
    }
  }

  const existing =
    await getEmailDelivery(dedupeKey);

  if (!existing) {
    throw createError(
      'Could not load the existing abandoned-checkout email delivery.',
      500
    );
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
      EMAIL_CLAIM_RETRY_AFTER_MS
    ) {
      return {
        claimed: false,
        delivery: existing
      };
    }
  }

  const rows = await supabaseRequest(
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

  return {
    claimed: true,
    delivery: rows?.[0] || existing
  };
}


async function markAbandonedEmailSent(deliveryId, resendId) {
  if (!deliveryId) {
    return;
  }

  await supabaseRequest(
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


async function markAbandonedEmailFailed(deliveryId, error) {
  if (!deliveryId) {
    return;
  }

  try {
    await supabaseRequest(
      `email_deliveries?id=eq.${encodeURIComponent(deliveryId)}`,
      {
        method: 'PATCH',
        prefer: 'return=minimal',

        body: {
          status: 'failed',
          last_error:
            String(
              error?.message ||
              error ||
              'Unknown error'
            ).slice(0, 3000)
        }
      }
    );

  } catch (loggingError) {
    console.error(
      'Could not log failed abandoned-checkout email',
      loggingError.message
    );
  }
}


async function loadAbandonedCheckoutData(session) {
  const bookingId =
    String(
      session?.metadata?.booking_id ||
      ''
    ).trim();

  const payment =
    await getOne(
      `payments?stripe_session_id=eq.${encodeURIComponent(session.id)}` +
      '&select=id,booking_id,payment_type,amount,payment_status&limit=1',
      'Expired checkout payment record was not found.'
    );

  const authoritativeBookingId =
    payment.booking_id ||
    bookingId;

  const booking =
    await getOne(
      `bookings?id=eq.${encodeURIComponent(authoritativeBookingId)}` +
      '&select=id,booking_reference,customer_id,venue_id,event_date,total_price,selection_type,package_id,subtotal,travel_fee&limit=1',
      'Expired checkout booking was not found.'
    );

  const customer =
    await getOne(
      `customers?id=eq.${encodeURIComponent(booking.customer_id)}` +
      '&select=first_name,last_name,email,phone&limit=1',
      'Expired checkout customer was not found.'
    );

  const venue =
    await getOne(
      `venues?id=eq.${encodeURIComponent(booking.venue_id)}` +
      '&select=venue_name,address_line_1,address_line_2,town_city,county,postcode&limit=1',
      'Expired checkout venue was not found.'
    );

  let packageInfo = null;

  if (booking.package_id) {
    const packages =
      await supabaseRequest(
        `packages?id=eq.${encodeURIComponent(booking.package_id)}` +
        '&select=name,price&limit=1'
      );

    packageInfo =
      Array.isArray(packages)
        ? packages[0] || null
        : null;
  }

  const items =
    await supabaseRequest(
      `booking_items?booking_id=eq.${encodeURIComponent(booking.id)}` +
      '&select=product_name_snapshot,pricing_type,quantity,total_price' +
      '&order=product_name_snapshot.asc'
    );

  return {
    booking,
    customer,
    venue,
    packageInfo,
    items: Array.isArray(items) ? items : [],
    payment
  };
}


function buildAbandonedCheckoutEmail(data, session) {
  const {
    booking,
    customer,
    venue,
    packageInfo,
    items,
    payment
  } = data;

  const customerName =
    [
      customer.first_name,
      customer.last_name
    ]
      .filter(Boolean)
      .join(' ') ||
    'Not supplied';

  const venueAddress =
    [
      venue.venue_name,
      venue.address_line_1,
      venue.address_line_2,
      venue.town_city,
      venue.county,
      venue.postcode
    ]
      .filter(Boolean)
      .join(', ');

  const bookingLabel =
    packageInfo?.name
      ? `${packageInfo.name} package`
      : booking.selection_type === 'build_your_own'
        ? 'Build Your Own'
        : 'Wedding games booking';

  const itemRows =
    items.length
      ? items
          .map(item => {
            const price =
              item.pricing_type === 'included'
                ? 'Included'
                : money(item.total_price);

            return `
<tr>
<td style="padding:7px 0;border-top:1px solid #e9e4d8;">${escapeHtml(item.product_name_snapshot)}</td>
<td style="padding:7px 0;border-top:1px solid #e9e4d8;text-align:right;">${escapeHtml(price)}</td>
</tr>`;
          })
          .join('')
      : `
<tr>
<td colspan="2" style="padding:7px 0;color:#667269;">No item rows were available.</td>
</tr>`;

  const paymentTypeLabel =
    payment.payment_type === 'deposit'
      ? '25% deposit'
      : 'Full payment';

  return {
    subject:
      `Abandoned checkout — ${booking.booking_reference} — ${venue.venue_name}`,

    html: `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:Arial,Helvetica,sans-serif;color:#1b2a20;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#fff;border:1px solid #e5ded0;border-radius:16px;overflow:hidden;">
<tr><td style="background:#173b2b;padding:26px 30px;color:#fff;">
<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#d3ad62;font-weight:700;">On The Green Games</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.18;margin-top:8px;">Checkout abandoned</div>
</td></tr>
<tr><td style="padding:30px;">
<p style="margin:0 0 22px;font-size:16px;line-height:1.65;">A customer created a booking and reached Stripe Checkout, but the payment session expired without payment.</p>

<div style="background:#f7f4ec;border-radius:12px;padding:20px;margin-bottom:22px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Wedding</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Booking reference</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(booking.booking_reference)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Wedding date</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(formatDate(booking.event_date))}</td></tr>
<tr><td style="padding:5px 0;color:#667269;vertical-align:top;">Venue</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(venueAddress)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Booking</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(bookingLabel)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Total booking value</td><td style="padding:5px 0;text-align:right;font-weight:700;">${money(booking.total_price)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Attempted payment</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(paymentTypeLabel)} — ${money(payment.amount)}</td></tr>
</table>
</div>

<div style="border:1px solid #e5ded0;border-radius:12px;padding:20px;margin-bottom:22px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Customer</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
<tr><td style="padding:5px 0;color:#667269;">Name</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(customerName)}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Email</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(customer.email || 'Not supplied')}</td></tr>
<tr><td style="padding:5px 0;color:#667269;">Phone</td><td style="padding:5px 0;text-align:right;font-weight:700;">${escapeHtml(customer.phone || 'Not supplied')}</td></tr>
</table>
</div>

<div style="border:1px solid #e5ded0;border-radius:12px;padding:20px;">
<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Items selected</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
${itemRows}
</table>
</div>

<p style="margin:24px 0 0;font-size:12px;line-height:1.65;color:#667269;">Stripe session: ${escapeHtml(session.id)}. This is an internal notification and has been logged in email_deliveries.</p>
</td></tr>
<tr><td style="background:#173b2b;padding:20px 30px;text-align:center;color:#dfe8e2;font-size:12px;">On The Green Games · Internal checkout notification</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
  };
}


async function sendAbandonedCheckoutEmail(session) {
  const paymentType =
    String(
      session?.metadata?.payment_type ||
      ''
    )
      .trim()
      .toLowerCase();

  /*
   * Balance-payment checkouts already have their own reminder process.
   * This alert is only for a customer's initial deposit/full-payment checkout.
   */
  if (
    paymentType &&
    !['deposit', 'full'].includes(paymentType)
  ) {
    return {
      skipped: true,
      reason: `payment_type_${paymentType}`
    };
  }

  const data =
    await loadAbandonedCheckoutData(session);

  if (
    !['deposit', 'full'].includes(
      String(data.payment.payment_type || '').toLowerCase()
    )
  ) {
    return {
      skipped: true,
      reason:
        `payment_type_${data.payment.payment_type || 'unknown'}`
    };
  }

  const {
    resendApiKey,
    fromEmail,
    fromName,
    recipient
  } = getAbandonedEmailConfig();

  const dedupeKey =
    `internal-abandoned-checkout/${session.id}`;

  const claim =
    await claimAbandonedEmailDelivery(
      {
        bookingId: data.booking.id,
        paymentId: data.payment.id,
        dedupeKey,
        recipientEmail: recipient
      }
    );

  if (!claim.claimed) {
    return {
      duplicate: true,
      deliveryStatus:
        claim.delivery?.status ||
        null
    };
  }

  const deliveryId =
    claim.delivery?.id ||
    null;

  try {
    const email =
      buildAbandonedCheckoutEmail(
        data,
        session
      );

    const result =
      await fetch(
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

          body: JSON.stringify(
            {
              from:
                `${fromName} <${fromEmail}>`,

              to:
                [recipient],

              subject:
                email.subject,

              html:
                email.html
            }
          )
        }
      );

    const raw =
      await result.text();

    let resendData = null;

    try {
      resendData =
        raw
          ? JSON.parse(raw)
          : {};
    } catch {
      resendData = raw;
    }

    if (!result.ok) {
      throw createError(
        resendData?.message ||
        resendData?.error?.message ||
        `Resend rejected the abandoned-checkout email (${result.status}).`,
        result.status >= 500 || result.status === 429
          ? 503
          : 500
      );
    }

    if (!resendData?.id) {
      throw createError(
        'Resend did not return an email ID for the abandoned-checkout email.',
        500
      );
    }

    await markAbandonedEmailSent(
      deliveryId,
      resendData.id
    );

    return {
      emailed: true,
      recipient,
      resendEmailId:
        resendData.id
    };

  } catch (error) {
    await markAbandonedEmailFailed(
      deliveryId,
      error
    );

    throw error;
  }
}


/* ============================================================
   HELPERS
   ============================================================ */

function objectId(value) {
  if (!value) {
    return null;
  }


  if (
    typeof value ===
    'string'
  ) {
    return value;
  }


  if (
    typeof value ===
      'object' &&
    typeof value.id ===
      'string'
  ) {
    return value.id;
  }


  return null;
}


function isOtggCheckoutSession(
  session
) {
  const metadata =
    session?.metadata ||
    {};


  return Boolean(
    metadata.booking_id &&
    metadata.booking_reference
  );
}


/* ============================================================
   SUCCESSFUL CHECKOUT
   ============================================================ */

async function handleSuccessfulCheckout(
  event
) {
  const session =
    event?.data?.object;


  if (
    !session ||
    session.object !==
      'checkout.session'
  ) {
    throw createError(
      'Stripe event did not contain a Checkout Session.',
      400
    );
  }


  /*
   * Ignore Checkout Sessions belonging to something else
   * in the Stripe account.
   */
  if (
    !isOtggCheckoutSession(
      session
    )
  ) {
    return {
      ignored: true,
      reason:
        'not_otgg_checkout'
    };
  }


  if (
    session.mode !==
    'payment'
  ) {
    return {
      ignored: true,
      reason:
        'not_payment_mode'
    };
  }


  /*
   * We currently enable cards only, so completed should
   * normally mean paid.
   *
   * This guard makes the code safe if delayed methods
   * are enabled in future.
   */
  if (
    session.payment_status !==
    'paid'
  ) {
    return {
      ignored: true,
      reason:
        `payment_status_${
          session.payment_status ||
          'unknown'
        }`
    };
  }


  const paymentIntentId =
    objectId(
      session.payment_intent
    );


  if (
    !session.id ||
    !paymentIntentId
  ) {
    throw createError(
      'Paid Stripe Checkout Session is missing required identifiers.',
      400
    );
  }


  const amountReceivedPence =
    Number(
      session.amount_total
    );


  if (
    !Number.isSafeInteger(
      amountReceivedPence
    ) ||
    amountReceivedPence <= 0
  ) {
    throw createError(
      'Paid Stripe Checkout Session has an invalid amount.',
      400
    );
  }


  const currency =
    String(
      session.currency ||
      ''
    )
      .trim()
      .toLowerCase();


  if (
    !/^[a-z]{3}$/
      .test(currency)
  ) {
    throw createError(
      'Paid Stripe Checkout Session has an invalid currency.',
      400
    );
  }


  const stripeCustomerId =
    objectId(
      session.customer
    );


  const paidAt =
    Number.isFinite(
      Number(
        event.created
      )
    )

      ? new Date(
          Number(
            event.created
          ) *
          1000
        )
          .toISOString()

      : new Date()
          .toISOString();


  return supabaseRpc(
    'complete_stripe_payment',
    {
      p_stripe_session_id:
        session.id,

      p_stripe_payment_intent_id:
        paymentIntentId,

      /*
       * We don't actually need the Charge ID to confirm
       * the booking. We can populate it later if required.
       */
      p_stripe_charge_id:
        null,

      p_stripe_customer_id:
        stripeCustomerId,

      p_amount_received_pence:
        amountReceivedPence,

      p_currency:
        currency,

      p_livemode:
        Boolean(
          session.livemode
        ),

      p_payment_method:
        'stripe_card',

      p_paid_at:
        paidAt
    }
  );
}


/* ============================================================
   EXPIRED CHECKOUT
   ============================================================ */

async function handleExpiredCheckout(
  event
) {
  const session =
    event?.data?.object;


  if (
    !session ||
    session.object !==
      'checkout.session' ||
    !session.id
  ) {
    throw createError(
      'Stripe event did not contain a valid Checkout Session.',
      400
    );
  }


  if (
    !isOtggCheckoutSession(
      session
    )
  ) {
    return {
      ignored: true,
      reason:
        'not_otgg_checkout'
    };
  }


  /*
   * Keep the existing expiry process exactly as it is: Supabase is updated
   * first. The internal email below is a secondary notification only.
   */
  const expiryResult =
    await supabaseRpc(
      'expire_stripe_checkout',
      {
        p_stripe_session_id:
          session.id,

        p_livemode:
          Boolean(
            session.livemode
          )
      }
    );

  let abandonedCheckoutEmail = {
    skipped: true
  };

  try {
    abandonedCheckoutEmail =
      await sendAbandonedCheckoutEmail(
        session
      );

  } catch (error) {
    /*
     * Do not change or roll back the working checkout-expiry process if the
     * internal notification itself fails. The failed send is logged in
     * email_deliveries where possible.
     */
    console.error(
      'Abandoned-checkout notification failed',
      {
        stripeSessionId:
          session.id,

        bookingId:
          session?.metadata?.booking_id,

        message:
          error.message
      }
    );

    abandonedCheckoutEmail = {
      emailed: false,
      failed: true,
      error:
        error.message
    };
  }

  return {
    expiryResult,
    abandonedCheckoutEmail
  };
}


/* ============================================================
   NETLIFY HANDLER
   ============================================================ */

exports.handler =
  async function handler(event) {

  if (
    event.httpMethod !==
    'POST'
  ) {
    return response(
      405,
      {
        error:
          'Method not allowed.'
      }
    );
  }


  try {
    const rawBody =
      getRawBody(
        event
      );


    const signatureHeader =
      getHeader(
        event.headers,
        'stripe-signature'
      );


    if (!signatureHeader) {
      throw createError(
        'Missing Stripe-Signature header.',
        400
      );
    }


    /*
     * IMPORTANT:
     *
     * Verify Stripe's signature BEFORE JSON.parse().
     *
     * Changing whitespace, ordering or encoding before
     * verification can invalidate the signature.
     */
    verifyStripeSignature(
      rawBody,
      signatureHeader
    );


    const stripeEvent =
      parseEvent(
        rawBody
      );


    let result = {
      ignored: true
    };


    switch (
      stripeEvent.type
    ) {

      case 'checkout.session.completed':

      case 'checkout.session.async_payment_succeeded':

        result =
          await handleSuccessfulCheckout(
            stripeEvent
          );

        break;


      case 'checkout.session.expired':

        result =
          await handleExpiredCheckout(
            stripeEvent
          );

        break;


      default:

        result = {
          ignored: true,

          eventType:
            stripeEvent.type
        };
    }


    console.log(
      'Stripe webhook processed',
      {
        eventId:
          stripeEvent.id,

        eventType:
          stripeEvent.type,

        result
      }
    );


    return response(
      200,
      {
        received: true
      }
    );

  } catch (error) {

    console.error(
      'stripe-webhook failed',
      {
        message:
          error.message,

        statusCode:
          error.statusCode,

        cause:
          error.cause?.message
      }
    );


    /*
     * Returning a non-2xx response means Stripe knows
     * this delivery was not successfully processed.
     */
    return response(
      error.statusCode ||
      500,
      {
        error:
          error.message ||
          'Webhook processing failed.'
      }
    );
  }
};
