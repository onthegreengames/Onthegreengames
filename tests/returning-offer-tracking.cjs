// Regression test: valid pop-up UUIDs reach the Supabase transport.
'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { handler } = require('../netlify/functions/track-returning-offer.js');

const oldFetch = global.fetch;
const oldUrl = process.env.SUPABASE_URL;
const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://test.supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-secret';

const posts = [];
global.fetch = async (url, options) => {
  posts.push({ url, body: JSON.parse(options.body) });
  return { ok: true, status: 201, text: async () => '' };
};

async function test() {
  const impressionId = randomUUID();
  const event = {
    impressionId, offerCode: 'BIRDIE30',
    eventType: 'impression', eventDetail: 'shown', pagePath: '/packages'
  };
  const response = await handler({
    httpMethod: 'POST', isBase64Encoded: false, body: JSON.stringify(event)
  });
  assert.equal(response.statusCode, 202, 'Real browser UUID must be accepted');
  assert.equal(posts.length, 1, 'Tracking request must reach the database transport');
  assert.equal(posts[0].body.impression_id, impressionId);
  assert.equal(posts[0].body.offer_code, 'BIRDIE30');
  assert.equal(posts[0].body.event_type, 'impression');
  assert.equal(posts[0].body.page_path, '/packages');

  const click = await handler({
    httpMethod: 'POST', isBase64Encoded: false,
    body: JSON.stringify({ ...event, eventType: 'copy_code_click' })
  });
  assert.equal(click.statusCode, 202, 'Valid pop-up interaction must be accepted');
  assert.equal(posts.length, 2);

  const invalid = await handler({
    httpMethod: 'POST', isBase64Encoded: false,
    body: JSON.stringify({ ...event, impressionId: 'not-a-uuid' })
  });
  assert.equal(invalid.statusCode, 400, 'Malformed ID must be rejected');
  assert.equal(posts.length, 2, 'Malformed event must not be stored');

  console.log('PASS: BIRDIE30 impression, click and UUID validation');
}

test()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });
