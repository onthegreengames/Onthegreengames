// Public read-only campaign status. Prices and eligibility remain authoritative in Supabase.
'use strict';
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return { statusCode: 503, headers, body: JSON.stringify({ active: false }) };
  try {
    const response = await fetch(url + '/rest/v1/rpc/get_active_automatic_offer_v1', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!response.ok) throw new Error('Supabase campaign status unavailable: ' + response.status);
    const info = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify({
      active: info?.active === true,
      code: info?.active === true ? String(info.code || '') : null,
      discountAmount: info?.active === true ? Number(info.discount_amount || 0) : 0,
      expiresOn: info?.active === true ? String(info.expires_on || '') : null
    }) };
  } catch (error) {
    console.error('automatic-offer-status', error.message);
    return { statusCode: 503, headers, body: JSON.stringify({ active: false }) };
  }
};
