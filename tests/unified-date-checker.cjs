// Browser-level integration test for the merged date checker (all Supabase requests mocked).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("booking.html", "utf8");
const booking = fs.readFileSync("booking.js", "utf8");
const dateChecker = fs.readFileSync("booking-date.js", "utf8");
const dom = new JSDOM(html, {
  url: "https://example.test/booking",
  runScripts: "outside-only",
  pretendToBeVisual: true
});
const w = dom.window;
const $ = id => w.document.getElementById(id);
w.HTMLElement.prototype.scrollIntoView = function () {};
w.matchMedia = q => ({ matches: q.includes("740"), addEventListener() {} });
const requests = [];
w.fetch = async (url, options = {}) => {
  requests.push(String(url));
  if (String(url).includes("get_earliest_bookable_date")) {
    return { ok: true, json: async () => "2027-03-01" };
  }
  if (String(url).includes("get_blocked_booking_dates")) {
    return { ok: true, json: async () => [{ event_date: "2027-08-17" }] };
  }
  if (String(url).includes("/postcode_districts")) {
    return { ok: true, json: async () => [{ fee: String(url).includes("L1") ? 80 : 40 }] };
  }
  throw new Error("Unexpected outgoing test request: " + url);
};
w.sessionStorage.setItem("oggBooking", JSON.stringify({
  weddingDate: "2027-08-14",
  venueName: "Original Venue",
  venuePostcode: "CH1 1AA",
  travelFee: 40
}));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("Timed out waiting for " + description);
}
(async () => {
  w.eval(booking);
  assert.equal($("stepDate").hidden, false, "The date step must show while context is unverified");
  w.eval(dateChecker);
  await waitFor(() => $("stepDate").hidden, "stored date to be reverified");
  assert.equal($("step0").hidden, false);
  assert($("accordionSummaryDate").textContent.includes("Original Venue"));
  assert.equal($("travelPrice").textContent, "£40");
  assert([...$("calGrid").querySelectorAll(".cal-day.cal-blocked")].some(c => c.textContent.trim() === "17"), "An existing blocked day must be disabled");
  assert(requests.some(url => url.includes("get_blocked_booking_dates")));
  assert(requests.some(url => url.includes("get_earliest_bookable_date")));

  w.document.querySelector('[data-package="mini_golf_3"]').click();
  $("next0").click();
  const extra = w.document.querySelector('[data-mode="extra"][data-game="cornhole"]');
  extra.checked = true;
  extra.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.equal($("totalPrice").textContent, "£565");

  $("accordionHeaderDate").click();
  assert.equal($("stepDate").hidden, false);
  const pc = $("cPostcode");
  pc.value = "L1 1AA";
  pc.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert($("accordionHeader0").disabled, "Editing postcode must block checkout until reverified");
  $("checkBtn").click(); // Immediately after input: must not reuse the old travel fee.
  await waitFor(() => $("stepDate").hidden, "new postcode to be verified");
  assert.equal($("travelPrice").textContent, "£80");
  assert.equal($("totalPrice").textContent, "£605");
  assert($("accordionSummaryDate").textContent.includes("L1 1AA"));
  $("next0").click();
  assert(w.document.querySelector('[data-mode="extra"][data-game="cornhole"]').checked);
  assert(requests.filter(url => url.includes("/postcode_districts")).some(url => url.includes("L1")));
  dom.window.close();
  console.log("PASS: real date checker, blocked-date RPC, saved-date verification, inline edit, latest travel fee and retained extras");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
  dom.window.close();
});
