'use strict';

// Netlify Function: netlify/functions/get-final-details.js
//
// Secure server-side bridge for the customer final-wedding-details page.
// The browser sends only the unguessable token. The service-role key never
// leaves Netlify.
//
// Required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 16 * 1024;

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

  if (!supabaseUrl || !serviceKey) {
    throw createError('Missing Supabase server configuration.', 500);
  }

  return { supabaseUrl, serviceKey };
}

async function rpc(functionName, body) {
  const { supabaseUrl, serviceKey } = config();

  let result;
  try {
    result = await fetch(
      `${supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
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

    const friendly =
      /not valid|could not be found/i.test(String(message || ''))
        ? 'This final wedding details link is not valid.'
        : message || 'Supabase rejected the final-details request.';

    const error = createError(
      friendly,
      /not valid|could not be found/i.test(String(message || '')) ? 404 :
        result.status >= 500 ? 502 : 400
    );

    error.supabaseCode = data?.code;
    throw error;
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

  try {
    const body = parseBody(event);
    const token = String(body.token || '').trim();

    if (!UUID_REGEX.test(token)) {
      throw createError('This final wedding details link is not valid.', 404);
    }

    const data = await rpc('get_final_details_form', {
      p_token: token
    });

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw createError('Supabase returned invalid final-details information.', 502);
    }

    return response(200, data);

  } catch (error) {
    console.error('get-final-details failed', {
      message: error.message,
      statusCode: error.statusCode,
      supabaseCode: error.supabaseCode
    });

    return response(error.statusCode || 500, {
      error: error.message || 'We could not load the final wedding details.'
    });
  }
};
