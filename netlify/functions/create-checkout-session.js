'use strict';

/*
 * Netlify Function:
 * netlify/functions/create-checkout-session.js
 *
 * Creates a Stripe-hosted Checkout Session for an existing OTGG booking.
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY
 *
 * Optional:
 *   SITE_URL
 *
 * IMPORTANT:
 * The browser NEVER supplies a trusted price.
 *
 * The amount and event date are obtained from Supabase via:
 *   public.prepare_stripe_checkout(...)
 *
 * Short-notice rule:
 * If the wedding is fewer than 14 calendar days away,
 * a deposit Checkout is rejected server-side and the
 * booking must be paid in full.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 16 * 1024;
const CHECKOUT_LIFETIME_SECONDS = (30 * 60) + 15;


/* ============================================================
   RESPONSE HELPERS
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
   DATE / SHORT-NOTICE RULE
   ============================================================ */

function londonTodayParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter(part => ['year', 'month', 'day'].includes(part.type))
      .map(part => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day
  };
}


function daysUntilEventInLondon(eventDate) {
  const match = String(eventDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw createError(
      'The booking has an invalid wedding date.',
      500
    );
  }

  const today = londonTodayParts();

  const todayUtc = Date.UTC(
    today.year,
    today.month - 1,
    today.day
  );

  const eventUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

  return Math.round(
    (eventUtc - todayUtc) / 86400000
  );
}


function assertPaymentTypeAllowedForDate(checkout) {
  if (checkout.payment_type !== 'deposit') {
    return;
  }

  const daysUntilEvent =
    daysUntilEventInLondon(
      checkout.event_date
    );

  if (
    daysUntilEvent >= 0 &&
    daysUntilEvent < 14
  ) {
    throw createError(
      'Full payment is required for bookings made less than 14 days before the wedding.',
      400
    );
  }
}


/* ============================================================
   REQUEST BODY
   ============================================================ */

function parseBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer
        .from(event.body || '', 'base64')
        .toString('utf8')
    : event.body || '';

  if (
    Buffer.byteLength(rawBody, 'utf8') >
    MAX_BODY_BYTES
  ) {
    throw createError(
      'The checkout request is too large.',
      413
    );
  }

  try {
    const parsed = JSON.parse(rawBody || '{}');

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error();
    }

    return parsed;

  } catch (error) {
    throw createError(
      'The checkout request is not valid JSON.'
    );
  }
}


/* ============================================================
   CONFIG
   ============================================================ */

function getSupabaseConfig() {
  const baseUrl =
    String(process.env.SUPABASE_URL || '')
      .replace(/\/$/, '');

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !serviceKey) {
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


function getStripeConfig() {
  const secretKey =
    String(process.env.STRIPE_SECRET_KEY || '')
      .trim();

  if (!secretKey) {
    throw createError(
      'Missing STRIPE_SECRET_KEY in Netlify.',
      500
    );
  }

  if (
    !secretKey.startsWith('sk_test_') &&
    !secretKey.startsWith('sk_live_')
  ) {
    throw createError(
      'STRIPE_SECRET_KEY does not look like a valid Stripe secret key.',
      500
    );
  }

  return {
    secretKey,
    livemode:
      secretKey.startsWith('sk_live_')
  };
}


function getSiteUrl() {
  return String(
    process.env.SITE_URL ||
    'https://onthegreengames.co.uk'
  ).replace(/\/$/, '');
}


/* ============================================================
   SUPABASE
   ============================================================ */

async function supabaseRpc(functionName, body) {
  const {
    baseUrl,
    serviceKey
  } = getSupabaseConfig();

  let result;

  try {
    result = await fetch(
      `${baseUrl}/rest/v1/rpc/${functionName}`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

  } catch (cause) {
    const error = createError(
      'The checkout service could not reach Supabase.',
      502
    );

    error.cause = cause;
    throw error;
  }

  const raw = await result.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      data = raw;
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
      'Supabase rejected the checkout request.',
      result.status >= 500
        ? 502
        : 400
    );
  }

  return data;
}


/* ============================================================
   STRIPE
   ============================================================ */

