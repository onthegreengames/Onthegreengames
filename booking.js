"use strict";
const G = [
  {
    id: "giant_connect_4",
    name: "Giant Connect 4",
    tier: "premium",
    price: 125,
  },
  {
    id: "giant_noughts_and_crosses",
    name: "Giant Noughts & Crosses",
    tier: "premium",
    price: 125,
  },
  { id: "cornhole", name: "Cornhole", tier: "premium", price: 125 },
  { id: "giant_jenga", name: "Giant Jenga", tier: "classic", price: 50 },
  {
    id: "wooden_ring_toss",
    name: "Wooden Ring Toss",
    tier: "classic",
    price: 50,
  },
  { id: "giant_dominoes", name: "Giant Dominoes", tier: "classic", price: 50 },
  { id: "limbo", name: "Limbo", tier: "classic", price: 50 },
];
const P = [
  {
    id: "mini_golf_3",
    name: "3-Hole Mini Golf",
    price: 400,
    p: 0,
    c: 0,
    golf: 3,
    desc: "Three holes. Endless friendly competition.",
    kind: "THE WEDDING CROWD-PLEASER",
  },
  {
    id: "classic_collection",
    name: "Classic Collection",
    price: 200,
    p: 0,
    c: 4,
    desc: "All 4 Classic games.",
    kind: "LAID-BACK LAWN FAVOURITES",
  },
  {
    id: "the_mix",
    name: "The Mix",
    price: 325,
    p: 2,
    c: 2,
    desc: "Choose 2 Premium + 2 Classic games.",
    kind: "A LITTLE OF EVERYTHING",
  },
  {
    id: "premium_collection",
    name: "Premium Collection",
    price: 350,
    p: 3,
    c: 0,
    desc: "All 3 Premium games.",
    kind: "BIG GAMES. BIG COMPETITION.",
  },
  {
    id: "complete_collection",
    name: "Complete Collection",
    price: 475,
    p: 3,
    c: 4,
    desc: "All 7 giant garden games.",
    kind: "THE WHOLE COLLECTION",
  },
];
const golfPrices = [0, 150, 275, 375];
const $ = (id) => document.getElementById(id),
  money = (n) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: n % 1 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(n);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// First-party, consent-gated analytics. Never include names, venue or postcode.
function trackBookingEvent(name, options = {}) {
  if (window.OTGGAnalytics && typeof window.OTGGAnalytics.track === "function")
    window.OTGGAnalytics.track(name, options);
}
const today = new Date();
today.setHours(0, 0, 0, 0);
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let context = null;
try {
  context = JSON.parse(sessionStorage.getItem("oggBooking") || "null");
} catch {}
if (!context?.weddingDate || !context?.venueName || !context?.venuePostcode)
  context = null;
