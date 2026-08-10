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
 * If SITE_URL is not provided, production defaults to:
 *   https://onthegreengames.co.uk
 *
 * IMPORTANT:
 * The browser NEVER supplies a trusted price.
 *
 * The amount is obtained from Supabase via:
 *   public.prepare_stripe_checkout(...)
 *
 * After Stripe creates the Checkout Session, it is registered via:
 *   public.register_stripe_checkout(...)
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 16 * 1024;

/*
 * Stripe requires Checkout expires_at to be at least
 * 30 minutes after the Session is created.
 *
 * We calculate the timestamp immediately BEFORE asking Stripe
 * to create the Session, so a tiny safety buffer prevents the
 * timestamp falling just below Stripe's minimum while the HTTP
 * request is travelling.
 *
 * Customer-facing window is therefore approximately 30 minutes.
 */
const CHECKOUT_LIFETIME_SECONDS =
  (30 * 60) + 15;


/* ============================================================
   RESPONSE HELPERS
   ============================================================ */

function response(
  statusCode,
  body
) {

  return {

    statusCode,

    headers: {
      'Content-Type':
        'application/json; charset=utf-8',

      'Cache-Control':
        'no-store'
    },

    body:
      JSON.stringify(body)

  };

}


function createError(
  message,
  statusCode = 400
) {

  const error =
    new Error(message);

  error.statusCode =
    statusCode;

  return error;

}


/* ============================================================
   REQUEST BODY
   ============================================================ */

function parseBody(event) {

  const rawBody =
    event.isBase64Encoded

      ? Buffer
          .from(
            event.body || '',
            'base64'
          )
          .toString('utf8')

      : event.body || '';


  if(
    Buffer.byteLength(
      rawBody,
      'utf8'
    ) > MAX_BODY_BYTES
  ){

    throw createError(
      'The checkout request is too large.',
      413
    );

  }


  try{

    const parsed =
      JSON.parse(
        rawBody || '{}'
      );


    if(
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ){

      throw new Error();

    }


    return parsed;

  }catch(error){

    throw createError(
      'The checkout request is not valid JSON.'
    );

  }

}


/* ============================================================
   CONFIG
   ============================================================ */

