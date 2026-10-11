document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  var trigger = document.getElementById('exploreTrigger');
  var panel = document.getElementById('explorePanel');

  if (trigger && panel) {
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = panel.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== trigger) {
        panel.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        panel.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Subtle shadow on the sticky nav once the page has actually scrolled,
  // so it doesn't look like a flat bar sitting on top of the content.
  var navWrap = document.querySelector('.nav-wrap');
  if (navWrap) {
    var toggleShadow = function () {
      navWrap.classList.toggle('scrolled', window.scrollY > 4);
    };
    window.addEventListener('scroll', toggleShadow, { passive: true });
    toggleShadow();
  }

  // Social links are added from the shared nav script so they stay consistent
  // across every page that uses the standard OTGG navigation/footer.
  var socialProfiles = [
    {
      name: 'Instagram',
      url: 'https://www.instagram.com/onthegreengames/',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"></rect><circle cx="12" cy="12" r="4.25"></circle><circle cx="17.4" cy="6.7" r="1"></circle></svg>'
    },
    {
      name: 'Facebook',
      url: 'https://www.facebook.com/61594890774061/',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.4 21v-8h2.8l.42-3.2H14.4V7.76c0-.93.26-1.56 1.62-1.56H17.75V3.34c-.3-.04-1.32-.13-2.5-.13-2.48 0-4.17 1.51-4.17 4.29v2.3H8.27V13h2.81v8h3.32z"></path></svg>'
    }
  ];

  var socialLinkMarkup = function (profile, compact) {
    return '<a class="otgg-social-link' + (compact ? ' compact' : '') + '" href="' + profile.url + '" target="_blank" rel="noopener noreferrer" aria-label="Follow On The Green Games on ' + profile.name + '">' +
      profile.icon + '<span>' + profile.name + '</span></a>';
  };

  if (!document.getElementById('otgg-social-styles')) {
    var socialStyles = document.createElement('style');
    socialStyles.id = 'otgg-social-styles';
    socialStyles.textContent = [
      '.otgg-footer-socials{display:flex;align-items:center;gap:14px;font-size:13.5px;}',
      '.otgg-social-label{font-weight:600;color:var(--ink);opacity:.72;}',
      '.otgg-social-links{display:flex;align-items:center;gap:14px;}',
      '.otgg-social-link{display:inline-flex;align-items:center;gap:7px;color:var(--green-deep);font-weight:600;opacity:.82;transition:opacity .15s ease,transform .15s ease;}',
      '.otgg-social-link:hover{opacity:1;transform:translateY(-1px);}',
      '.otgg-social-link svg{width:18px;height:18px;display:block;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;}',
      '.otgg-social-link[href*="facebook"] svg{fill:currentColor;stroke:none;}',
      '.otgg-mobile-socials{display:none;}',
      '@media (max-width:880px){',
      '  .otgg-footer-socials{width:100%;flex-wrap:wrap;gap:10px 14px;}',
      '  .otgg-social-links{gap:18px;}',
      '  .otgg-mobile-socials{display:flex;width:100%;align-items:center;gap:20px;margin-top:4px;padding-top:18px;border-top:1px solid var(--green-line);}',
      '  .otgg-mobile-socials .otgg-social-link{width:auto!important;font-size:13.5px;}',
      '  .otgg-mobile-socials .otgg-social-link span{display:inline;}',
      '}',
      '@media (prefers-reduced-motion:reduce){.otgg-social-link{transition:none;}}'
    ].join('\n');
    document.head.appendChild(socialStyles);
  }

  var footerRow = document.querySelector('footer .foot-row');
  if (footerRow && !footerRow.querySelector('.otgg-footer-socials')) {
    var footerSocials = document.createElement('div');
    footerSocials.className = 'otgg-footer-socials';
    footerSocials.innerHTML = '<span class="otgg-social-label">Follow us</span><div class="otgg-social-links">' +
      socialProfiles.map(function (profile) { return socialLinkMarkup(profile, false); }).join('') +
      '</div>';

    var firstFootNote = footerRow.querySelector('.foot-note');
    if (firstFootNote) {
      firstFootNote.insertAdjacentElement('afterend', footerSocials);
    } else {
      footerRow.appendChild(footerSocials);
    }
  }

  if (links && !links.querySelector('.otgg-mobile-socials')) {
    var mobileSocials = document.createElement('div');
    mobileSocials.className = 'otgg-mobile-socials';
    mobileSocials.setAttribute('aria-label', 'Social media');
    mobileSocials.innerHTML = socialProfiles.map(function (profile) {
      return socialLinkMarkup(profile, true);
    }).join('');
    links.appendChild(mobileSocials);
  }
});

(function () {
  if (document.querySelector('script[data-otgg-site-analytics]')) return;
  var script = document.createElement('script');
  script.src = '/site-analytics.js';
  script.async = true;
  script.setAttribute('data-otgg-site-analytics', '');
  document.head.appendChild(script);
})();
