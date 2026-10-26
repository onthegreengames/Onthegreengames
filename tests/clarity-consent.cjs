// Consent/replay integration. Microsoft requests and booking endpoints are not sent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const consent = fs.readFileSync('consent.js', 'utf8');
const analytics = fs.readFileSync('site-analytics.js', 'utf8');
const booking = fs.readFileSync('booking.html', 'utf8');
const key = 'otgg_cookie_consent_v1';
function page(path = '/booking', options = {}) {
  const dom = new JSDOM(booking, {
    url: (options.origin || 'https://onthegreengames.co.uk') + path,
    ...(options.referrer ? { referrer: options.referrer } : {}),
    runScripts: 'outside-only'
  });
  const w = dom.window;
  if (options.saved) w.localStorage.setItem(key, JSON.stringify(options.saved));
  w.fetch = async () => ({ ok: true });
  w.eval(consent);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
const loaded = w => w.document.querySelectorAll('script[data-otgg-clarity]').length;
const commands = w => Array.from(w.clarity?.q || [], a => Array.from(a));
const accept = w => w.OTGGConsent.saveChoice({ analytics: true, advertising: false });
const close = w => w.close();
const w = page();
assert.equal(loaded(w), 0, 'No Microsoft script before consent');
w.OTGGConsent.saveChoice({ advertising: true });
assert.equal(loaded(w), 0, 'Advertising alone cannot start replay');
accept(w);
assert.equal(loaded(w), 1);
assert.equal(w.document.querySelector('[data-otgg-clarity]').src, 'https://www.clarity.ms/tag/z3ovvo5gsr');
assert.deepEqual(JSON.parse(JSON.stringify(commands(w)[0])), ['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]);
w.eval(analytics);
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
w.OTGGAnalytics.track('promo_code_applied', { promoCode: 'PRIVATE', bookingReference: 'PRIVATE', detail: 'PRIVATE' });
assert(commands(w).some(c => c[0] === 'event' && c[1] === 'promo_code_applied'));
assert(!JSON.stringify(commands(w)).includes('PRIVATE'), 'Only milestone names reach Clarity');
w.OTGGClarity.track('unknown_private_event');
assert(!JSON.stringify(commands(w)).includes('unknown_private_event'));
w.document.cookie = '_clck=test; path=/';
w.document.cookie = '_clsk=test; path=/; domain=.onthegreengames.co.uk';
w.OTGGConsent.saveChoice({ analytics: false });
assert(!w.document.cookie.includes('_cl'), 'Withdrawal deletes first-party Clarity cookies');
assert.equal(commands(w).at(-1)[0], 'stop');
const count = commands(w).length;
w.OTGGAnalytics.track('payment_started');
assert.equal(commands(w).length, count, 'No events after withdrawal');
accept(w);
assert.equal(loaded(w), 1, 'Reacceptance never duplicates the script');
assert(commands(w).slice(count).some(c => c[0] === 'start'));
w.OTGGConsent.saveChoice({ analytics: true, advertising: true });
assert(commands(w).some(c => c[0] === 'consentv2' && c[1].ad_Storage === 'granted'));
close(w);
for (const path of ['/booking-confirmed?session_id=secret', '/booking-confirmed.html', '/additional-details?token=secret', '/pay-balance?token=secret', '/planner', '/planner/index.html', '/booking?email=private%40example.com', '/booking?token=secret', '/booking?utm_source=private%40example.com', '/new-private-page']) {
  const p = page(path); accept(p); assert.equal(loaded(p), 0, path); close(p);
}
for (const path of ['/', '/packages.html', '/booking?package=the_mix&utm_source=facebook&fbclid=abc_123', '/booking?payment=cancelled', '/wedding-games-hire-cheshire']) {
  const p = page(path); accept(p); assert.equal(loaded(p), 1, path); close(p);
}
const preview = page('/booking', { origin: 'https://preview.netlify.app' });
accept(preview); assert.equal(loaded(preview), 0); close(preview);
const privateRef = page('/booking', { referrer: 'https://onthegreengames.co.uk/pay-balance?token=secret' });
accept(privateRef); assert.equal(loaded(privateRef), 0); close(privateRef);
for (const version of [2, 3]) {
 const p = page('/booking', { saved: { version, savedAt: Date.now(), analytics: true } });
 assert.equal(loaded(p), version === 3 ? 1 : 0, 'Prior disclosure requires a new choice');
 close(p);
}
const expired = page('/booking', { saved: { version: 3, savedAt: Date.now() - 181*86400000, analytics: true } });
assert.equal(loaded(expired), 0); close(expired);
const markup = new JSDOM(booking).window;
for (const id of ['pendingPanel', 'accordionSummaryDate', 'accordionSummary2', 'stepDate', 'bookingForm', 'error2', 'formError']) {
 assert.equal(markup.document.getElementById(id).getAttribute('data-clarity-mask'), 'true', id);
}
close(markup);
console.log('PASS: Clarity consent, disclosure renewal, events, masking and sensitive URL exclusions');
