// Netlify Function: netlify/functions/validate-promo-code.js
//
// Validates an OTGG promo code against the authoritative Supabase pricing
// and promotion rules. Browser-supplied prices are never trusted.
//
// Required Netlify environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)

'use strict';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 16 * 1024;

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

function text(value, maxLength = 200) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function parseBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    const error = new Error('The promo-code request is too large.');
    error.statusCode = 413;
    throw error;
  }

  try {
    const body = JSON.parse(rawBody || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('not an object');
    }
    return body;
  } catch {
    const error = new Error('The request body is not valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function getSupabaseConfig() {
  const baseUrl = String(process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !serviceKey) {
    const error = new Error('The promo-code service is not configured.');
    error.statusCode = 500;
    throw error;
  }

  return { baseUrl, serviceKey };
}

async function supabaseRpc(functionName, payload) {
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
      body: JSON.stringify(payload)
    });
  } catch (cause) {
    const error = new Error('We could not reach the promo-code service.');
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  const raw = await result.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }

  if (!result.ok) {
    const message = data && typeof data === 'object'
      ? data.message || data.details || data.hint
      : null;

    const error = new Error(message || 'We could not validate that promo code.');
    error.statusCode = result.status >= 500 ? 502 : 400;
    error.supabaseCode = data?.code;
    throw error;
  }

  return data;
}

function normaliseInput(body) {
  const code = text(body.code, 64)?.toUpperCase() || null;
  const selectionType = text(body.selectionType ?? body.selection_type, 30)?.toLowerCase() || null;
  const packageCode = text(body.packageCode ?? body.package_code, 80)?.toLowerCase() || null;
  const eventDate = text(body.eventDate ?? body.event_date, 10);

  if (!code) throw new Error('Enter a promo code first.');
  if (!['package', 'build_your_own'].includes(selectionType)) {
    throw new Error('Complete your package or Build Your Own selection first.');
  }
  if (selectionType === 'package' && !packageCode) {
    throw new Error('Choose a package before applying a promo code.');
  }
  if (!eventDate || !DATE_REGEX.test(eventDate)) {
    throw new Error('Check your wedding date before applying a promo code.');
  }

  const gameCodes = body.gameCodes ?? body.game_codes ?? [];
  if (!Array.isArray(gameCodes) || gameCodes.length > 20) {
    throw new Error('The selected games are not valid.');
  }

  const cleanGameCodes = gameCodes.map(value => text(value, 100)?.toLowerCase()).filter(Boolean);
  const miniGolfHoles = Number(body.miniGolfHoles ?? body.mini_golf_holes ?? 0);
  if (!Number.isInteger(miniGolfHoles) || miniGolfHoles < 0 || miniGolfHoles > 3) {
    throw new Error('The mini golf selection is not valid.');
  }

  return {
    code,
    selectionType,
    packageCode: selectionType === 'package' ? packageCode : null,
    gameCodes: cleanGameCodes,
    miniGolfHoles,
    eventDate
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });

  try {
    const input = normaliseInput(parseBody(event));

    const result = await supabaseRpc('quote_promo_code_v1', {
      p_code: input.code,
      p_selection_type: input.selectionType,
      p_package_code: input.packageCode,
      p_game_codes: input.gameCodes,
      p_mini_golf_holes: input.miniGolfHoles,
      p_event_date: input.eventDate
    });

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('The promo-code service returned an invalid response.');
    }

    return response(200, {
      valid: Boolean(result.valid),
      message: result.message || null,
      code: result.code || input.code,
      discountType: result.discount_type || null,
      discountValue: Number(result.discount_value || 0),
      discountAmount: Number(result.discount_amount || 0),
      hireSubtotal: Number(result.hire_subtotal || 0),
      discountedHireSubtotal: Number(result.discounted_hire_subtotal || 0)
    });
  } catch (error) {
    console.error('validate-promo-code failed', {
      message: error.message,
      statusCode: error.statusCode,
      supabaseCode: error.supabaseCode,
      cause: error.cause?.message
    });

    return response(error.statusCode || 400, {
      error: error.message || 'We could not validate that promo code.'
    });
  }
};
