// Run with NODE_PATH pointing to an installation of jsdom. No production requests are made.
const { JSDOM } = require("jsdom"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const html = fs.readFileSync("booking.html", "utf8"),
  js = fs.readFileSync("booking.js", "utf8");
let posts = [];
let w;
function boot(saved = {}) {
  const dom = new JSDOM(html, {
    url: "https://example.test/booking",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.matchMedia = (q) => ({ matches: q.includes("740"), addEventListener() {} });
  w.sessionStorage.setItem(
    "oggBooking",
    JSON.stringify({
      weddingDate: "2027-08-14",
      venueName: "Test Venue",
      venuePostcode: "CH1 1AA",
      travelFee: 40,
    }),
  );
  for (const [k, v] of Object.entries(saved)) w.sessionStorage.setItem(k, v);
  w.fetch = async (url, opts) => {
    let data = JSON.parse(opts.body);
    posts.push({ url, data });
    return {
      ok: !url.includes("create-checkout-session"),
      json: async () =>
        url.includes("validate-promo-code")
          ? { valid: true, code: data.code, discountAmount: 287.5 }
          : url.includes("create-booking-v3")
            ? {
                bookingId: "test-id",
                bookingReference: "TEST-123",
                total: 327.5,
                depositDue: 81.88,
                expiresAt: new Date(Date.now() + 1800000).toISOString(),
              }
            : { error: "Test checkout outage" },
    };
  };
  w.eval(js + "\nwindow.testApi={checkout,applyPromo};");
  // The real date checker calls this only after validating Supabase availability and fee.
  if (!w.sessionStorage.getItem("oggPendingBookingId")) {
    assert.equal(w.document.getElementById("stepDate").hidden, false);
    w.OTGGDateVerified(
      JSON.parse(w.sessionStorage.getItem("oggBooking")), true
    );
    assert.equal(w.document.getElementById("stepDate").hidden, true);
  }
  return dom;
}
const $ = (id) => w.document.getElementById(id),
  click = (s) => w.document.querySelector(s).click(),
  change = (s) => {
    const e = w.document.querySelector(s);
    e.checked = true;
    e.dispatchEvent(new w.Event("change", { bubbles: true }));
  },
  fill = (id, v) => {
    $(id).value = v;
  };
(async () => {
  boot();
  click("[data-package=mini_golf_3]");
  click("#next0");
  change("[data-mode=extra][data-game=cornhole]");
  change("[data-mode=extra][data-game=limbo]");
  assert.equal($("totalPrice").textContent, "£615");
  click("#next1");
  fill("promoInput", "OCT50");
  await w.testApi.applyPromo();
  assert.equal($("totalPrice").textContent, "£327.50");
  assert.equal($("summary").parentElement.id, "mobileSummarySlot");
  assert($("promoDetails").open);
  assert(
    $("summary").compareDocumentPosition($("paymentBlock")) &
      w.Node.DOCUMENT_POSITION_FOLLOWING,
  );
  fill("firstName", "Test");
  fill("lastName", "Customer");
  fill("email", "test@example.invalid");
  $("termsAgreed").checked = true;
  await w.testApi.checkout();
  let create = posts.find((p) => p.url.includes("create-booking-v3"));
  assert.deepEqual(create.data.booking.extra_game_codes, ["cornhole", "limbo"]);
  assert.equal(create.data.booking.promo_code, "OCT50");
  assert.equal(create.data.customer.first_name, "Test");
  assert($("bookingLayout").hidden);
  assert($("pendingPanel").textContent.includes("Test checkout outage"));
  let saved = Object.fromEntries(
    Object.keys(w.sessionStorage).map((k) => [k, w.sessionStorage.getItem(k)]),
  );
  boot(saved);
  assert(!$("pendingPanel").hidden);
  assert($("bookingLayout").hidden);
  boot();
  click("[data-package=the_mix]");
  assert($("next0").textContent.startsWith("Choose games & add extras"));
  click("#next0");
  click("#next1");
  assert(!$("error1").hidden);
  for (const code of ["cornhole", "giant_connect_4", "limbo", "giant_jenga"])
    change(`[data-mode=included][data-game=${code}]`);
  change("[data-mode=extra][data-game=giant_dominoes]");
  change('[name=golf][value="1"]');
  assert.equal($("totalPrice").textContent, "£565");
  click("#next1");
  assert(!$("step2").hidden);
  click('[data-go="0"]');
  click("#byoCard");
  click("#next0");
  change("[data-mode=custom][data-game=cornhole]");
  click("#next1");
  assert($("error1").textContent.includes("£300"));
  boot();
  click("[data-package=mini_golf_3]");
  click("#next0");
  change("[data-mode=extra][data-game=cornhole]");
  change("[data-mode=extra][data-game=limbo]");
  fill("promoInput", "OCT50");
  await w.testApi.applyPromo();
  change("[data-mode=extra][data-game=giant_jenga]");
  assert($("discountLine").hidden);
  assert($("promoFeedback").textContent.includes("changed"));
  // Moving back to the date step must preserve chosen extras and invalidate the old context.
  boot();
  click("[data-package=mini_golf_3]");
  click("#next0");
  change("[data-mode=extra][data-game=cornhole]");
  click("#accordionHeaderDate");
  assert(!$("stepDate").hidden);
  w.OTGGDateDirty();
  assert($("accordionHeader0").disabled);
  w.OTGGDateVerified({
    weddingDate: "2027-08-21", venueName: "Changed Venue",
    venuePostcode: "L1 1AA", travelFee: 80
  }, false);
  assert(!$("step0").hidden);
  assert($("accordionSummaryDate").textContent.includes("Changed Venue"));
  assert.equal($("totalPrice").textContent, "£605");
  click("#next0");
  assert(w.document.querySelector("[data-mode=extra][data-game=cornhole]").checked);
  assert.equal($("accordionHeader0").disabled, false);
  console.log(
    "PASS: four-step date gate, retained game extras, changed venue/travel, promotion invalidation, package rules, mobile summary, payload and saved checkout recovery"
  );
})();
