// Netlify Function: netlify/functions/track-returning-offer.js
// Records consented BIRDIE40 popup interactions in Supabase without exposing
// Supabase write credentials to the browser.
//
// Required Netlify environment variables (already used by other OTGG functions):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)

'use strict';

const MAX_BODY_BYTES = 8 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set(['impression', 'book_now_click', 'copy_code_click', 'dismiss']);

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

function parseBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    const error = new Error('Request too large.');
    error.statusCode = 413;
    throw error;
  }

  try {
    const body = JSON.parse(rawBody || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch {
    const error = new Error('Invalid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalise(body) {
  const impressionId = cleanText(body.impressionId ?? body.impression_id, 36);
  const eventType = cleanText(body.eventType ?? body.event_type, 40);
  const eventDetail = cleanText(body.eventDetail ?? body.event_detail, 80);
  let pagePath = cleanText(body.pagePath ?? body.page_path, 240);

  if (!impressionId || !UUID_RE.test(impressionId)) {
    const error = new Error('Invalid impression id.');
    error.statusCode = 400;
    throw error;
  }
  if (!EVENT_TYPES.has(eventType)) {
    const error = new Error('Invalid event type.');
    error.statusCode = 400;
    throw error;
  }
  if (pagePath && !pagePath.startsWith('/')) pagePath = '/' + pagePath;

  return {
    impression_id: impressionId,
    offer_code: 'BIRDIE40',
    event_type: eventType,
    event_detail: eventDetail,
    page_path: pagePath
  };
}

function getSupabaseConfig() {
  const baseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !serviceKey) {
    const error = new Error('Tracking service is not configured.');
    error.statusCode = 500;
    throw error;
  }
  return { baseUrl, serviceKey };
}

async function insertEvent(payload) {
  const { baseUrl, serviceKey } = getSupabaseConfig();
  let result;
  try {
    result = await fetch(`${baseUrl}/rest/v1/returning_offer_events?on_conflict=impression_id,event_type`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify(payload)
    });
  } catch (cause) {
    const error = new Error('Tracking service unavailable.');
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  if (!result.ok) {
    const raw = await result.text();
    const error = new Error('Tracking write failed.');
    error.statusCode = 502;
    error.details = raw.slice(0, 500);
    throw error;
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });

  try {
    const payload = normalise(parseBody(event));
    await insertEvent(payload);
    return response(202, { ok: true });
  } catch (error) {
    console.error('track-returning-offer failed', {
      message: error.message,
      statusCode: error.statusCode,
      details: error.details,
      cause: error.cause?.message
    });
    return response(error.statusCode || 400, { error: error.message || 'Tracking failed.' });
  }
};
