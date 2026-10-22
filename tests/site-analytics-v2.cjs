// Full front-end analytics integration test. No production writes or payments.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM, VirtualConsole } = require("jsdom");
const html = fs.readFileSync("booking.html", "utf8");
const tracking = fs.readFileSync("site-analytics.js", "utf8");
const booking = fs.readFileSync("booking.js", "utf8");
const virtualConsole = new VirtualConsole();
const dom = new JSDOM(html, {
  url: "https://example.test/booking",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole,
});
const w = dom.window;
w.HTMLElement.prototype.scrollIntoView = function () {};
w.matchMedia = (q) => ({ matches: q.includes("740"), addEventListener() {} });
w.OTGGConsent = { getChoice: () => ({ analytics: true }) };
const events = [], bookingRequests = [];
w.fetch = async (url, opts) => {
  const data = JSON.parse(opts.body);
  if (url.includes("track-site-analytics")) {
    events.push(data);
    return { ok: true, json: async () => ({ ok: true }) };
  }
  bookingRequests.push({ url, data });
  if (url.includes("validate-promo-code")) {
    return { ok: true, json: async () => data.code === "OCT50"
      ? { valid: true, code: "OCT50", discountAmount: 200 }
      : { valid: false, message: "Unknown code" } };
  }
  if (url.includes("create-booking-v3"))
    return { ok: true, json: async () => ({
      bookingId: "b6648e59-f877-452e-81ad-a68e68e4f116",
      bookingReference: "TEST-ANALYTICS",
      total: 240, depositDue: 60,
      expiresAt: new Date(Date.now() + 1800000).toISOString()
    }) };
  if (url.includes("create-checkout-session"))
    return { ok: true, json: async () => ({
      checkoutUrl: "https://pay.onthegreengames.co.uk/c/pay/cs_live_example",
      expiresAt: new Date(Date.now() + 1800000).toISOString()
    }) };
  throw Error("Unknown mocked endpoint " + url);
};
const $ = id => w.document.getElementById(id);
const eventCount = name => events.filter(e => e.eventName === name).length;
const click = selector => w.document.querySelector(selector).click();
const change = selector => {
  const node = w.document.querySelector(selector);
  node.checked = true;
  node.dispatchEvent(new w.Event("change", { bubbles: true }));
};
(async () => {
  w.eval(tracking);
  w.eval(booking + "\nwindow.testApi = { checkout, applyPromo };");
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert.equal(eventCount("page_view"), 1);
  assert.equal(eventCount("booking_started"), 1);
  assert.equal(eventCount("check_date_started"), 1);
  assert.equal(eventCount("check_date_continue"), 0);
  w.OTGGDateVerified({
    weddingDate: "2027-08-14", venueName: "Private Venue",
    venuePostcode: "L1 1AA", travelFee: 40
  }, false);
  assert.equal(eventCount("check_date_continue"), 1);
  click('[data-package="mini_golf_3"]');
  click("#next0");
  assert.equal(eventCount("package_selected"), 1);
  assert.equal(events.find(e=>e.eventName==="package_selected").eventDetail,"mini_golf_3");
  change('[data-mode="extra"][data-game="cornhole"]');
  assert.equal(eventCount("extra_game_added"), 1);
  click("#next1");
  assert.equal(eventCount("extras_completed"), 1);
  assert.equal(eventCount("details_reached"), 1);
  $("promoInput").value = "INVALID";
  await w.testApi.applyPromo();
  assert.equal(eventCount("promo_code_applied"), 0, "Invalid promos must not count");
  $("promoInput").value = "OCT50";
  await w.testApi.applyPromo();
  assert.equal(eventCount("promo_code_applied"), 1);
  assert.equal(events.find(e=>e.eventName==="promo_code_applied").promoCode,"OCT50");
  change('input[name="payment"][value="full"]');
  assert.equal(eventCount("payment_started"), 0, "Choosing radio is not checkout");
  $("firstName").value = "Test";
  $("lastName").value = "Customer";
  $("email").value = "test@example.invalid";
  $("termsAgreed").checked = true;
  await w.testApi.checkout();
  assert.equal(eventCount("payment_started"), 1);
  assert.equal(events.find(e=>e.eventName==="payment_started").eventDetail,"full");
  assert(events.every(e => !JSON.stringify(e).includes("Private Venue") &&
    !JSON.stringify(e).includes("L1 1AA") && !JSON.stringify(e).includes("test@example.invalid")));
  // No analytics without consent, including tracking of promo-code use.
  const before = events.length;
  w.OTGGConsent.getChoice = () => ({ analytics: false });
  w.OTGGAnalytics.track("promo_code_applied", { promoCode: "OCT50" });
  assert.equal(events.length, before);
  dom.window.close();
  console.log("PASS: consent, date validation, package and extras steps, valid-only promos, direct Stripe payment tracking, no PII");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
  dom.window.close();
});
