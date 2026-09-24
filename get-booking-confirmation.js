'use strict';

// Netlify Function: netlify/functions/get-booking-confirmation.js
//
// Returns a small, non-sensitive confirmation summary for a Stripe Checkout
// Session after the customer returns from Stripe.
//
// Required Netlify environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_SECRET_KEY
//
// The browser provides only the Stripe Checkout Session ID. This function
// retrieves that Session directly from Stripe, verifies that it belongs to an
// OTGG booking, then reads the authoritative booking/payment state from
// Supabase. No prices or booking statuses are trusted from the browser.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function getConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const stripeKey = String(process.env.STRIPE_SECRET_KEY || '').trim();

  if (!supabaseUrl || !serviceKey) {
    throw createError('Missing Supabase server configuration.', 500);
  }

  if (!stripeKey) {
    throw createError('Missing STRIPE_SECRET_KEY in Netlify.', 500);
  }

  return { supabaseUrl, serviceKey, stripeKey };
}

async function stripeGetSession(sessionId) {
  const { stripeKey } = getConfig();
  const authorization = Buffer.from(`${stripeKey}:`).toString('base64');

  let result;
  try {
    result = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${authorization}`,
          Accept: 'application/json'
        }
      }
    );
  } catch (cause) {
    const error = createError('The confirmation service could not reach Stripe.', 502);
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
    const stripeMessage = data?.error?.message;
    throw createError(
      stripeMessage || 'The Stripe Checkout Session could not be found.',
      result.status === 404 ? 404 : result.status >= 500 ? 502 : 400
    );
  }

  return data;
}

async function supabaseGet(path) {
  const { supabaseUrl, serviceKey } = getConfig();

  let result;
  try {
    result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json'
      }
    });
  } catch (cause) {
    const error = createError('The confirmation service could not reach Supabase.', 502);
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
      message || 'Supabase rejected the confirmation request.',
      result.status >= 500 ? 502 : 400
    );
  }

  return data;
}

function moneyNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return response(405, { error: 'Method not allowed.' });
  }

  try {
    const sessionId = String(
      event.queryStringParameters?.session_id ||
      event.queryStringParameters?.sessionId ||
      ''
    ).trim();

    if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) {
      throw createError('A valid Stripe Checkout Session ID is required.');
    }

    // Stripe is the authoritative source for the Checkout Session identity and
    // whether the customer completed payment.
    const session = await stripeGetSession(sessionId);

    if (session.object !== 'checkout.session' || session.mode !== 'payment') {
      throw createError('This is not a valid OTGG payment Checkout Session.');
    }

    const metadata = session.metadata || {};
    const bookingId = String(metadata.booking_id || '').trim();
    const bookingReferenceFromStripe = String(metadata.booking_reference || '').trim();
    const paymentTypeFromStripe = String(metadata.payment_type || '').trim().toLowerCase();

    if (!UUID_REGEX.test(bookingId) || !bookingReferenceFromStripe) {
      throw createError('This Checkout Session is not linked to an OTGG booking.', 404);
    }

    if (!['deposit', 'full', 'balance'].includes(paymentTypeFromStripe)) {
      throw createError('This Checkout Session has an invalid OTGG payment type.', 400);
    }

    const bookingRows = await supabaseGet(
      `bookings?id=eq.${encodeURIComponent(bookingId)}` +
      '&select=id,booking_reference,event_date,status,total_price,deposit_required,balance_due_date,expires_at,balance_payment_token'
    );

    const booking = Array.isArray(bookingRows) ? bookingRows[0] : null;

    if (!booking || booking.booking_reference !== bookingReferenceFromStripe) {
      throw createError('The booking linked to this payment could not be found.', 404);
    }

    const paymentRows = await supabaseGet(
      `payments?booking_id=eq.${encodeURIComponent(bookingId)}` +
      '&select=id,payment_type,amount,currency,payment_status,stripe_session_id,paid_at,created_at' +
      '&order=created_at.asc'
    );

    const payments = Array.isArray(paymentRows) ? paymentRows : [];
    const currentPayment = payments.find(
      payment => payment.stripe_session_id === sessionId
    ) || null;

    // A Session created by our checkout function should always have a matching
    // public.payments row. Treat its absence as still processing rather than
    // inventing confirmation data.
    const paidBookingPayments = payments.filter(
      payment =>
        payment.payment_status === 'paid' &&
        ['deposit', 'balance', 'full'].includes(payment.payment_type)
    );

    const totalPaid = moneyNumber(
      paidBookingPayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      )
    );

    const totalPrice = moneyNumber(booking.total_price);
    const remainingBalance = Math.max(
      0,
      moneyNumber(totalPrice - totalPaid)
    );

    const stripePaid = session.payment_status === 'paid';
    const databasePaymentPaid = currentPayment?.payment_status === 'paid';
    const bookingConfirmed = ['confirmed_part_paid', 'paid', 'completed'].includes(
      booking.status
    );

    const confirmed = Boolean(
      stripePaid &&
      databasePaymentPaid &&
      bookingConfirmed
    );

    let state = 'processing';

    if (confirmed) {
      state = 'confirmed';
    } else if (!stripePaid) {
      state = 'not_paid';
    }

    return response(200, {
      state,
      confirmed,
      bookingReference: booking.booking_reference,
      eventDate: booking.event_date,
      bookingStatus: booking.status,
      totalPrice,
      depositRequired: moneyNumber(booking.deposit_required),
      balanceDueDate: booking.balance_due_date || null,
      paymentType: paymentTypeFromStripe,
      currentPaymentAmount: currentPayment
        ? moneyNumber(currentPayment.amount)
        : moneyNumber(Number(session.amount_total || 0) / 100),
      currentPaymentStatus: currentPayment?.payment_status || 'processing',
      totalPaid,
      remainingBalance,
      currency: String(session.currency || 'gbp').toLowerCase(),
      stripePaymentStatus: session.payment_status || null,
      paidAt: currentPayment?.paid_at || null,
      balancePaymentUrl:
        confirmed &&
        booking.status === 'confirmed_part_paid' &&
        remainingBalance > 0.005 &&
        booking.balance_payment_token
          ? `/pay-balance.html?token=${encodeURIComponent(booking.balance_payment_token)}`
          : null
    });

  } catch (error) {
    console.error('get-booking-confirmation failed', {
      message: error.message,
      statusCode: error.statusCode,
      cause: error.cause?.message
    });

    return response(error.statusCode || 500, {
      error: error.message || 'We could not load your booking confirmation.'
    });
  }
};
