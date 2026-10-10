(function () {
  'use strict';

  var OFFER_CODE = 'BIRDIE40';
  var RETURN_GAP_MS = 30 * 60 * 1000;
  var SHOW_DELAY_MS = 4000;
  var STORAGE = {
    firstSeen: 'otgg_first_seen_v1',
    lastSeen: 'otgg_last_seen_v1',
    session: 'otgg_visit_session_v1',
    dismissed: 'otgg_birdie40_dismissed_v1',
    booked: 'otgg_customer_booked_v1',
    usedCode: 'otgg_birdie40_used_v1'
  };

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }

  function safeSessionGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSessionSet(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (e) {}
  }

  function normalisePath() {
    return (window.location.pathname || '/').toLowerCase().replace(/\.html$/, '').replace(/\/$/, '') || '/';
  }

  function isBookingFlow(path) {
    return path === '/check-date' ||
      path === '/booking' ||
      path === '/booking-confirmed' ||
      path === '/additional-details' ||
      path.indexOf('/payment') === 0 ||
      path.indexOf('/balance') === 0;
  }

  function markBookingState(path) {
    if (path === '/booking-confirmed') safeSet(STORAGE.booked, '1');

    document.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !target.matches || !target.matches('#promoCodeInput, input[name*="promo" i], input[id*="promo" i]')) return;
      if (String(target.value || '').trim().toUpperCase() === OFFER_CODE) safeSet(STORAGE.usedCode, '1');
    });

    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('#promoApplyBtn, .promo-apply') : null;
      if (!button) return;
      var input = document.querySelector('#promoCodeInput, input[name*="promo" i], input[id*="promo" i]');
      if (input && String(input.value || '').trim().toUpperCase() === OFFER_CODE) safeSet(STORAGE.usedCode, '1');
    });
  }

  function injectStyles() {
    if (document.getElementById('otggReturnOfferStyles')) return;
    var style = document.createElement('style');
    style.id = 'otggReturnOfferStyles';
    style.textContent = [
      '.otgg-return-offer{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(18,30,22,.58);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;visibility:hidden;transition:opacity .22s ease,visibility .22s ease}',
      '.otgg-return-offer.is-open{opacity:1;visibility:visible}',
      '.otgg-return-offer__card{position:relative;width:min(470px,100%);max-height:calc(100vh - 48px);overflow:auto;border:1px solid rgba(231,206,155,.28);border-radius:22px;padding:34px 34px 28px;background:#1E4734;color:#FAF3E6;box-shadow:0 28px 80px rgba(15,28,20,.38);text-align:center;transform:translateY(10px) scale(.985);transition:transform .22s ease}',
      '.otgg-return-offer.is-open .otgg-return-offer__card{transform:translateY(0) scale(1)}',
      '.otgg-return-offer__close{position:absolute;right:16px;top:14px;width:38px;height:38px;border:0;border-radius:50%;background:transparent;color:#FAF3E6;font:300 31px/34px Inter,sans-serif;cursor:pointer;opacity:.82}',
      '.otgg-return-offer__close:hover{background:rgba(255,255,255,.08);opacity:1}',
      '.otgg-return-offer__mark{position:relative;width:44px;height:44px;margin:0 auto 14px;border-radius:50%;background:rgba(231,206,155,.12);border:1px solid rgba(231,206,155,.28)}',
      '.otgg-return-offer__mark::before{content:"";position:absolute;left:16px;top:9px;width:2px;height:25px;border-radius:2px;background:#E7CE9B}',
      '.otgg-return-offer__mark::after{content:"";position:absolute;left:18px;top:10px;width:0;height:0;border-top:6px solid transparent;border-bottom:6px solid transparent;border-left:14px solid #E7CE9B}',
      '.otgg-return-offer__title{margin:0;font-family:"Playfair Display",serif;font-size:35px;line-height:1.12;font-weight:600;letter-spacing:-.02em;color:#FAF3E6}',
      '.otgg-return-offer__intro{margin:12px auto 23px;max-width:330px;font:400 15px/1.55 Inter,sans-serif;color:rgba(250,243,230,.82)}',
      '.otgg-return-offer__deal{border:1px solid rgba(231,206,155,.55);border-radius:15px;padding:19px 20px 18px;background:rgba(255,255,255,.035)}',
      '.otgg-return-offer__amount{font-family:"Playfair Display",serif;font-size:43px;line-height:1;font-weight:600;color:#E7CE9B}',
      '.otgg-return-offer__label{margin-top:9px;font:500 13px/1.4 Inter,sans-serif;color:rgba(250,243,230,.78)}',
      '.otgg-return-offer__code-row{display:flex;align-items:stretch;justify-content:center;gap:9px;margin-top:12px}',
      '.otgg-return-offer__code{min-width:142px;padding:10px 14px;border:1px solid rgba(250,243,230,.7);border-radius:9px;background:rgba(0,0,0,.08);font:700 17px/1.2 Inter,sans-serif;letter-spacing:.08em;color:#fff}',
      '.otgg-return-offer__copy{padding:9px 12px;border:0;border-radius:9px;background:rgba(0,0,0,.12);color:#FAF3E6;font:600 12px/1.2 Inter,sans-serif;cursor:pointer}',
      '.otgg-return-offer__copy:hover{background:rgba(0,0,0,.2)}',
      '.otgg-return-offer__cta{display:flex;align-items:center;justify-content:center;width:100%;margin-top:20px;padding:14px 18px;border-radius:11px;background:#E7CE9B;color:#1B2A20;font:700 14px/1.2 Inter,sans-serif;text-decoration:none;transition:transform .15s ease,filter .15s ease}',
      '.otgg-return-offer__cta:hover{transform:translateY(-1px);filter:brightness(1.03)}',
      '.otgg-return-offer__fine{margin:13px 0 0;font:400 11px/1.4 Inter,sans-serif;color:rgba(250,243,230,.58)}',
      '.otgg-return-offer__sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}',
      'body.otgg-offer-open{overflow:hidden}',
      '@media(max-width:560px){.otgg-return-offer{padding:18px}.otgg-return-offer__card{padding:31px 20px 23px;border-radius:18px}.otgg-return-offer__title{font-size:29px}.otgg-return-offer__intro{font-size:14px;margin-bottom:19px}.otgg-return-offer__deal{padding:17px 14px}.otgg-return-offer__amount{font-size:38px}.otgg-return-offer__code-row{gap:7px}.otgg-return-offer__code{min-width:0;flex:1;font-size:15px}.otgg-return-offer__copy{flex:none}.otgg-return-offer__cta{margin-top:16px}}',
      '@media(prefers-reduced-motion:reduce){.otgg-return-offer,.otgg-return-offer__card,.otgg-return-offer__cta{transition:none!important}}'
    ].join('');
    document.head.appendChild(style);
  }

  function createOffer() {
    injectStyles();

    var overlay = document.createElement('div');
    overlay.className = 'otgg-return-offer';
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML = [
      '<section class="otgg-return-offer__card" role="dialog" aria-modal="true" aria-labelledby="otggReturnOfferTitle" aria-describedby="otggReturnOfferIntro">',
      '<button class="otgg-return-offer__close" type="button" aria-label="Close offer">&times;</button>',
      '<div class="otgg-return-offer__mark" aria-hidden="true"></div>',
      '<h2 class="otgg-return-offer__title" id="otggReturnOfferTitle">Still thinking it over?</h2>',
      '<p class="otgg-return-offer__intro" id="otggReturnOfferIntro">We’d love to have you with us.</p>',
      '<div class="otgg-return-offer__deal">',
      '<div class="otgg-return-offer__amount">40% OFF</div>',
      '<div class="otgg-return-offer__label">Use code</div>',
      '<div class="otgg-return-offer__code-row">',
      '<div class="otgg-return-offer__code" aria-label="Promo code BIRDIE40">BIRDIE40</div>',
      '<button class="otgg-return-offer__copy" type="button">Copy code</button>',
      '</div>',
      '</div>',
      '<a class="otgg-return-offer__cta" href="/check-date">Book Now&nbsp;&nbsp;→</a>',
      '<p class="otgg-return-offer__fine">Offer available for a limited time.</p>',
      '<span class="otgg-return-offer__sr" aria-live="polite"></span>',
      '</section>'
    ].join('');

    document.body.appendChild(overlay);

    var closeButton = overlay.querySelector('.otgg-return-offer__close');
    var copyButton = overlay.querySelector('.otgg-return-offer__copy');
    var cta = overlay.querySelector('.otgg-return-offer__cta');
    var live = overlay.querySelector('.otgg-return-offer__sr');
    var previousFocus = document.activeElement;

    function closeOffer(markDismissed) {
      if (markDismissed) safeSet(STORAGE.dismissed, '1');
      overlay.classList.remove('is-open');
      document.body.classList.remove('otgg-offer-open');
      window.setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (previousFocus && previousFocus.focus) previousFocus.focus();
      }, 230);
    }

    closeButton.addEventListener('click', function () { closeOffer(true); });
    cta.addEventListener('click', function () { safeSet(STORAGE.dismissed, '1'); });

    copyButton.addEventListener('click', function () {
      function copied() {
        copyButton.textContent = 'Copied';
        live.textContent = 'Promo code BIRDIE40 copied.';
        window.setTimeout(function () { copyButton.textContent = 'Copy code'; }, 1800);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(OFFER_CODE).then(copied).catch(function () {});
      } else {
        var temp = document.createElement('textarea');
        temp.value = OFFER_CODE;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        try { document.execCommand('copy'); copied(); } catch (e) {}
        document.body.removeChild(temp);
      }
    });

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeOffer(true);
    });

    document.addEventListener('keydown', function onKeydown(event) {
      if (!overlay.parentNode) {
        document.removeEventListener('keydown', onKeydown);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOffer(true);
      }
      if (event.key === 'Tab') {
        var focusable = Array.prototype.slice.call(overlay.querySelectorAll('button, a[href]'));
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    requestAnimationFrame(function () {
      overlay.classList.add('is-open');
      document.body.classList.add('otgg-offer-open');
      closeButton.focus();
    });
  }

  function init() {
    var path = normalisePath();
    markBookingState(path);

    var now = Date.now();
    var firstSeen = parseInt(safeGet(STORAGE.firstSeen), 10);
    var lastSeen = parseInt(safeGet(STORAGE.lastSeen), 10);
    var activeSession = safeSessionGet(STORAGE.session) === '1';

    if (!firstSeen) {
      safeSet(STORAGE.firstSeen, String(now));
      safeSet(STORAGE.lastSeen, String(now));
      safeSessionSet(STORAGE.session, '1');
      return;
    }

    var isReturningVisit = !activeSession && !!lastSeen && (now - lastSeen >= RETURN_GAP_MS);
    safeSet(STORAGE.lastSeen, String(now));
    safeSessionSet(STORAGE.session, '1');

    if (!isReturningVisit || isBookingFlow(path)) return;
    if (safeGet(STORAGE.dismissed) === '1' || safeGet(STORAGE.booked) === '1' || safeGet(STORAGE.usedCode) === '1') return;

    window.setTimeout(function () {
      if (document.visibilityState === 'hidden') return;
      if (document.querySelector('.otgg-return-offer')) return;
      createOffer();
    }, SHOW_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