const previousContext = context;
context = null; // Restore only after revalidating current availability and travel.
const state = {
  step: -1,
  unlocked: -1,
  choice: null,
  included: [],
  extras: [],
  custom: [],
  golf: null,
  promo: false,
  date: previousContext?.weddingDate || "",
  venue: previousContext?.venueName || "Check your date and venue",
  postcode: previousContext?.venuePostcode || "",
  travel: Number(previousContext?.travelFee ?? previousContext?.mileageCharge ?? 0) || 0,
  payment: "deposit",
  pending: false,
};
const memories = {};
let latestQuote = null;
function pkg() {
  return P.find((p) => p.id === state.choice);
}
function selectedIds() {
  return state.choice === "byo"
    ? state.custom
    : [...state.included, ...state.extras];
}
function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function quote() {
  const p = pkg();
  const gameCost = (ids) =>
    ids.reduce((n, id) => n + G.find((g) => g.id === id).price, 0);
  let base = p ? p.price : 0;
  const extras = gameCost(state.choice === "byo" ? state.custom : state.extras);
  const golf = p?.golf
    ? 0
    : state.choice === "byo"
      ? (state.golf || 0) * 200
      : golfPrices[state.golf || 0];
  const sub = base + extras + golf,
    discount = state.promo ? state.promo.discountAmount : 0,
    total = round(sub - discount + state.travel),
    deposit = round(total * 0.25);
  return {
    base,
    extras,
    golf,
    sub,
    discount,
    total,
    deposit,
    balance: round(total - deposit),
  };
}
function daysUntil() {
  return Math.round((new Date(state.date + "T00:00:00") - today) / 86400000);
}
function dateText(d) {
  if (!d) return "Your wedding date";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
function dueDate() {
  if (!state.date) return "your wedding date minus 30 days";
  const d = new Date(state.date + "T00:00:00");
  d.setDate(d.getDate() - 30);
  return dateText(iso(d));
}
function renderCards() {
  $("packageCards").innerHTML = P.map(
    (p) =>
      `<button class="pack ${p.golf ? "golf-pack" : ""} ${state.choice === p.id ? "selected" : ""}" type="button" data-package="${p.id}" aria-pressed="${state.choice === p.id}">${p.golf ? '<svg class="golf-art" viewBox="0 0 60 80" aria-hidden="true"><rect x="3" y="2" width="50" height="75" rx="22" fill="#39644b" stroke="#E7CE9B"/><ellipse cx="28" cy="61" rx="9" ry="4" fill="#183929"/><path d="M28 61V16l17 7-17 7" stroke="#E7CE9B" fill="none" stroke-width="2"/><circle cx="18" cy="45" r="3" fill="#FFFDF6"/></svg>' : ""}<div><h3>${p.name}</h3><p>${p.desc}</p></div><div class="price">${money(p.price)} <small>/ all day</small></div></button>`,
  ).join("");
  $("byoCard").classList.toggle("selected", state.choice === "byo");
  $("byoCard").setAttribute("aria-pressed", state.choice === "byo");
}
function choose(id, preserve) {
  if (pending || busy) return;
  if (state.choice)
    memories[state.choice] = {
      included: [...state.included],
      extras: [...state.extras],
      custom: [...state.custom],
      golf: state.golf,
    };
  state.choice = id;
  const p = pkg(),
    old = memories[id];
  if (preserve) {
    state.included = preserve.included;
    state.extras = preserve.extras;
    state.golf = preserve.golf;
  } else if (old) {
    Object.assign(state, old);
  } else {
    state.included =
      p && !p.golf && id !== "the_mix"
        ? G.filter((g) => (g.tier === "classic" ? p.c === 4 : p.p === 3)).map(
            (g) => g.id,
          )
        : [];
    state.extras = [];
    state.golf = p?.golf ? 3 : id === "byo" ? 0 : null;
    state.custom = [];
  }
  renderCards();
  renderCustom();
  render();
  $("error0").hidden = true;
}
function gamesMarkup(games, mode) {
  return games
    .map((g) => {
      const selected = (
        mode === "included"
          ? state.included
          : mode === "extra"
            ? state.extras
            : state.custom
      ).includes(g.id);
      const limit =
        mode === "included" &&
        !selected &&
        state.included.filter(
          (id) => G.find((x) => x.id === id).tier === g.tier,
        ).length >= 2;
      return `<label class="game ${limit ? "disabled" : ""}"><input type="checkbox" data-game="${g.id}" data-mode="${mode}" ${selected ? "checked" : ""} ${limit ? "disabled" : ""}><span><strong>${esc(g.name)}</strong><small>${g.tier === "premium" ? "Premium game" : "Classic game"}</small></span><span class="game-cost">${mode === "included" ? "Included" : "+" + money(g.price)}</span></label>`;
    })
    .join("");
}
function golfMarkup(custom = false) {
  return `<div class="block"><div class="block-top"><h3>${custom ? "Choose your mini golf" : "Add mini golf"}</h3><span class="tag gold">OPTIONAL</span></div><p class="section-lead">${custom ? "Add individual holes at £200 each." : "Make more of your day with 1, 2 or all 3 holes."}</p><div class="golf-options">${[0, 1, 2, 3].map((n) => `<label class="golf-option"><input type="radio" name="golf" value="${n}" ${state.golf === n ? "checked" : ""}><strong>${n === 0 ? "No mini golf" : n + " " + (n === 1 ? "hole" : "holes")}</strong><small>${n === 0 ? "£0" : "+" + money(custom ? n * 200 : golfPrices[n])}</small></label>`).join("")}</div></div>`;
}
function renderCustom() {
  const p = pkg();
  if (!state.choice) {
    $("customControls").innerHTML = "";
    return;
  }
  $("customSubtitle").textContent =
    state.choice === "byo"
      ? "Choose exactly what you want. £300 minimum hire before discounts and travel."
      : p.name + " · " + money(p.price) + " · All-day hire";
  let html = "";
  if (state.choice === "byo") {
    html =
      `<div class="block"><h3>Pick your games</h3><p class="section-lead">Add as many as you like, one of each game.</p><div class="game-grid">${gamesMarkup(G, "custom")}</div></div>` +
      golfMarkup(true);
  } else {
    if (state.choice === "the_mix") {
      html = `<div class="block"><div class="block-top"><h3>Choose your included games</h3><span class="tag">IN YOUR PACKAGE</span></div><p class="section-lead">Pick 2 Premium and 2 Classic games. You'll find the rest in extras.</p>${[
        "premium",
        "classic",
      ]
        .map(
          (t) =>
            `<div class="tier-label">${t} games <span class="count">${state.included.filter((id) => G.find((g) => g.id === id).tier === t).length} of 2 selected</span></div><div class="game-grid">${gamesMarkup(
              G.filter((g) => g.tier === t),
              "included",
            )}</div>`,
        )
        .join("")}</div>`;
    } else {
      html = `<div class="block"><div class="block-top"><h3>Already included</h3><span class="tag">IN YOUR PACKAGE</span></div><div class="included-list">${p.golf ? '<span class="included-chip">✓ 3 mini golf holes</span>' : state.included.map((id) => '<span class="included-chip">✓ ' + esc(G.find((g) => g.id === id).name) + "</span>").join("")}</div></div>`;
    }
    const remaining = G.filter((g) => !state.included.includes(g.id));
    if (remaining.length) {
      html += `<div class="block"><div class="block-top"><h3>Add a few more favourites</h3><span class="tag gold">OPTIONAL</span></div><p class="section-lead">${state.choice === "the_mix" && state.included.length < 4 ? "Finish choosing your included games above to unlock extras." : "Extra games, added to your package. Just tick what you fancy."}</p>${state.choice === "the_mix" && state.included.length < 4 ? "" : `<div class="game-grid">${gamesMarkup(remaining, "extra")}</div>`}</div>`;
    } else
      html +=
        '<div class="notice">You’ve got all 7 giant games in your collection. No extras needed.</div>';
    if (!p.golf) html += golfMarkup();
  }
  $("customControls").innerHTML = html;
}
function selectionError() {
  if (!state.choice)
    return "Choose a package or Build Your Own to get started.";
  if (
    state.choice === "the_mix" &&
    ["classic", "premium"].some(
      (t) =>
        state.included.filter((id) => G.find((g) => g.id === id)?.tier === t)
          .length !== 2,
    )
  )
    return "Choose 2 Premium and 2 Classic games for The Mix.";
  if (pkg() && !pkg().golf && state.golf === null)
    return "Please choose a mini golf option, including “No mini golf” if you don’t want to add it.";
  if (state.choice === "byo" && quote().sub < 300)
    return `Add ${money(300 - quote().sub)} more to reach the £300 Build Your Own minimum before discounts and travel.`;
  return "";
}
function showError(step, message) {
  const e = $("error" + step);
  e.textContent = message;
  e.hidden = !message;
  if (message) e.scrollIntoView({ behavior: "smooth", block: "center" });
}
function accordionSummary() {
  const p = pkg(),
    q = quote();
  $("accordionSummary0").textContent = state.choice
    ? (p?.name || "Build Your Own") + " · " + money(p?.price || q.sub)
    : "Start with a package or build your own";
  let parts = [];
  if (state.choice === "byo") {
    parts.push(
      state.custom.length +
        " giant " +
        (state.custom.length === 1 ? "game" : "games"),
    );
  } else if (p) {
    parts.push(
      state.included.length +
        " included " +
        (state.included.length === 1 ? "game" : "games"),
    );
    if (state.extras.length)
      parts.push(
        state.extras.length +
          " extra " +
          (state.extras.length === 1 ? "game" : "games"),
      );
  }
  if (state.golf)
    parts.push(
      state.golf + " mini golf " + (state.golf === 1 ? "hole" : "holes"),
    );
  if (state.golf === 0 && p && !p.golf) parts.push("No mini golf");
  $("accordionSummary1").textContent =
    state.unlocked < 1
      ? "Personalise your package"
      : parts.join(" · ") || "Choose your games and extras";
  const name = [$("firstName").value.trim(), $("lastName").value.trim()]
    .filter(Boolean)
    .join(" ");
  $("accordionSummary2").textContent = name
    ? name +
      " · " +
      (state.payment === "deposit" ? "25% deposit" : "Pay in full")
    : "Just your name and email to get booked";
  const dateOpen = state.step === -1;
  $("accordionSummaryDate").textContent = context && state.date
    ? dateText(state.date) + " · " + state.venue + " · " + state.postcode +
      (state.travel ? " · " + money(state.travel) + " travel" : " · Travel included")
    : "Choose your date and tell us where to deliver";
  $("stepDate").hidden = !dateOpen;
  $("accordionDate").classList.toggle("is-open", dateOpen);
  $("accordionHeaderDate").setAttribute("aria-expanded", String(dateOpen));
  $("accordionStatusDate").textContent = dateOpen ? "Open" : context ? "Edit" : "Up next";
  document.body.classList.toggle("date-active", dateOpen);
  [0, 1, 2].forEach((i) => {
    const open = i === state.step,
      button = $("accordionHeader" + i);
    $("step" + i).hidden = !open;
    $("accordion" + i).classList.toggle("is-open", open);
    button.disabled = i > state.unlocked || !context;
    button.setAttribute("aria-expanded", String(open));
    $("accordionStatus" + i).textContent = open
      ? "Open"
      : i > state.unlocked
        ? "Up next"
        : "Edit";
  });
}
function go(step, shouldScroll = true) {
  if (busy || pending) return;
  if (step >= 0 && !context) step = -1;
  if (step > 0 && !state.choice) {
    go(0);
    showError(0, "Choose a package or Build Your Own to get started.");
    return;
  }
  if (step === 2 && selectionError()) {
    if (state.step !== 1) go(1);
    showError(1, selectionError());
    return;
  }
  const previousStep = state.step;
  state.unlocked = Math.max(state.unlocked, step);
  state.step = step;
  render();
  if (step === 1 && previousStep !== 1)
    trackBookingEvent("package_selected", { detail: state.choice });
  if (step === 2 && previousStep !== 2) {
    trackBookingEvent("extras_completed", {
      detail: state.choice + "|games:" +
        (state.choice === "byo" ? state.custom.length : state.extras.length) +
        "|holes:" + (state.golf || 0),
    });
    trackBookingEvent("details_reached");
  }
  if (shouldScroll)
    requestAnimationFrame(() => {
      $(step === -1 ? "accordionDate" : "accordion" + step).scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
      $(step === -1 ? "accordionHeaderDate" : "accordionHeader" + step).focus({ preventScroll: true });
    });
}

function bestDeal() {
  if (!state.choice || state.golf === null) return null;
  const ids = selectedIds(),
    pcount = ids.filter(
      (id) => G.find((g) => g.id === id).tier === "premium",
    ).length,
    ccount = ids.length - pcount;
  const holes = state.golf || 0;
  let best = null;
  for (const p of P) {
    if (p.golf ? holes !== 3 : pcount < p.p || ccount < p.c) continue;
    let included = [];
    if (!p.golf) {
      included = [
        ...ids
          .filter((id) => G.find((g) => g.id === id).tier === "premium")
          .slice(0, p.p),
        ...ids
          .filter((id) => G.find((g) => g.id === id).tier === "classic")
          .slice(0, p.c),
      ];
    }
    const extras = ids.filter((id) => !included.includes(id));
    const cost =
      p.price +
      extras.reduce((n, id) => n + G.find((g) => g.id === id).price, 0) +
      (p.golf ? 0 : golfPrices[holes]);
    if (cost < quote().sub && (!best || cost < best.cost))
      best = {
        p,
        included,
        extras,
        golf: holes,
        cost,
        saving: quote().sub - cost,
      };
  }
  return best;
}
const mobileLayout = window.matchMedia("(max-width: 740px)");
let summaryWasMobile = null,
  desktopPromoOpen = false;
function placeSummary() {
  const mobile = mobileLayout.matches,
    summary = $("summary");
  if (mobile === summaryWasMobile) return;
  if (mobile) {
    desktopPromoOpen = $("promoDetails").open;
    $("mobileSummarySlot").appendChild(summary);
    $("promoDetails").open = true;
  } else {
    $("desktopSummarySlot").appendChild(summary);
    if (summaryWasMobile !== null) $("promoDetails").open = desktopPromoOpen;
  }
  summaryWasMobile = mobile;
}
function reviewSummary() {
  if (mobileLayout.matches && state.step !== 2) {
    go(2);
    if (state.step !== 2) return;
  }
  if (mobileLayout.matches) $("promoDetails").open = true;
  requestAnimationFrame(() =>
    $("summary").scrollIntoView({ behavior: "smooth", block: "start" }),
  );
}
mobileLayout.addEventListener("change", () => {
  placeSummary();
  render();
});
function extrasCta() {
  return ["the_mix", "byo"].includes(state.choice)
    ? "Choose games & add extras"
    : "Add extras";
}
function render() {
  invalidatePromo();
  const cta = extrasCta();
  $("next0").innerHTML = cta + " <span>↓</span>";
  accordionSummary();
  const q = quote();
  latestQuote = q;
  const p = pkg();
  let lines = "";
  if (!state.choice)
    lines =
      '<p class="empty">Your games will appear here.<br>Start with a package you love.</p>';
  else if (p) {
    lines += `<div class="sum-row"><strong>${p.name}</strong><span>${money(p.price)}</span></div>`;
    lines += `<div class="sum-description">${p.golf ? "3 mini golf holes included" : state.included.length ? state.included.map((id) => esc(G.find((g) => g.id === id).name)).join(" · ") : "Choose your included games"}</div>`;
  } else
    lines =
      '<div class="sum-row"><strong>Build Your Own</strong><span></span></div>';
  for (const id of state.choice === "byo" ? state.custom : state.extras) {
    const g = G.find((g) => g.id === id);
    lines += `<div class="sum-row"><span>${state.choice === "byo" ? "" : "+ "}${esc(g.name)}</span><span>${money(g.price)}</span></div>`;
  }
  if (q.golf)
    lines += `<div class="sum-row"><span>+ ${state.golf} mini golf ${state.golf === 1 ? "hole" : "holes"}</span><span>${money(q.golf)}</span></div>`;
  if (state.choice)
    lines += `<div style="margin-top:12px"><button class="text-button" type="button" data-go="1">Edit your games</button></div>`;
  $("summaryLines").innerHTML = lines;
  $("travelPrice").textContent = state.travel
    ? money(state.travel)
    : "Included";
  $("discountLine").hidden = !state.promo;
  $("discountLine").innerHTML =
    "<span>" +
    esc(state.promo?.code || "") +
    " · Hire discount</span><span>−" +
    money(q.discount) +
    "</span>";
  $("totalPrice").textContent = money(q.total);
  $("mobilePrice").textContent = money(q.total);
  const short = daysUntil() < 30;
  if (short) state.payment = "full";
  $("shortNotice").hidden = !short;
  $("depositOption").hidden = short;
  document.querySelector(".pay-grid").style.gridTemplateColumns = short
    ? "1fr"
    : "";
  document
    .querySelectorAll("input[name=payment]")
    .forEach((i) => (i.checked = i.value === state.payment));
  $("depositAmount").textContent = money(q.deposit);
  $("fullAmount").textContent = money(q.total);
  $("balanceText").textContent =
    money(q.balance) + " due by " + dueDate() + ".";
  $("paymentPreview").innerHTML = short
    ? "<strong>" +
      money(q.total) +
      "</strong> payable today<br>Full payment for bookings within 30 days."
    : "Book with <strong>" +
      money(q.deposit) +
      "</strong> today<br>25% deposit. Balance due 30 days before your wedding.";
  $("payButton").textContent =
    "Book now & pay " +
    money(state.payment === "deposit" ? q.deposit : q.total) +
    " →";
  $("mobileNext").textContent =
    state.step === 0
      ? extrasCta() + " ↓"
      : state.step === 1
        ? "Your details ↓"
        : mobileLayout.matches
          ? "Review & pay ↓"
          : "Book now · " +
            money(state.payment === "deposit" ? q.deposit : q.total);
  $("removePromo").hidden = !state.promo;
  if (state.promo)
    $("promoFeedback").textContent =
      state.promo.code +
      " applied. You save " +
      money(q.discount) +
      " on hire. Travel is excluded.";
  if (state.choice === "byo" && q.sub < 300) {
    $("error1").textContent = selectionError();
    $("error1").hidden = false;
  } else if (!selectionError()) $("error1").hidden = true;
  const deal = bestDeal();
  $("recommendation").hidden = !deal;
  if (deal)
    $("recommendation").innerHTML =
      `<strong>The same games, for ${money(deal.saving)} less${state.promo ? " before your promo discount" : ""}.</strong><br>Switch to ${deal.p.name}${deal.extras.length ? " with extras" : ""} and keep your selection.<button type="button" class="text-button" id="useDeal">Switch & save →</button>`;
}
function field(id, label, type = "text", full = false, auto = "off") {
  return `<label class="input-field ${full ? "full" : ""}">${label}<input id="${id}" name="${id}" type="${type}" ${type === "number" ? 'min="0" step="1"' : ""} autocomplete="${auto}"></label>`;
}
function optionalFields() {
  let h =
    '<h4>Contact & address</h4><div class="fields">' +
    field("phone", "Phone number", "tel", false, "tel") +
    '<label class="input-field">Preferred contact method<select id="preferredContact"><option value="">No preference</option><option>Email</option><option>Phone</option></select></label>' +
    field("customerAddress1", "Address line 1", "text", true, "address-line1") +
    field("customerAddress2", "Address line 2", "text", true, "address-line2") +
    field("customerTown", "Town / city", "text", false, "address-level2") +
    field("customerCounty", "County", "text", false, "address-level1") +
    field("customerPostcode", "Postcode", "text", false, "postal-code") +
    "</div>";
  h +=
    '<h4>Your timings</h4><p class="section-lead">Tell us your preferred times. We’ll agree delivery and collection with you.</p><div class="fields">' +
    field("guestCount", "Number of guests", "number") +
    field("deliveryTime", "Preferred delivery time", "time") +
    field("collectionTime", "Preferred collection time", "time") +
    '</div><h4>Venue & setup</h4><div class="fields">' +
    field("venueAddress1", "Venue address line 1", "text", true) +
    field("venueAddress2", "Venue address line 2", "text", true) +
    field("venueTown", "Venue town / city") +
    field("venueCounty", "Venue county") +
    field("venueContact", "Venue contact / coordinator", "text", true) +
    '</div><div class="tier-label">Setup preference</div><div class="radio-row">' +
    [
      ["unsure", "Not sure yet"],
      ["outdoor", "Outdoors (grass)"],
      ["indoor", "Indoors (carpet)"],
    ]
      .map(
        ([v, l]) =>
          `<label><input type="radio" name="setup" value="${v}" ${v === "unsure" ? "checked" : ""}> ${l}</label>`,
      )
      .join("") +
    '</div><div class="fields">';
  for (const [id, label, placeholder] of [
    [
      "customerNotes",
      "Anything else about your day?",
      "General information you’d like us to know",
    ],
    [
      "setupNotes",
      "Access & setup notes",
      "Parking, steps, loading access or setup location",
    ],
    [
      "weatherContingency",
      "Wet weather plans",
      "Indoor backup space or other arrangements",
    ],
    [
      "specialRequests",
      "Special requests",
      "Anything specific you’d like us to accommodate",
    ],
  ])
    h += `<label class="input-field full">${label}<textarea id="${id}" rows="3" placeholder="${placeholder}"></textarea></label>`;
  $("optionalFields").innerHTML = h + "</div>";
}

// Only these codes are sent; all prices, availability and discounts are checked by the server.
function selection() {
  return {
    selectionType: state.choice === "byo" ? "build_your_own" : "package",
    packageCode: pkg()?.id || null,
    gameCodes: state.choice === "byo" ? [...state.custom] : [...state.included],
    extraGameCodes: state.choice === "byo" ? [] : [...state.extras],
    miniGolfHoles: state.golf || 0,
    eventDate: state.date,
  };
}
function signature() {
  return JSON.stringify(selection());
}
let promoRequest = 0,
  busy = false,
  pending = null;
function invalidatePromo() {
  if (state.promo && state.promo.signature !== signature()) {
    state.promo = false;
    $("promoFeedback").textContent =
      "Your selection changed. Apply your code again to update the discount.";
  }
}
async function post(url, payload) {
  const response = await fetch("/.netlify/functions/" + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The booking service did not respond. Please try again.");
  }
  if (!response.ok)
    throw new Error(
      result.error || "We could not complete this request. Please try again.",
    );
  return result;
}
async function applyPromo() {
  if (busy || pending) return;
  const error = selectionError();
  if (error || !context) {
    $("promoFeedback").textContent =
      error || "Check your date and venue first.";
    return;
  }
  const code = $("promoInput").value.trim().toUpperCase();
  if (!code) {
    $("promoFeedback").textContent = "Enter a promo code first.";
    return;
  }
  const request = ++promoRequest,
    key = signature();
  $("applyPromo").disabled = true;
  $("promoFeedback").textContent = "Checking your code…";
  try {
    const result = await post("validate-promo-code", { code, ...selection() });
    if (request !== promoRequest) return;
    if (key !== signature()) {
      $("promoFeedback").textContent =
        "Your selection changed. Apply your code again.";
      return;
    }
    state.promo = result.valid ? { ...result, signature: key } : false;
    render();
    if (result.valid)
      trackBookingEvent("promo_code_applied", { promoCode: code });
    if (!result.valid)
      $("promoFeedback").textContent =
        result.message || "That code is not available for this booking.";
  } catch (error) {
    if (request === promoRequest) {
      state.promo = false;
      render();
      $("promoFeedback").textContent = error.message;
    }
  } finally {
    if (request === promoRequest) $("applyPromo").disabled = false;
  }
}
function value(id) {
  return $(id).value.trim() || null;
}
function payload() {
  const s = selection();
  return {
    customer: {
      first_name: value("firstName"),
      last_name: value("lastName"),
      email: value("email"),
      phone: value("phone"),
      preferred_contact_method:
        value("preferredContact")?.toLowerCase() || null,
      address_line_1: value("customerAddress1"),
      address_line_2: value("customerAddress2"),
      town_city: value("customerTown"),
      county: value("customerCounty"),
      postcode: value("customerPostcode"),
    },
    venue: {
      venue_name: state.venue,
      postcode: state.postcode,
      address_line_1: value("venueAddress1"),
      address_line_2: value("venueAddress2"),
      town_city: value("venueTown"),
      county: value("venueCounty"),
      contact_name: value("venueContact"),
    },
    booking: {
      selection_type: s.selectionType,
      package_code: s.packageCode,
      game_codes: s.gameCodes,
      extra_game_codes: s.extraGameCodes,
      mini_golf_holes: s.miniGolfHoles,
      event_date: s.eventDate,
      promo_code: state.promo?.code || null,
      setup_preference: document.querySelector("input[name=setup]:checked")
        .value,
      delivery_time: value("deliveryTime"),
      collection_time: value("collectionTime"),
      guest_count:
        value("guestCount") === null ? null : Number(value("guestCount")),
      customer_notes: value("customerNotes"),
      setup_notes: value("setupNotes"),
      weather_contingency: value("weatherContingency"),
      special_requests: value("specialRequests"),
      source: "website",
    },
  };
}
function storePending() {
  try {
    sessionStorage.setItem("oggPendingBookingId", pending.bookingId);
    sessionStorage.setItem(
      "oggPendingBookingReference",
      pending.bookingReference || pending.bookingId,
    );
    sessionStorage.setItem("oggPendingPayment", JSON.stringify(pending));
  } catch {
    /* The in-memory booking still prevents duplicate submissions. */
  }
}
function clearPending() {
  pending = null;
  for (const key of [
    "oggPendingBookingId",
    "oggPendingBookingReference",
    "oggPendingPayment",
  ])
    sessionStorage.removeItem(key);
}
function pendingExpired() {
  return pending?.expiresAt && Date.parse(pending.expiresAt) <= Date.now();
}
function showPending(message = "") {
  if (!pending) return;
  $("bookingLayout").hidden = true;
  document.querySelector(".mobile-bar").hidden = true;
  $("pendingPanel").hidden = false;
  const short = pending.eventDate
    ? Math.round(
        (new Date(pending.eventDate + "T00:00:00") - today) / 86400000,
      ) < 30
    : daysUntil() < 30;
  const expired = pendingExpired();
  $("pendingPanel").innerHTML =
    `<h2>${expired ? "Your payment window has ended" : "Your booking is ready for payment"}</h2><p>${esc(pending.bookingReference || "")} · Total ${money(Number(pending.total || 0))}</p><p>${expired ? "Please check availability again before starting a new booking. If you have already paid, check your confirmation email first." : "Your selection is saved and temporarily held. Continue with this booking to avoid creating a duplicate."}</p>${message ? '<div class="error" role="alert">' + esc(message) + "</div>" : ""}${expired ? '<button class="primary" id="restartBooking">Check availability again</button>' : `${!short ? '<button class="primary" data-resume="deposit">Pay deposit · ' + money(Number(pending.depositDue || 0)) + "</button> " : ""}<button class="secondary" data-resume="full">Pay in full · ${money(Number(pending.total || 0))}</button>`}<p class="mini-help">Need help? <a href="mailto:bookings@onthegreengames.co.uk">Contact us with your booking reference</a>.</p>`;
  $("pendingPanel").scrollIntoView({ block: "start", behavior: "smooth" });
}
// Stripe uses the OTGG custom hosted-checkout domain in production.
// Only accept Stripe's normal domain or the exact configured OTGG payment host.
function isApprovedCheckoutUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    (url.hostname === "checkout.stripe.com" ||
      url.hostname === "pay.onthegreengames.co.uk") &&
    !url.username &&
    !url.password &&
    !url.port
  );
}
async function openCheckout(type) {
  const result = await post("create-checkout-session", {
    bookingId: pending.bookingId,
    paymentType: type,
  });
  if (!result.checkoutUrl)
    throw new Error(
      "No checkout link was returned. Please retry your saved booking.",
    );
  const url = new URL(result.checkoutUrl);
  if (!isApprovedCheckoutUrl(url.href))
    throw new Error(
      "The secure checkout link was not valid. Please contact us.",
    );
  pending = {
    ...pending,
    checkoutUrl: url.href,
    paymentType: type,
    expiresAt: result.expiresAt || pending.expiresAt,
  };
  storePending();
  // A payment start means Stripe has provided a valid checkout URL,
  // not merely that somebody changed the deposit/full-payment selector.
  trackBookingEvent("payment_started", { detail: type });
  location.assign(url.href);
}
async function resume(type) {
  if (busy || !pending) return;
  busy = true;
  document
    .querySelectorAll("[data-resume]")
    .forEach((b) => (b.disabled = true));
  try {
    await openCheckout(type);
  } catch (error) {
    showPending(error.message);
  } finally {
    busy = false;
    document
      .querySelectorAll("[data-resume]")
      .forEach((b) => (b.disabled = false));
  }
}
async function checkout() {
  if (busy) return;
  if (pending) {
    showPending();
    return;
  }
  if (!context) {
    go(-1);
    return;
  }
  if (selectionError()) {
    go(1);
    showError(1, selectionError());
    return;
  }
  const form = $("bookingForm");
  if (!form.checkValidity()) {
    showError(
      2,
      "Please add your first name, last name and a valid email, accept the terms, and check your optional details.",
    );
    const invalid = form.querySelector(":invalid");
    if (invalid) {
      const details = invalid.closest("details");
      if (details) details.open = true;
      invalid.focus();
      invalid.reportValidity();
    }
    return;
  }
  if (!value("firstName") || !value("lastName")) {
    showError(2, "Please enter your first and last name.");
    return;
  }
  if (
    value("customerPostcode") &&
    !/^[A-Z0-9]{5,7}$/i.test(value("customerPostcode").replace(/\s/g, ""))
  ) {
    showError(
      2,
      "Please check your optional address postcode, or leave it blank.",
    );
    return;
  }
  invalidatePromo();
  busy = true;
  ++promoRequest;
  showError(2, "");
  // Disable all editable controls during the transaction, so the submitted selection cannot drift.
  document.querySelectorAll("button,input,select,textarea").forEach((el) => {
    el.dataset.wasDisabled = String(el.disabled);
    el.disabled = true;
  });
  $("payButton").textContent = "Saving your booking…";
  try {
    const data = payload(),
      result = await post("create-booking-v3", data);
    if (!result.bookingId)
      throw new Error(
        "No booking reference was returned. Please contact us before trying again.",
      );
    pending = {
      bookingId: String(result.bookingId),
      bookingReference: String(result.bookingReference || result.bookingId),
      total: Number(result.total),
      depositDue: Number(result.depositDue),
      expiresAt: result.expiresAt || null,
      eventDate: state.date,
    };
    storePending();
    // Keep the booking UI visible while opening Stripe. Recovery is only shown if it fails.
    $("payButton").textContent = "Opening secure payment…";
    await openCheckout(state.payment);
  } catch (error) {
    if (pending) showPending(error.message);
    else showError(2, error.message);
  } finally {
    busy = false;
    document.querySelectorAll("[data-was-disabled]").forEach((el) => {
      el.disabled = el.dataset.wasDisabled === "true";
      delete el.dataset.wasDisabled;
    });
    $("applyPromo").disabled = false;
    if (!pending) render();
  }
}
// Save only the selection, so checking a different date does not discard the customer's choices.
function saveSelection() {
  try {
    sessionStorage.setItem(
      "oggGameSelection",
      JSON.stringify({
        choice: state.choice,
        included: state.included,
        extras: state.extras,
        custom: state.custom,
        golf: state.golf,
      }),
    );
  } catch {}
}
function restoreSelection() {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("oggGameSelection") || "null",
    );
    if (
      !saved ||
      (!P.some((p) => p.id === saved.choice) && saved.choice !== "byo")
    )
      return;
    const valid = (ids) =>
      Array.isArray(ids) &&
      ids.every((id) => G.some((g) => g.id === id)) &&
      new Set(ids).size === ids.length;
    if (
      !["included", "extras", "custom"].every((k) => valid(saved[k])) ||
      ![null, 0, 1, 2, 3].includes(saved.golf)
    )
      return;
    choose(saved.choice);
    state.custom = saved.custom;
    if (saved.choice === "the_mix") state.included = saved.included;
    state.extras = saved.extras.filter((id) => !state.included.includes(id));
    state.golf = pkg()?.golf || saved.golf;
    renderCustom();
    render();
  } catch {}
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.resume) {
    resume(b.dataset.resume);
    return;
  }
  if (b.id === "restartBooking") {
    clearPending();
    sessionStorage.removeItem("oggBooking");
    location.assign("/booking");
    return;
  }
  if (busy || pending) return;
  if (b.dataset.accordion !== undefined) go(+b.dataset.accordion);
  if (b.dataset.package) choose(b.dataset.package);
  if (b.dataset.go !== undefined) go(+b.dataset.go);
  if (b.id === "useDeal") {
    const d = bestDeal();
    if (d) {
      choose(d.p.id, { included: d.included, extras: d.extras, golf: d.golf });
      renderCustom();
      render();
    }
  }
  saveSelection();
});
$("customControls").addEventListener("change", (e) => {
  if (busy || pending) return;
  const t = e.target;
  if (t.dataset.game) {
    const key =
      t.dataset.mode === "included"
        ? "included"
        : t.dataset.mode === "extra"
          ? "extras"
          : "custom";
    if (t.checked) {
      state[key].push(t.dataset.game);
      if (key === "extras" || key === "custom")
        trackBookingEvent("extra_game_added", { detail: t.dataset.game });
    } else state[key] = state[key].filter((id) => id !== t.dataset.game);
    state.extras = state.extras.filter((id) => !state.included.includes(id));
    renderCustom();
  }
  if (t.name === "golf") state.golf = +t.value;
  render();
  saveSelection();
});
$("byoCard").onclick = () => choose("byo");
$("next0").onclick = () => go(1);
$("next1").onclick = () => go(2);
$("mobileNext").onclick = () =>
  state.step === -1 ? $("checkBtn").click() : state.step < 2 ? go(state.step + 1) : reviewSummary();
