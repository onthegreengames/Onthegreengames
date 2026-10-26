// Netlify Function: netlify/functions/track-site-analytics.js
// Records consented first-party website analytics in Supabase without exposing
// Supabase write credentials to the browser.
//
// Required Netlify environment variables (already used by other OTGG functions):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)

'use strict';

const MAX_BODY_BYTES = 12 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set([
  'page_view',
  'check_date_started',
  'date_selected',
  'availability_available',
  'availability_unavailable',
  'check_date_continue',
  'booking_started',
  'package_selected',
  'extra_game_added',
  'extras_completed',
  'details_reached',
  'promo_code_applied',
  'payment_started',
  'booking_completed',
  'balance_payment_completed',
  'enquiry_form_opened',
  'enquiry_form_started',
  'enquiry_form_submitted',
  'enquiry_form_error',
  'enquiry_form_closed',
  'enquiry_form_abandoned'
]);
const DEVICE_TYPES = new Set(['mobile', 'tablet', 'desktop', 'unknown']);

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

function cleanPath(value) {
  let path = cleanText(value, 240) || '/';
  if (!path.startsWith('/')) path = '/' + path;
  return path.split('?')[0].split('#')[0] || '/';
}

function cleanHost(value) {
  const host = cleanText(value, 180);
  if (!host) return null;
  return host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.:-]/g, '').slice(0, 180) || null;
}

function normalise(body) {
  const eventId = cleanText(body.eventId ?? body.event_id, 36);
  const visitorId = cleanText(body.visitorId ?? body.visitor_id, 36);
  const sessionId = cleanText(body.sessionId ?? body.session_id, 36);
  const eventName = cleanText(body.eventName ?? body.event_name, 60);
  const deviceCategory = cleanText(body.deviceCategory ?? body.device_category, 20) || 'unknown';

  if (!eventId || !UUID_RE.test(eventId)) {
    const error = new Error('Invalid event id.');
    error.statusCode = 400;
    throw error;
  }
  if (!visitorId || !UUID_RE.test(visitorId)) {
    const error = new Error('Invalid visitor id.');
    error.statusCode = 400;
    throw error;
  }
  if (!sessionId || !UUID_RE.test(sessionId)) {
    const error = new Error('Invalid session id.');
    error.statusCode = 400;
    throw error;
  }
  if (!EVENT_TYPES.has(eventName)) {
    const error = new Error('Invalid event name.');
    error.statusCode = 400;
    throw error;
  }
  if (!DEVICE_TYPES.has(deviceCategory)) {
    const error = new Error('Invalid device category.');
    error.statusCode = 400;
    throw error;
  }

  const promoCode = cleanText(body.promoCode ?? body.promo_code, 64);
  const bookingReference = cleanText(body.bookingReference ?? body.booking_reference, 80);

  return {
    event_id: eventId,
    visitor_id: visitorId,
    session_id: sessionId,
    event_name: eventName,
    page_path: cleanPath(body.pagePath ?? body.page_path),
    landing_page_path: cleanPath(body.landingPagePath ?? body.landing_page_path),
    referrer_host: cleanHost(body.referrerHost ?? body.referrer_host),
    utm_source: cleanText(body.utmSource ?? body.utm_source, 120),
    utm_medium: cleanText(body.utmMedium ?? body.utm_medium, 120),
    utm_campaign: cleanText(body.utmCampaign ?? body.utm_campaign, 160),
    device_category: deviceCategory,
    event_detail: cleanText(body.eventDetail ?? body.event_detail, 120),
    promo_code: promoCode ? promoCode.toUpperCase() : null,
    booking_reference: bookingReference,
    is_new_visitor: body.isNewVisitor === true || body.is_new_visitor === true
  };
}

function getSupabaseConfig() {
  const baseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !serviceKey) {
    const error = new Error('Analytics service is not configured.');
    error.statusCode = 500;
    throw error;
  }
  return { baseUrl, serviceKey };
}

async function insertEvent(payload) {
  const { baseUrl, serviceKey } = getSupabaseConfig();
  let result;
  try {
    result = await fetch(`${baseUrl}/rest/v1/site_analytics_events?on_conflict=event_id`, {
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
    const error = new Error('Analytics service unavailable.');
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  if (!result.ok) {
    const raw = await result.text();
    const error = new Error('Analytics write failed.');
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
    console.error('track-site-analytics failed', {
      message: error.message,
      statusCode: error.statusCode,
      details: error.details,
      cause: error.cause?.message
    });
    return response(error.statusCode || 400, { error: error.message || 'Analytics tracking failed.' });
  }
};
