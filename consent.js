(function () {
  'use strict';

  const STORAGE_KEY = 'otgg_cookie_consent_v1';
  const CONSENT_VERSION = 3;
  const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  function normaliseChoice(choice) {
    return {
      personalisation: Boolean(choice && choice.personalisation),
      analytics: Boolean(choice && choice.analytics),
      advertising: Boolean(choice && choice.advertising)
    };
  }

  function readStoredChoice() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== CONSENT_VERSION || !saved.savedAt) {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      if (Date.now() - Number(saved.savedAt) > MAX_AGE_MS) {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return normaliseChoice(saved);
    } catch (error) {
      return null;
    }
  }

  function consentPayload(choice) {
    const current = normaliseChoice(choice);
    return {
      analytics_storage: current.analytics ? 'granted' : 'denied',
      ad_storage: current.advertising ? 'granted' : 'denied',
      ad_user_data: current.advertising ? 'granted' : 'denied',
      ad_personalization: 'denied'
    };
  }

  const storedChoice = readStoredChoice();
  let activeChoice = storedChoice;
  window.gtag('consent', 'default', consentPayload(storedChoice));
  window.gtag('set', 'ads_data_redaction', true);

  function clearCookie(name) {
    const host = window.location.hostname.replace(/^www\./, '');
    const expiry = 'Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = name + '=; expires=' + expiry + '; Max-Age=0; path=/; SameSite=Lax';
    if (host && host.indexOf('.') !== -1) {
      document.cookie = name + '=; expires=' + expiry + '; Max-Age=0; path=/; domain=' + host + '; SameSite=Lax';
      document.cookie = name + '=; expires=' + expiry + '; Max-Age=0; path=/; domain=.' + host + '; SameSite=Lax';
    }
  }

  function clearDisallowedCookies(choice) {
    const names = document.cookie ? document.cookie.split(';').map(function (part) {
      return part.split('=')[0].trim();
    }) : [];
    names.forEach(function (name) {
      const analyticsCookie = name === '_ga' || name === '_gid' || name === '_gat' || name.indexOf('_ga_') === 0 || name === '_clck' || name === '_clsk';
      const advertisingCookie = name.indexOf('_gcl_') === 0 || name.indexOf('_gac_') === 0;
      if ((!choice.analytics && analyticsCookie) || (!choice.advertising && advertisingCookie)) {
        clearCookie(name);
      }
    });
  }

  // Load Microsoft only after an informed Analytics choice. Keep private,
  // token-bearing and unexpected URLs out of replay entirely.
  let clarityLoaded = false;
  const CLARITY_PROJECT = 'z3ovvo5gsr';
  const CLARITY_PATHS = new Set([
    '/', '/index', '/booking', '/check-date', '/packages', '/mini-golf',
    '/giant-games', '/gallery', '/areas-we-cover', '/booking-info', '/privacy',
    '/terms', '/venue-partners', '/wedding-games-hire-cheshire',
    '/wedding-games-hire-greater-manchester', '/wedding-games-hire-lancashire',
    '/wedding-games-hire-merseyside'
  ]);
  const CLARITY_EVENTS = new Set([
    'page_view', 'check_date_started', 'date_selected', 'availability_available',
    'availability_unavailable', 'check_date_continue', 'booking_started',
    'package_selected', 'extra_game_added', 'extras_completed', 'details_reached',
    'promo_code_applied', 'payment_started'
  ]);

  function replayUrlAllowed(value) {
    try {
      const url = new URL(value, window.location.origin);
      // These are the site's public acquisition and package-selection parameters.
      // Never forward arbitrary query parameters (email, booking tokens, etc.).
      const allowed = /^(utm_source|utm_medium|utm_campaign|utm_content|utm_term|gclid|dclid|gbraid|wbraid|fbclid|msclkid|package|selection|payment)$/;
      for (const [key, val] of url.searchParams) {
        if (!allowed.test(key) || !/^[a-zA-Z0-9_.~+ /:-]{0,250}$/.test(val)) return false;
      }
      return !url.hash || /^#[a-zA-Z0-9_-]{1,80}$/.test(url.hash);
    } catch (error) {
      return false;
    }
  }

  function clarityAllowedHere() {
    const path = window.location.pathname.toLowerCase().replace(/\.html$/, '').replace(/\/$/, '') || '/';
    return /^(www\.)?onthegreengames\.co\.uk$/.test(window.location.hostname) &&
      CLARITY_PATHS.has(path) && replayUrlAllowed(window.location.href) &&
      (!document.referrer || replayUrlAllowed(document.referrer));
  }

  function updateClarity(choice) {
    const current = normaliseChoice(choice);
    if (!clarityAllowedHere()) return;
    if (!current.analytics) {
      if (clarityLoaded) {
        window.clarity('consentv2', { analytics_Storage: 'denied', ad_Storage: 'denied' });
        // Stop the already-loaded recorder as well as withdrawing cookie access.
        window.clarity('stop');
      }
      return;
    }
    if (!clarityLoaded) {
      window.clarity = window.clarity || function () {
        (window.clarity.q = window.clarity.q || []).push(arguments);
      };
      window.clarity('consentv2', {
        analytics_Storage: 'granted',
        ad_Storage: current.advertising ? 'granted' : 'denied'
      });
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://www.clarity.ms/tag/' + CLARITY_PROJECT;
      script.setAttribute('data-otgg-clarity', '');
      document.head.appendChild(script);
      clarityLoaded = true;
    } else {
      window.clarity('consentv2', {
        analytics_Storage: 'granted',
        ad_Storage: current.advertising ? 'granted' : 'denied'
      });
      window.clarity('start');
    }
  }

  window.OTGGClarity = {
    track: function (name) {
      if (!clarityLoaded || !activeChoice || !activeChoice.analytics || !clarityAllowedHere()) return;
      // Names only: no customer IDs, promo text, booking references or event detail.
      if (CLARITY_EVENTS.has(name)) window.clarity('event', name);
    }
  };

  function saveChoice(choice) {
    const current = normaliseChoice(choice);
    activeChoice = current;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: CONSENT_VERSION,
        savedAt: Date.now(),
        personalisation: current.personalisation,
        analytics: current.analytics,
        advertising: current.advertising
      }));
    } catch (error) {
      // The choice still applies for this page even if storage is unavailable.
    }
    window.gtag('consent', 'update', consentPayload(current));
    updateClarity(current);
    clearDisallowedCookies(current);
    window.dispatchEvent(new CustomEvent('otgg:consent-changed', { detail: { choice: current } }));
    return current;
  }

  function createConsentUi() {
    const root = document.createElement('div');
    root.id = 'otggConsentRoot';
    root.innerHTML = `
      <div class="cookie-banner" id="cookieBanner" role="region" aria-label="Cookie choices" hidden>
        <div class="cookie-banner__copy">
          <div class="cookie-banner__title">Cookies &amp; privacy</div>
          <p>We use optional personalisation storage to remember previous visits and show relevant offers, analytics cookies and Microsoft Clarity session replays to understand how the website is used, and advertising measurement cookies to tell us whether Google Ads lead to bookings. We do not use these for personalised advertising.</p>
          <a href="/privacy">Privacy &amp; cookie policy</a>
        </div>
        <div class="cookie-banner__actions">
          <button class="btn outline cookie-btn" type="button" data-consent-reject>Reject non-essential</button>
          <button class="btn gold cookie-btn" type="button" data-consent-accept>Accept all</button>
          <button class="btn outline cookie-btn cookie-btn--manage" type="button" data-consent-manage>Manage choices</button>
        </div>
      </div>

      <div class="cookie-modal-backdrop" id="cookieModalBackdrop" hidden>
        <div class="cookie-modal" role="dialog" aria-modal="true" aria-labelledby="cookieModalTitle">
          <button class="cookie-modal__close" type="button" data-consent-close aria-label="Close cookie settings">×</button>
          <div class="eyebrow">Your choices</div>
          <h2 id="cookieModalTitle">Cookie settings</h2>
          <p class="cookie-modal__intro">Necessary storage is always on so the site can remember your cookie choice and provide requested functionality. Optional categories stay off unless you allow them.</p>

          <div class="cookie-choice cookie-choice--locked">
            <div>
              <div class="cookie-choice__title">Necessary</div>
              <p>Used for essential website functions and to remember your cookie preference.</p>
            </div>
            <span class="cookie-always-on">Always on</span>
          </div>

          <label class="cookie-choice" for="cookiePersonalisation">
            <div>
              <div class="cookie-choice__title">Personalisation</div>
              <p>Allows us to remember that you have visited before so we can show relevant on-site offers, and to record anonymous interaction counts for those offers.</p>
            </div>
            <input id="cookiePersonalisation" type="checkbox">
          </label>

          <label class="cookie-choice" for="cookieAnalytics">
            <div>
              <div class="cookie-choice__title">Analytics</div>
              <p>Allows our first-party analytics, Google Analytics and Microsoft Clarity heatmaps and session replays to help us understand website visits and improve booking. Personal form details are masked.</p>
            </div>
            <input id="cookieAnalytics" type="checkbox">
          </label>

          <label class="cookie-choice" for="cookieAdvertising">
            <div>
              <div class="cookie-choice__title">Advertising measurement</div>
              <p>Allows Google Ads measurement to tell us whether an advert click leads to a booking. Personalised advertising and remarketing remain disabled.</p>
            </div>
            <input id="cookieAdvertising" type="checkbox">
          </label>

          <div class="cookie-modal__actions">
            <button class="btn outline cookie-btn" type="button" data-consent-reject>Reject non-essential</button>
            <button class="btn gold cookie-btn" type="button" data-consent-save>Save choices</button>
          </div>
          <p class="cookie-modal__small">You can change these choices at any time using <strong>Cookie settings</strong> in the footer.</p>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const banner = root.querySelector('#cookieBanner');
    const backdrop = root.querySelector('#cookieModalBackdrop');
    const personalisationCheckbox = root.querySelector('#cookiePersonalisation');
    const analyticsCheckbox = root.querySelector('#cookieAnalytics');
    const advertisingCheckbox = root.querySelector('#cookieAdvertising');
    let lastFocusedElement = null;

    function currentChoice() {
      return activeChoice || { personalisation: false, analytics: false, advertising: false };
    }

    function hideBanner() {
      banner.hidden = true;
    }

    function showBanner() {
      banner.hidden = false;
    }

    function openPreferences() {
      const choice = currentChoice();
      personalisationCheckbox.checked = choice.personalisation;
      analyticsCheckbox.checked = choice.analytics;
      advertisingCheckbox.checked = choice.advertising;
      lastFocusedElement = document.activeElement;
      backdrop.hidden = false;
      document.body.classList.add('cookie-modal-open');
      const closeButton = backdrop.querySelector('[data-consent-close]');
      if (closeButton) closeButton.focus();
    }

    function closePreferences() {
      backdrop.hidden = true;
      document.body.classList.remove('cookie-modal-open');
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }
    }

    function applyAndClose(choice) {
      saveChoice(choice);
      hideBanner();
      closePreferences();
    }

    root.querySelectorAll('[data-consent-accept]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyAndClose({ personalisation: true, analytics: true, advertising: true });
      });
    });

    root.querySelectorAll('[data-consent-reject]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyAndClose({ personalisation: false, analytics: false, advertising: false });
      });
    });

    root.querySelectorAll('[data-consent-manage]').forEach(function (button) {
      button.addEventListener('click', openPreferences);
    });

    root.querySelectorAll('[data-consent-close]').forEach(function (button) {
      button.addEventListener('click', closePreferences);
    });

    root.querySelectorAll('[data-consent-save]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyAndClose({
          personalisation: personalisationCheckbox.checked,
          analytics: analyticsCheckbox.checked,
          advertising: advertisingCheckbox.checked
        });
      });
    });

    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) closePreferences();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !backdrop.hidden) closePreferences();
    });

    document.querySelectorAll('[data-cookie-settings]').forEach(function (control) {
      control.addEventListener('click', function (event) {
        event.preventDefault();
        openPreferences();
      });
    });

    window.OTGGConsent = {
      openPreferences: openPreferences,
      getChoice: currentChoice,
      saveChoice: saveChoice
    };

    clearDisallowedCookies(currentChoice());
    updateClarity(currentChoice());
    if (!storedChoice) showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createConsentUi);
  } else {
    createConsentUi();
  }
})();