$("viewSummary").onclick = reviewSummary;
$("bookingForm").onsubmit = (e) => {
  e.preventDefault();
  checkout();
};
document.querySelectorAll("input[name=payment]").forEach(
  (i) =>
    (i.onchange = () => {
      state.payment = i.value;
      render();
    }),
);
$("applyPromo").onclick = applyPromo;
$("promoInput").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    applyPromo();
  }
};
$("removePromo").onclick = () => {
  ++promoRequest;
  state.promo = false;
  $("applyPromo").disabled = false;
  $("promoInput").value = "";
  $("promoFeedback").textContent = "Code removed.";
  render();
};
window.OTGGDateVerified = (data, restored = false) => {
  if (busy || pending || !data?.weddingDate || !data?.venueName || !data?.venuePostcode) return;
  context = data;
  state.date = data.weddingDate;
  state.venue = data.venueName;
  state.postcode = data.venuePostcode;
  state.travel = Number(data.travelFee) || 0;
  state.promo = false; // Venue changes can invalidate discounts.
  ++promoRequest;
  state.unlocked = Math.max(state.unlocked, 0);
  sessionStorage.setItem("oggBooking", JSON.stringify(data));
  if (!restored)
    trackBookingEvent("check_date_continue", { detail: "unified_v2" });
  render();
  go(0, !restored);
};
window.OTGGDateDirty = () => {
  if (busy || pending) return;
  context = null;
  state.promo = false;
  ++promoRequest;
  render();
};

$("bookingForm").addEventListener("input", accordionSummary);
optionalFields();
renderCards();
placeSummary();
const requested = new URLSearchParams(location.search);
const requestedPackage = requested.get("package");
if (P.some(p => p.id === requestedPackage)) choose(requestedPackage);
else if (requested.get("selection") === "minigolf") choose("mini_golf_3");
else restoreSelection();
render();
go(-1, false);
try {
  const id = sessionStorage.getItem("oggPendingBookingId");
  if (id) {
    pending =
      JSON.parse(sessionStorage.getItem("oggPendingPayment") || "null") || {};
    pending.bookingId = id;
    showPending(
      new URLSearchParams(location.search).get("payment") === "cancelled"
        ? "Payment was not completed. You can retry the same saved booking."
        : "",
    );
  }
} catch {}
