'use strict';

// Netlify Function: netlify/functions/create-balance-checkout.js
//
// Creates (or reuses) a Stripe Checkout Session for the remaining balance on
// a deposit-paid OTGG booking.
//
// Required Netlify environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_SECRET_KEY
//
// Optional:
//   SITE_URL
//
// The browser sends ONLY the unguessable balance-payment token. The amount,
// booking ID, booking reference and customer are all resolved server-side.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 16 * 1024;

// Balance payments do not hold inventory, so they can have a much more relaxed
// Checkout window. Keep it slightly below Stripe's 24-hour maximum.
const CHECKOUT_LIFETIME_SECONDS = (23 * 60 * 60) + (55 * 60);

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

function parseBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    throw createError('The checkout request is too large.', 413);
  }

  try {
    const parsed = JSON.parse(rawBody || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw createError('The checkout request is not valid JSON.');
  }
}

function getSupabaseConfig() {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !serviceKey) {
    throw createError('Missing Supabase server configuration.', 500);
  }

  return { baseUrl, serviceKey };
}

function getStripeConfig() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();

  if (!secretKey) {
    throw createError('Missing STRIPE_SECRET_KEY in Netlify.', 500);
  }

  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
    throw createError('STRIPE_SECRET_KEY does not look like a valid Stripe secret key.', 500);
  }

  return {
    secretKey,
    livemode: secretKey.startsWith('sk_live_')
  };
}

function getSiteUrl() {
  return String(
    process.env.SITE_URL ||
    process.env.URL ||
    'https://onthegreengames.co.uk'
  ).replace(/\/$/, '');
}

async function supabaseRpc(functionName, body) {
  const { baseUrl, serviceKey } = getSupabaseConfig();

  let result;
  try {
    result = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (cause) {
    const error = createError('The checkout service could not reach Supabase.', 502);
    error.cause = cause;
    throw error;
  }

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
    const message =
      data && typeof data === 'object'
        ? data.message || data.details || data.hint
        : null;

    throw createError(
      message || 'Supabase rejected the balance checkout request.',
      result.status >= 500 ? 502 : 400
    );
  }

  return data;
}

async function stripePost(path, params = null) {
  const { secretKey } = getStripeConfig();
  const authorization = Buffer.from(`${secretKey}:`).toString('base64');

  let result;
  try {
    result = await fetch(`https://api.stripe.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params ? params.toString() : ''
    });
  } catch (cause) {
    const error = createError('The checkout service could not reach Stripe.', 502);
    error.cause = cause;
    throw error;
  }

  const raw = await result.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw createError('Stripe returned an invalid response.', 502);
  }

  if (!result.ok) {
    const error = createError(
      data?.error?.message || 'Stripe could not create the balance Checkout Session.',
      result.status >= 500 ? 502 : 400
    );
    error.stripeType = data?.error?.type;
    error.stripeCode = data?.error?.code;
    throw error;
  }

  return data;
}

async function expireStripeSession(sessionId) {
  if (!sessionId) return;

  try {
    await stripePost(
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`
    );
  } catch (error) {
    console.error('Could not expire Stripe balance Session after registration failed.', {
      sessionId,
      message: error.message
    });
  }
}

