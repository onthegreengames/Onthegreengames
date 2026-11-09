// Safe campaign regression coverage: test November messaging and December popup eligibility.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const popup = fs.readFileSync('returning-offer.js', 'utf8');
const nav = fs.readFileSync('nav.js', 'utf8');
const animations = fs.readFileSync('animations.js', 'utf8');
const booking = fs.readFileSync('booking.js', 'utf8');
const html = fs.readFileSync('booking.html', 'utf8');

assert.match(nav, /FREE mini golf with games bookings this November/);
assert(!nav.includes('Free hole ends 30 November.'));
assert.match(booking, /FREE mini golf<\/strong> with games bookings this November/);
assert(!booking.includes('Free hole ends 30 November.'));
assert.match(html, /Build Your Own requires a £300 minimum after the free-hole saving/);

assert.match(popup, /CAMPAIGN_START = Date\.parse\('2026-12-01T00:00:00\+00:00'\)/);
assert.match(popup, /FIRST_VISIT_MIN_PAGE_VIEWS = 7/);
assert.match(popup, /30% OFF/);
assert.match(popup, /Minimum £300 hire before discounts, excluding travel/);
assert.match(nav, /script\.src = '\/returning-offer\.js'/);
assert.doesNotMatch(animations, /script\.src = '\/returning-offer\.js'/);

const CONSENT = JSON.stringify({ version: 3, personalisation: true });
const DECEMBER = Date.parse('2026-12-02T12:00:00Z');
const NOVEMBER = Date.parse('2026-11-30T12:00:00Z');

async function page(path, jar = {}, at = DECEMBER) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://onthegreengames.co.uk' + path,
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const w = dom.window;
  for (const [key, value] of Object.entries(jar)) w.localStorage.setItem(key, value);
  w.localStorage.setItem('otgg_cookie_consent_v1', CONSENT);
  const NativeDate = w.Date;
  w.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [at])); }
    static now() { return at; }
  };
  const events = [];
  w.fetch = async (_url, opts) => {
    events.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  w.eval(popup);
  await new Promise(resolve => setTimeout(resolve, 55));
  const card = w.document.querySelector('.otgg-return-offer.is-open .otgg-return-offer__card');
  const visible = Boolean(card);
  const copy = card ? card.textContent : '';
  for (let i = 0; i < w.localStorage.length; i++) {
    const key = w.localStorage.key(i);
    jar[key] = w.localStorage.getItem(key);
  }
  dom.window.close();
  return { visible, copy, events, jar };
}

(async () => {
  // No offer for anyone before December, even on a returning visit.
  const preLaunch = {
    otgg_first_seen_v1: String(NOVEMBER - 86400000),
    otgg_last_seen_v1: String(NOVEMBER - 3600000)
  };
  assert.equal((await page('/packages', preLaunch, NOVEMBER)).visible, false);

  // A browsing-only first visitor never qualifies, even after 8 page views.
  const browsing = {};
  for (const path of ['/', '/packages', '/mini-golf', '/giant-games', '/about-us', '/contact', '/wedding-guides', '/areas-we-cover']) {
    assert.equal((await page(path, browsing)).visible, false, 'Unexpected popup on ' + path);
  }

  // Abandoned booking first-time visitors must ALSO have more than 6 page views.
  const abandoned = {};
  for (const path of ['/', '/packages', '/booking', '/mini-golf', '/giant-games', '/contact']) {
    assert.equal((await page(path, abandoned)).visible, false, 'Too early for abandoned first visit ' + path);
  }
  const eligible = await page('/wedding-guides', abandoned);
  assert.equal(eligible.visible, true, 'Expected popup on seventh page after leaving booking');
  assert.match(eligible.copy, /BIRDIE30/);
  assert.match(eligible.copy, /Minimum £300/);
  assert(eligible.events.some(event => event.eventType === 'impression' && event.offerCode === 'BIRDIE30'));
  assert.equal((await page('/packages', abandoned)).visible, false, 'Only one impression per visit');

  // The booking page itself is never interrupted, even at the seventh view.
  const bookingLast = {};
  for (const path of ['/', '/packages', '/mini-golf', '/giant-games', '/about-us', '/contact', '/booking']) {
    assert.equal((await page(path, bookingLast)).visible, false);
  }
  assert.equal((await page('/packages', bookingLast)).visible, true, 'Offer should show only after leaving booking');

  // 30+ minute returning visits still qualify immediately.
  const returning = {
    otgg_first_seen_v1: String(DECEMBER - 86400000),
    otgg_last_seen_v1: String(DECEMBER - 3600000)
  };
  assert.equal((await page('/packages', returning)).visible, true, 'Returning visit should see popup');

  // Do not show after a confirmed booking or if all permitted impressions were used.
  const booked = {
    otgg_first_seen_v1: String(DECEMBER - 86400000),
    otgg_last_seen_v1: String(DECEMBER - 3600000),
    otgg_customer_booked_v1: '1'
  };
  assert.equal((await page('/packages', booked)).visible, false);
  const capped = {
    otgg_first_seen_v1: String(DECEMBER - 86400000),
    otgg_last_seen_v1: String(DECEMBER - 3600000),
    otgg_birdie40_show_count_v1: '3'
  };
  assert.equal((await page('/packages', capped)).visible, false);
  console.log('PASS: December schedule, first-visit abandonment after 7 pages, returning-visit rules, November banner and caps');
})().catch(error => { console.error(error); process.exitCode = 1; });