async function stripePost(path, params = null) {
  const {
    secretKey
  } = getStripeConfig();

  const authorization =
    Buffer
      .from(`${secretKey}:`)
      .toString('base64');

  let result;

  try {
    result = await fetch(
      `https://api.stripe.com${path}`,
      {
        method: 'POST',
        headers: {
          Authorization:
            `Basic ${authorization}`,
          Accept: 'application/json',
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body:
          params
            ? params.toString()
            : ''
      }
    );

  } catch (cause) {
    const error = createError(
      'The checkout service could not reach Stripe.',
      502
    );

    error.cause = cause;
    throw error;
  }

  const raw = await result.text();
  let data = null;

  try {
    data = raw
      ? JSON.parse(raw)
      : {};

  } catch (error) {
    throw createError(
      'Stripe returned an invalid response.',
      502
    );
  }

  if (!result.ok) {
    const stripeMessage =
      data?.error?.message;

    const error = createError(
      stripeMessage ||
      'Stripe could not create the Checkout Session.',
      result.status >= 500
        ? 502
        : 400
    );

    error.stripeType =
      data?.error?.type;

    error.stripeCode =
      data?.error?.code;

    throw error;
  }

  return data;
}


/* ============================================================
   CHECKOUT LINE ITEM
   ============================================================ */

function getCheckoutDescription(
  paymentType,
  bookingReference
) {
  if (paymentType === 'deposit') {
    return {
      name:
        'Wedding booking deposit',
      description:
        `25% booking deposit — ${bookingReference}`
    };
  }

  if (paymentType === 'full') {
    return {
      name:
        'Wedding booking — full payment',
      description:
        `Full wedding booking payment — ${bookingReference}`
    };
  }

  return {
    name:
      'Wedding booking balance',
    description:
      `Remaining wedding booking balance — ${bookingReference}`
  };
}


/* ============================================================
   CREATE STRIPE CHECKOUT SESSION
   ============================================================ */

async function createStripeCheckout(checkout) {
  const siteUrl =
    getSiteUrl();

  const expiresAt =
    Math.floor(Date.now() / 1000) +
    CHECKOUT_LIFETIME_SECONDS;

  const product =
    getCheckoutDescription(
      checkout.payment_type,
      checkout.booking_reference
    );

  const params =
    new URLSearchParams();

  params.set(
    'mode',
    'payment'
  );

  params.append(
    'payment_method_types[]',
    'card'
  );

  params.set(
    'client_reference_id',
    checkout.booking_id
  );

  params.set(
    'success_url',
    `${siteUrl}/booking-confirmed.html?session_id={CHECKOUT_SESSION_ID}`
  );

  params.set(
    'cancel_url',
    `${siteUrl}/booking.html?payment=cancelled`
  );

  params.set(
    'expires_at',
    String(expiresAt)
  );

  params.set(
    'line_items[0][price_data][currency]',
    checkout.currency
  );

  params.set(
    'line_items[0][price_data][unit_amount]',
    String(checkout.amount_pence)
  );

  params.set(
    'line_items[0][price_data][product_data][name]',
    product.name
  );

  params.set(
    'line_items[0][price_data][product_data][description]',
    product.description
  );

  params.set(
    'line_items[0][quantity]',
    '1'
  );

  params.set(
    'metadata[booking_id]',
    checkout.booking_id
  );

  params.set(
    'metadata[booking_reference]',
    checkout.booking_reference
  );

  params.set(
    'metadata[payment_type]',
    checkout.payment_type
  );

  params.set(
    'metadata[otgg_customer_id]',
    checkout.customer_id
  );

  params.set(
    'payment_intent_data[metadata][booking_id]',
    checkout.booking_id
  );

  params.set(
    'payment_intent_data[metadata][booking_reference]',
    checkout.booking_reference
  );

  params.set(
    'payment_intent_data[metadata][payment_type]',
    checkout.payment_type
  );

  params.set(
    'payment_intent_data[metadata][otgg_customer_id]',
    checkout.customer_id
  );

  params.set(
    'payment_intent_data[description]',
    `On The Green Games — ${checkout.booking_reference}`
  );

  if (checkout.stripe_customer_id) {
    params.set(
      'customer',
      checkout.stripe_customer_id
    );

  } else {
    params.set(
      'customer_creation',
      'always'
    );

    params.set(
      'customer_email',
      checkout.customer_email
    );
  }

  return stripePost(
    '/v1/checkout/sessions',
    params
  );
}


/* ============================================================
   EXPIRE A STRIPE SESSION
   Used only for error cleanup.
   ============================================================ */

async function expireStripeSession(sessionId) {
  if (!sessionId) {
    return;
  }

  try {
    await stripePost(
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`
    );

  } catch (error) {
    console.error(
      'Could not expire Stripe Session after checkout registration failed.',
      {
        sessionId,
        message: error.message
      }
    );
  }
}


/* ============================================================
   HANDLER
   ============================================================ */

exports.handler =
  async function handler(event) {

  if (event.httpMethod === 'OPTIONS') {
    return response(
      204,
      {}
    );
  }

  if (event.httpMethod !== 'POST') {
    return response(
      405,
      {
        error:
          'Method not allowed.'
      }
    );
  }

  let stripeSession =
    null;

  try {
    const body =
      parseBody(event);

    const bookingId =
      String(
        body.bookingId ||
        body.booking_id ||
        ''
      ).trim();

    const paymentType =
      String(
        body.paymentType ||
        body.payment_type ||
        ''
      )
        .trim()
        .toLowerCase();

    if (!UUID_REGEX.test(bookingId)) {
      throw createError(
        'A valid booking ID is required.'
      );
    }

    if (
      ![
        'deposit',
        'full',
        'balance'
      ].includes(paymentType)
    ) {
      throw createError(
        'Payment type must be deposit, full or balance.'
      );
    }

    const {
      livemode
    } = getStripeConfig();

    /*
     * STEP 1
     *
     * Ask Supabase for the authoritative payment amount,
     * booking date and booking/customer identity.
     */
    const checkout =
      await supabaseRpc(
        'prepare_stripe_checkout',
        {
          p_booking_id:
            bookingId,

          p_payment_type:
            paymentType,

          p_livemode:
            livemode
        }
      );

    if (
      !checkout ||
      typeof checkout !== 'object' ||
      Array.isArray(checkout)
    ) {
      throw createError(
        'Supabase returned invalid checkout information.',
        502
      );
    }

    /*
     * Short-notice policy.
     *
     * This is deliberately enforced on the server as well
     * as hidden in the booking-page UI, so a customer
     * cannot bypass the rule by changing browser code.
     */
    assertPaymentTypeAllowedForDate(
      checkout
    );

    if (
      !Number.isInteger(
        Number(checkout.amount_pence)
      ) ||
      Number(checkout.amount_pence) <= 0
    ) {
      throw createError(
        'The booking has an invalid payment amount.',
        500
      );
    }

    /*
     * STEP 2
     *
     * Create the Stripe-hosted Checkout Session.
     */
    stripeSession =
      await createStripeCheckout(
        checkout
      );

    if (
      !stripeSession?.id ||
      !stripeSession?.url ||
      !stripeSession?.expires_at
    ) {
      throw createError(
        'Stripe created an incomplete Checkout Session.',
        502
      );
    }

    if (
      Number(stripeSession.amount_total) !==
      Number(checkout.amount_pence)
    ) {
      throw createError(
        'Stripe Checkout amount does not match the OTGG payment amount.',
        502
      );
    }

    if (
      String(
        stripeSession.currency ||
        ''
      ).toLowerCase() !==
      String(
        checkout.currency ||
        ''
      ).toLowerCase()
    ) {
      throw createError(
        'Stripe Checkout currency does not match the OTGG payment currency.',
        502
      );
    }

    if (
      Boolean(stripeSession.livemode) !==
      Boolean(livemode)
    ) {
      throw createError(
        'Stripe Checkout mode does not match the configured Stripe key.',
        502
      );
    }

    /*
     * STEP 3
     *
     * Record the pending Stripe Checkout Session in Supabase.
     */
    let registered;

    try {
      registered =
        await supabaseRpc(
          'register_stripe_checkout',
          {
            p_booking_id:
              checkout.booking_id,

            p_payment_type:
              checkout.payment_type,

            p_livemode:
              livemode,

            p_stripe_session_id:
              stripeSession.id,

            p_checkout_url:
              stripeSession.url,

            p_checkout_expires_at:
              new Date(
                stripeSession.expires_at *
                1000
              ).toISOString(),

            p_stripe_customer_id:
              stripeSession.customer ||
              checkout.stripe_customer_id ||
              null
          }
        );

    } catch (error) {
      await expireStripeSession(
        stripeSession.id
      );

      throw error;
    }

    return response(
      201,
      {
        bookingId:
          checkout.booking_id,

        bookingReference:
          checkout.booking_reference,

        paymentId:
          registered?.payment_id,

        paymentType:
          checkout.payment_type,

        amount:
          checkout.amount,

        amountPence:
          checkout.amount_pence,

        currency:
          checkout.currency,

        checkoutSessionId:
          stripeSession.id,

        checkoutUrl:
          stripeSession.url,

        expiresAt:
          new Date(
            stripeSession.expires_at *
            1000
          ).toISOString(),

        livemode:
          Boolean(
            stripeSession.livemode
          )
      }
    );

  } catch (error) {
    if (stripeSession?.id) {
      await expireStripeSession(
        stripeSession.id
      );
    }

    console.error(
      'create-checkout-session failed',
      {
        message:
          error.message,

        statusCode:
          error.statusCode,

        stripeType:
          error.stripeType,

        stripeCode:
          error.stripeCode,

        cause:
          error.cause?.message
      }
    );

    return response(
      error.statusCode ||
      400,
      {
        error:
          error.message ||
          'Checkout could not be created.'
      }
    );
  }
};
