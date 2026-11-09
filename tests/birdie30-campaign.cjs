// Regression checks for the November offer and disabled BIRDIE30 campaign.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const popup = fs.readFileSync('returning-offer.js', 'utf8');
const nav = fs.readFileSync('nav.js', 'utf8');
const booking = fs.readFileSync('booking.js', 'utf8');
const html = fs.readFileSync('booking.html', 'utf8');

// The November free mini golf offer remains unchanged.
assert.match(nav, /FREE mini golf with games bookings this November/);
assert(!nav.includes('Free hole ends 30 November.'));
assert.match(booking, /FREE mini golf<\/strong> with games bookings this November/);
assert(!booking.includes('Free hole ends 30 November.'));
assert.match(html, /Build Your Own requires a £300 minimum after the free-hole saving/);

// BIRDIE30 is deliberately disabled until explicitly reviewed and re-enabled.
assert.match(popup, /BIRDIE30 returning-visitor popup disabled/);
assert.doesNotMatch(popup, /createOffer\s*\(/);
assert.doesNotMatch(popup, /30% OFF/);

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'https://onthegreengames.co.uk/packages',
  pretendToBeVisual: true,
  runScripts: 'outside-only'
});
const w = dom.window;
w.localStorage.setItem('otgg_cookie_consent_v1', JSON.stringify({ version: 3, personalisation: true }));
w.localStorage.setItem('otgg_first_seen_v1', String(Date.now() - 86400000));
w.localStorage.setItem('otgg_last_seen_v1', String(Date.now() - 3600000));
w.eval(popup);
assert.equal(w.document.querySelector('.otgg-return-offer'), null, 'Disabled popup must not appear');
console.log('PASS: November offer unchanged; BIRDIE30 popup disabled');
dom.window.close();