async function createStripeCheckout(checkout) {
  const siteUrl = getSiteUrl();
  const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_LIFETIME_SECONDS;
  const token = String(checkout.balance_payment_token || '').trim();

  if (!UUID_REGEX.test(token)) {
    throw createError('The prepared balance payment token is invalid.', 500);
  }

  const params = new URLSearchParams();

  params.set('mode', 'payment');
  params.append('payment_method_types[]', 'card');
  params.set('client_reference_id', checkout.booking_id);

  params.set(
    'success_url',
    `${siteUrl}/booking-confirmed.html?session_id={CHECKOUT_SESSION_ID}`
  );

  params.set(
    'cancel_url',
    `${siteUrl}/pay-balance.html?token=${encodeURIComponent(token)}&payment=cancelled`
  );

  params.set('expires_at', String(expiresAt));

  params.set('line_items[0][price_data][currency]', checkout.currency);
  params.set('line_items[0][price_data][unit_amount]', String(checkout.amount_pence));
  params.set('line_items[0][price_data][product_data][name]', 'Wedding booking balance');
  params.set(
    'line_items[0][price_data][product_data][description]',
    `Remaining wedding booking balance — ${checkout.booking_reference}`
  );
  params.set('line_items[0][quantity]', '1');

  params.set('metadata[booking_id]', checkout.booking_id);
  params.set('metadata[booking_reference]', checkout.booking_reference);
  params.set('metadata[payment_type]', 'balance');
  params.set('metadata[otgg_customer_id]', checkout.customer_id);

  params.set('payment_intent_data[metadata][booking_id]', checkout.booking_id);
  params.set('payment_intent_data[metadata][booking_reference]', checkout.booking_reference);
  params.set('payment_intent_data[metadata][payment_type]', 'balance');
  params.set('payment_intent_data[metadata][otgg_customer_id]', checkout.customer_id);
  params.set(
    'payment_intent_data[description]',
    `On The Green Games — ${checkout.booking_reference} — balance`
  );
  params.set(
  'payment_intent_data[receipt_email]',
  checkout.customer_email
);

  if (checkout.stripe_customer_id) {
    params.set('customer', checkout.stripe_customer_id);
  } else {
    params.set('customer_creation', 'always');
    params.set('customer_email', checkout.customer_email);
  }

  return stripePost('/v1/checkout/sessions', params);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return response(204, {});
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed.' });
  }

  let stripeSession = null;

  try {
    const body = parseBody(event);
    const token = String(body.token || body.balanceToken || '').trim();

    if (!UUID_REGEX.test(token)) {
      throw createError('This balance payment link is not valid.', 404);
    }

    const { livemode } = getStripeConfig();

    const checkout = await supabaseRpc(
      'prepare_balance_stripe_checkout',
      {
        p_token: token,
        p_livemode: livemode
      }
    );

    if (!checkout || typeof checkout !== 'object' || Array.isArray(checkout)) {
      throw createError('Supabase returned invalid checkout information.', 502);
    }

    // Reuse an already-open pending balance Checkout rather than creating a
    // second payment attempt for the same outstanding amount.
    if (
      checkout.existing_checkout_url &&
      checkout.existing_checkout_session_id &&
      checkout.existing_checkout_expires_at &&
      new Date(checkout.existing_checkout_expires_at).getTime() > Date.now()
    ) {
      return response(200, {
        bookingReference: checkout.booking_reference,
        paymentType: 'balance',
        amount: checkout.amount,
        amountPence: checkout.amount_pence,
        currency: checkout.currency,
        checkoutSessionId: checkout.existing_checkout_session_id,
        checkoutUrl: checkout.existing_checkout_url,
        expiresAt: checkout.existing_checkout_expires_at,
        livemode,
        reused: true
      });
    }

    if (!Number.isInteger(Number(checkout.amount_pence)) || Number(checkout.amount_pence) <= 0) {
      throw createError('The booking has an invalid remaining balance.', 500);
    }

    stripeSession = await createStripeCheckout(checkout);

    if (!stripeSession?.id || !stripeSession?.url || !stripeSession?.expires_at) {
      throw createError('Stripe created an incomplete Checkout Session.', 502);
    }

    if (Number(stripeSession.amount_total) !== Number(checkout.amount_pence)) {
      throw createError('Stripe Checkout amount does not match the OTGG balance.', 502);
    }

    if (
      String(stripeSession.currency || '').toLowerCase() !==
      String(checkout.currency || '').toLowerCase()
    ) {
      throw createError('Stripe Checkout currency does not match the OTGG balance.', 502);
    }

    if (Boolean(stripeSession.livemode) !== Boolean(livemode)) {
      throw createError('Stripe Checkout mode does not match the configured Stripe key.', 502);
    }

    let registered;

    try {
      registered = await supabaseRpc(
        'register_stripe_checkout',
        {
          p_booking_id: checkout.booking_id,
          p_payment_type: 'balance',
          p_livemode: livemode,
          p_stripe_session_id: stripeSession.id,
          p_checkout_url: stripeSession.url,
          p_checkout_expires_at: new Date(stripeSession.expires_at * 1000).toISOString(),
          p_stripe_customer_id:
            stripeSession.customer || checkout.stripe_customer_id || null
        }
      );
    } catch (error) {
      await expireStripeSession(stripeSession.id);
      throw error;
    }

    return response(201, {
      bookingReference: checkout.booking_reference,
      paymentId: registered?.payment_id,
      paymentType: 'balance',
      amount: checkout.amount,
      amountPence: checkout.amount_pence,
      currency: checkout.currency,
      checkoutSessionId: stripeSession.id,
      checkoutUrl: stripeSession.url,
      expiresAt: new Date(stripeSession.expires_at * 1000).toISOString(),
      livemode: Boolean(stripeSession.livemode),
      reused: false
    });

  } catch (error) {
    if (stripeSession?.id) {
      await expireStripeSession(stripeSession.id);
    }

    console.error('create-balance-checkout failed', {
      message: error.message,
      statusCode: error.statusCode,
      stripeType: error.stripeType,
      stripeCode: error.stripeCode,
      cause: error.cause?.message
    });

    return response(error.statusCode || 400, {
      error: error.message || 'Balance checkout could not be created.'
    });
  }
};
