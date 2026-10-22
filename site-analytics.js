(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/track-site-analytics';
  var CONSENT_KEY = 'otgg_cookie_consent_v1';
  var CONSENT_VERSION = 2;
  var SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  var KEYS = {
    visitor: 'otgg_analytics_visitor_v1',
    firstSession: 'otgg_analytics_first_session_v1',
    session: 'otgg_analytics_session_v1',
    completedBookings: 'otgg_analytics_completed_bookings_v1'
  };
  var initialised = false;
  var identity = null;

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }

  function safeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }

  function makeUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      var random = Math.random() * 16 | 0;
      var value = char === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function normalisePath(pathname) {
    return String(pathname || '/')
      .toLowerCase()
      .replace(/\.html$/, '')
      .replace(/\/$/, '') || '/';
  }

  function analyticsAllowed() {
    try {
      if (window.OTGGConsent && typeof window.OTGGConsent.getChoice === 'function') {
        return Boolean(window.OTGGConsent.getChoice().analytics);
      }
    } catch (e) {}

    try {
      var raw = safeGet(CONSENT_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      return Boolean(saved && saved.version === CONSENT_VERSION && saved.analytics === true);
    } catch (e) {
      return false;
    }
  }

  function clearAnalyticsStorage() {
    safeRemove(KEYS.visitor);
    safeRemove(KEYS.firstSession);
    safeRemove(KEYS.session);
    safeRemove(KEYS.completedBookings);
    identity = null;
  }

  function parseSession(raw) {
    try {
      var value = JSON.parse(raw || 'null');
      if (!value || !value.id || !value.lastActivity) return null;
      return value;
    } catch (e) {
      return null;
    }
  }

  function externalReferrerHost() {
    if (!document.referrer) return null;
    try {
      var ref = new URL(document.referrer);
      var current = window.location.hostname.replace(/^www\./, '').toLowerCase();
      var host = ref.hostname.replace(/^www\./, '').toLowerCase();
      if (!host || host === current) return null;
      return host;
    } catch (e) {
      return null;
    }
  }

  function currentUtms() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      return {
        source: (params.get('utm_source') || '').trim().slice(0, 120) || null,
        medium: (params.get('utm_medium') || '').trim().slice(0, 120) || null,
        campaign: (params.get('utm_campaign') || '').trim().slice(0, 160) || null
      };
    } catch (e) {
      return { source: null, medium: null, campaign: null };
    }
  }

  function deviceCategory() {
    var width = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
    if (!width) return 'unknown';
    if (width <= 767) return 'mobile';
    if (width <= 1100) return 'tablet';
    return 'desktop';
  }

  function ensureIdentity() {
    if (!analyticsAllowed()) return null;

    var now = Date.now();
    var visitorId = safeGet(KEYS.visitor);
    var firstEverVisit = false;

    if (!visitorId) {
      visitorId = makeUuid();
      safeSet(KEYS.visitor, visitorId);
      firstEverVisit = true;
    }

    var session = parseSession(safeGet(KEYS.session));
    var expired = !session || (now - Number(session.lastActivity) >= SESSION_TIMEOUT_MS);

    if (expired) {
      var utms = currentUtms();
      session = {
        id: makeUuid(),
        startedAt: now,
        lastActivity: now,
        landingPagePath: normalisePath(window.location.pathname),
        referrerHost: externalReferrerHost(),
        utmSource: utms.source,
        utmMedium: utms.medium,
        utmCampaign: utms.campaign
      };
      safeSet(KEYS.session, JSON.stringify(session));
    }

    var firstSessionId = safeGet(KEYS.firstSession);
    if (!firstSessionId) {
      firstSessionId = session.id;
      safeSet(KEYS.firstSession, firstSessionId);
    }

    session.lastActivity = now;
    safeSet(KEYS.session, JSON.stringify(session));

    identity = {
      visitorId: visitorId,
      session: session,
      isNewVisitor: firstEverVisit || firstSessionId === session.id
    };
    return identity;
  }

  function touchSession() {
    if (!identity || !identity.session) return;
    identity.session.lastActivity = Date.now();
    safeSet(KEYS.session, JSON.stringify(identity.session));
  }

  function track(eventName, options) {
    if (!analyticsAllowed()) return;
    var current = identity || ensureIdentity();
    if (!current) return;

    touchSession();
    options = options || {};

    var payload = JSON.stringify({
      eventId: makeUuid(),
      visitorId: current.visitorId,
      sessionId: current.session.id,
      eventName: eventName,
      pagePath: normalisePath(window.location.pathname),
      landingPagePath: current.session.landingPagePath || '/',
      referrerHost: current.session.referrerHost || null,
      utmSource: current.session.utmSource || null,
      utmMedium: current.session.utmMedium || null,
      utmCampaign: current.session.utmCampaign || null,
      deviceCategory: deviceCategory(),
      eventDetail: options.detail || null,
      promoCode: options.promoCode || null,
      bookingReference: options.bookingReference || null,
      isNewVisitor: current.isNewVisitor === true
    });

    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
        credentials: 'same-origin'
      }).catch(function () {});
    } catch (e) {}
  }

  function setupCheckDateTracking(path) {
    if (path !== '/check-date' && path !== '/booking') return;
    // This step is embedded in /booking from the four-step launch onwards.
    track('check_date_started', { detail: path === '/booking' ? 'unified_v2' : 'legacy' });

    var result = document.getElementById('availResult');
    var lastResultSignature = '';

    function recordAvailability() {
      if (!result || !result.classList.contains('show')) return;
      var type = result.classList.contains('available')
        ? 'availability_available'
        : result.classList.contains('unavailable')
          ? 'availability_unavailable'
          : null;
      if (!type) return;

      var title = document.getElementById('availTitle');
      var body = document.getElementById('availBody');
      var signature = type + '|' + (title ? title.textContent : '') + '|' + (body ? body.textContent : '');
      if (signature === lastResultSignature) return;
      lastResultSignature = signature;
      track(type);
    }

    if (result && 'MutationObserver' in window) {
      new MutationObserver(recordAvailability).observe(result, {
        attributes: true,
        childList: true,
        subtree: true
      });
      recordAvailability();
    }

    document.addEventListener('click', function (event) {
      var day = event.target.closest('.cal-day');
      if (day && !day.classList.contains('cal-disabled') && !day.classList.contains('cal-blocked') && !day.classList.contains('cal-not-open') && !day.classList.contains('cal-empty')) {
        lastResultSignature = '';
        track('date_selected');
      }

      var continueButton = event.target.closest('#checkBtn');
      if (continueButton && path === '/check-date') {
        // Legacy page only. The unified page emits this after server-side
        // availability and postcode checks have actually succeeded.
        var available = result && result.classList.contains('show') && result.classList.contains('available');
        if (available) track('check_date_continue', { detail: 'legacy' });
      }
    });
  }

  function setupBookingTracking(path) {
    if (path !== '/booking') return;
    track('booking_started');

    // The unified booking UI emits these events only after the relevant
    // step validation has succeeded. Do not infer them from old element IDs.
    // booking_started remains a page entry event for historic compatibility.
  }

  function readCompletedBookings() {
    try {
      var parsed = JSON.parse(safeGet(KEYS.completedBookings) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function markBookingCompleted(key) {
    var completed = readCompletedBookings();
    if (completed.indexOf(key) !== -1) return false;
    completed.push(key);
    if (completed.length > 25) completed = completed.slice(completed.length - 25);
    safeSet(KEYS.completedBookings, JSON.stringify(completed));
    return true;
  }

  function setupConfirmationTracking(path) {
    if (path !== '/booking-confirmed') return;
    var confirmed = document.getElementById('confirmedState');
    if (!confirmed) return;

    function recordConfirmation() {
      if (confirmed.hidden) return;
      var referenceEl = document.getElementById('bookingReference');
      var eyebrow = document.getElementById('confirmedEyebrow');
      var reference = referenceEl ? String(referenceEl.textContent || '').trim() : '';
      if (!reference || reference === '—') return;

      var isBalance = eyebrow && /balance paid/i.test(eyebrow.textContent || '');
      var eventName = isBalance ? 'balance_payment_completed' : 'booking_completed';
      var completionKey = eventName + ':' + reference;
      if (!markBookingCompleted(completionKey)) return;
      track(eventName, { bookingReference: reference });
    }

    if ('MutationObserver' in window) {
      new MutationObserver(recordConfirmation).observe(confirmed, {
        attributes: true,
        childList: true,
        subtree: true
      });
    }
    recordConfirmation();
  }

  function start() {
    if (!analyticsAllowed()) {
      clearAnalyticsStorage();
      initialised = false;
      return;
    }
    if (initialised) return;
    initialised = true;
    ensureIdentity();

    var path = normalisePath(window.location.pathname);
    track('page_view');
    setupCheckDateTracking(path);
    setupBookingTracking(path);
    setupConfirmationTracking(path);
  }

  window.OTGGAnalytics = {
    track: function (eventName, options) {
      track(eventName, options || {});
    }
  };

  window.addEventListener('otgg:consent-changed', function (event) {
    var choice = event && event.detail && event.detail.choice;
    if (!choice || !choice.analytics) {
      clearAnalyticsStorage();
      initialised = false;
      return;
    }
    start();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
