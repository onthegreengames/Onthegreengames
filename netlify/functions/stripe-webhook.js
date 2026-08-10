'use strict';

const crypto = require('crypto');

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 256 * 1024;


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


  return supabaseRpc(
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