function getSupabaseConfig(){

  const baseUrl =
    String(
      process.env.SUPABASE_URL ||
      ''
    )
      .replace(/\/$/, '');


  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;


  if(
    !baseUrl ||
    !serviceKey
  ){

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


function getStripeConfig(){

  const secretKey =
    String(
      process.env.STRIPE_SECRET_KEY ||
      ''
    )
      .trim();


  if(!secretKey){

    throw createError(
      'Missing STRIPE_SECRET_KEY in Netlify.',
      500
    );

  }


  /*
   * We currently expect a standard Stripe secret key.
   */
  if(
    !secretKey.startsWith('sk_test_') &&
    !secretKey.startsWith('sk_live_')
  ){

    throw createError(
      'STRIPE_SECRET_KEY does not look like a valid Stripe secret key.',
      500
    );

  }


  const livemode =
    secretKey.startsWith(
      'sk_live_'
    );


  return {
    secretKey,
    livemode
  };

}


function getSiteUrl(){

  return String(
    process.env.SITE_URL ||
    'https://onthegreengames.co.uk'
  )
    .replace(/\/$/, '');

}


/* ============================================================
   SUPABASE
   ============================================================ */

async function supabaseRpc(
  functionName,
  body
){

  const {
    baseUrl,
    serviceKey
  } = getSupabaseConfig();


  let result;

  try{

    result =
      await fetch(
        `${baseUrl}/rest/v1/rpc/${functionName}`,
        {

          method:'POST',

          headers:{
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
            JSON.stringify(body)

        }
      );

  }catch(cause){

    const error =
      createError(
        'The checkout service could not reach Supabase.',
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


  if(raw){

    try{

      data =
        JSON.parse(raw);

    }catch(error){

      data =
        raw;

    }

  }


  if(!result.ok){

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

async function stripePost(
  path,
  params = null
){

  const {
    secretKey
  } = getStripeConfig();


  /*
   * Stripe's API uses the secret key as the HTTP Basic
   * username, with a blank password.
   */
  const authorization =
    Buffer
      .from(
        `${secretKey}:`
      )
      .toString(
        'base64'
      );


  let result;

  try{

    result =
      await fetch(
        `https://api.stripe.com${path}`,
        {

          method:'POST',

          headers:{
            Authorization:
              `Basic ${authorization}`,

            Accept:
              'application/json',

            'Content-Type':
              'application/x-www-form-urlencoded'
          },

          body:
            params
              ? params.toString()
              : ''

        }
      );

  }catch(cause){

    const error =
      createError(
        'The checkout service could not reach Stripe.',
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


  try{

    data =
      raw
        ? JSON.parse(raw)
        : {};

  }catch(error){

    throw createError(
      'Stripe returned an invalid response.',
      502
    );

  }


  if(!result.ok){

    const stripeMessage =
      data?.error?.message;


    const error =
      createError(
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
){

  if(
    paymentType ===
    'deposit'
  ){

    return {
      name:
        'Wedding booking deposit',

      description:
        `25% booking deposit — ${bookingReference}`
    };

  }


  if(
    paymentType ===
    'full'
  ){

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

async function createStripeCheckout(
  checkout
){

  const siteUrl =
    getSiteUrl();


  const expiresAt =
    Math.floor(
      Date.now() / 1000
    ) +
    CHECKOUT_LIFETIME_SECONDS;


  const product =
    getCheckoutDescription(
      checkout.payment_type,
      checkout.booking_reference
    );


  const params =
    new URLSearchParams();


  /*
   * One-off Stripe payment.
   */
  params.set(
    'mode',
    'payment'
  );


  /*
   * Only instant card-family payments for now.
   *
   * This avoids delayed payment methods complicating
   * the 30-minute wedding-date reservation.
   */
  params.append(
    'payment_method_types[]',
    'card'
  );


  /*
   * Link Stripe directly back to OTGG.
   */
  params.set(
    'client_reference_id',
    checkout.booking_id
  );


  /*
   * Temporary URLs.
   *
   * We will replace the success flow with the dedicated
   * confirmation page later.
   */
  params.set(
  'success_url',
  `${siteUrl}/booking-confirmed.html?session_id={CHECKOUT_SESSION_ID}`
);


  params.set(
    'cancel_url',
    `${siteUrl}/booking.html?payment=cancelled`
  );


  /*
   * Stripe Checkout expiry.
   */
  params.set(
    'expires_at',
    String(expiresAt)
  );


  /*
   * Dynamic price.
   *
   * This amount came from Supabase — NOT the browser.
   */
  params.set(
    'line_items[0][price_data][currency]',
    checkout.currency
  );


  params.set(
    'line_items[0][price_data][unit_amount]',
    String(
      checkout.amount_pence
    )
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


  /*
   * Checkout Session metadata.
   */
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


  /*
   * Copy the important OTGG metadata onto the resulting
   * PaymentIntent too.
   *
   * That means both the Checkout Session and PaymentIntent
   * independently identify the OTGG booking.
   */
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


  /*
   * Existing Stripe customer:
   * reuse them.
   *
   * New Stripe customer:
   * Checkout creates one when payment is attempted.
   */
  if(
    checkout.stripe_customer_id
  ){

    params.set(
      'customer',
      checkout.stripe_customer_id
    );

  }else{

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

async function expireStripeSession(
  sessionId
){

  if(!sessionId){
    return;
  }


  try{

    await stripePost(
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`
    );

  }catch(error){

    /*
     * Don't mask the original error if cleanup itself fails.
     */
    console.error(
      'Could not expire Stripe Session after checkout registration failed.',
      {
        sessionId,
        message:error.message
      }
    );

  }

}


/* ============================================================
   HANDLER
   ============================================================ */

exports.handler =
  async function handler(event){

  if(
    event.httpMethod ===
    'OPTIONS'
  ){

    return response(
      204,
      {}
    );

  }


  if(
    event.httpMethod !==
    'POST'
  ){

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


  try{

    const body =
      parseBody(event);


    const bookingId =
      String(
        body.bookingId ||
        body.booking_id ||
        ''
      )
        .trim();


    const paymentType =
      String(
        body.paymentType ||
        body.payment_type ||
        ''
      )
        .trim()
        .toLowerCase();


    if(
      !UUID_REGEX.test(
        bookingId
      )
    ){

      throw createError(
        'A valid booking ID is required.'
      );

    }


    /*
     * Initial website Checkout currently supports:
     *
     * deposit
     * full
     *
     * balance is already supported here for the later
     * balance-payment-link stage.
     */
    if(
      ![
        'deposit',
        'full',
        'balance'
      ].includes(
        paymentType
      )
    ){

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
     * Ask Supabase for the authoritative payment amount.
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


    if(
      !checkout ||
      typeof checkout !==
        'object' ||
      Array.isArray(checkout)
    ){

      throw createError(
        'Supabase returned invalid checkout information.',
        502
      );

    }


    if(
      !Number.isInteger(
        Number(
          checkout.amount_pence
        )
      ) ||
      Number(
        checkout.amount_pence
      ) <= 0
    ){

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


    if(
      !stripeSession?.id ||
      !stripeSession?.url ||
      !stripeSession?.expires_at
    ){

      throw createError(
        'Stripe created an incomplete Checkout Session.',
        502
      );

    }


    /*
     * Additional server-side checks.
     */
    if(
      Number(
        stripeSession.amount_total
      ) !==
      Number(
        checkout.amount_pence
      )
    ){

      throw createError(
        'Stripe Checkout amount does not match the OTGG payment amount.',
        502
      );

    }


    if(
      String(
        stripeSession.currency ||
        ''
      ).toLowerCase() !==
      String(
        checkout.currency ||
        ''
      ).toLowerCase()
    ){

      throw createError(
        'Stripe Checkout currency does not match the OTGG payment currency.',
        502
      );

    }


    if(
      Boolean(
        stripeSession.livemode
      ) !==
      Boolean(
        livemode
      )
    ){

      throw createError(
        'Stripe Checkout mode does not match the configured Stripe key.',
        502
      );

    }


    /*
     * STEP 3
     *
     * Record the pending Stripe Checkout Session in Supabase.
     *
     * If this fails, we immediately expire the Stripe Session so
     * there isn't an untracked payment page still capable of
     * taking money.
     */
    let registered;


    try{

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
              )
                .toISOString(),

            p_stripe_customer_id:
              stripeSession.customer ||
              checkout.stripe_customer_id ||
              null

          }
        );

    }catch(error){

      await expireStripeSession(
        stripeSession.id
      );


      throw error;

    }


    /*
     * Return ONLY what the browser needs.
     */
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
          )
            .toISOString(),

        livemode:
          Boolean(
            stripeSession.livemode
          )

      }
    );


  }catch(error){

    /*
     * A Stripe Session might have been created and then failed one
     * of our own validation checks BEFORE registration.
     *
     * Expire it so it cannot remain usable.
     */
    if(
      stripeSession?.id
    ){

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
