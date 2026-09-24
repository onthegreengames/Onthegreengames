'use strict';

// Netlify Function: netlify/functions/get-balance-payment.js
//
// Returns a small, non-sensitive summary for a secure balance-payment link.
// The browser provides only an unguessable balance-payment token.
// All booking/payment data is read server-side using the Supabase service role.

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

function getSupabaseConfig() {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !serviceKey) {
    throw createError('Missing Supabase server configuration.', 500);
  }

  return { baseUrl, serviceKey };
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
    const error = createError('The balance service could not reach Supabase.', 502);
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

    const statusCode =
      /not valid|not currently eligible|not found/i.test(message || '')
        ? 404
        : result.status >= 500
          ? 502
          : 400;

    throw createError(message || 'Supabase rejected the balance request.', statusCode);
  }

  return data;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return response(405, { error: 'Method not allowed.' });
  }

  try {
    const token = String(
      event.queryStringParameters?.token || ''
    ).trim();

    if (!UUID_REGEX.test(token)) {
      throw createError('This balance payment link is not valid.', 404);
    }

    const result = await supabaseRpc(
      'get_balance_payment_summary',
      { p_token: token }
    );

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw createError('Supabase returned invalid balance information.', 502);
    }

    return response(200, {
      bookingReference: result.booking_reference,
      eventDate: result.event_date,
      bookingStatus: result.booking_status,
      balanceDueDate: result.balance_due_date,
      firstName: result.customer_first_name,
      totalPrice: result.total_price,
      depositRequired: result.deposit_required,
      totalPaid: result.total_paid,
      remainingBalance: result.remaining_balance,
      currency: result.currency || 'gbp',
      fullyPaid: Boolean(result.fully_paid),
      existingCheckoutUrl: result.existing_checkout_url || null,
      existingCheckoutExpiresAt: result.existing_checkout_expires_at || null
    });

  } catch (error) {
    console.error('get-balance-payment failed', {
      message: error.message,
      statusCode: error.statusCode,
      cause: error.cause?.message
    });

    return response(error.statusCode || 500, {
      error: error.message || 'We could not load this balance payment.'
    });
  }
};
