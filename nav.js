
/* October 2026 campaign: live through 31 October UK time; pre-existing offers resume on 1 November. */
(function () {
  var campaignStart = Date.parse('2026-10-18T00:00:00+01:00');
  var campaignEnd = Date.parse('2026-11-01T00:00:00+00:00');
  if (Date.now() < campaignStart || Date.now() >= campaignEnd) return;

  function applyOctoberCampaign() {
    var banner = document.querySelector('.promo-bar-text');
    if (banner) {
      banner.innerHTML = '<strong>50% OFF</strong> all bookings until October 31st. Use code <span class="promo-code">OCT50</span> at checkout.';
      var bannerLink = document.querySelector('.promo-bar-link');
      if (bannerLink) bannerLink.remove();
    }

    var feature = document.querySelector('.promo-feature');
    if (feature) {
      var heading = feature.querySelector('h2');
      var description = feature.querySelector('.lede');
      var finePrint = feature.querySelector('.promo-feature-fine');
      if (heading) heading.textContent = '50% off all wedding games & mini golf hire';
      if (description) {
        description.innerHTML = 'Book your date by <strong>31 October</strong> and use code <span class="promo-code promo-code-lg">OCT50</span> at checkout to save 50% on your hire.';
      }
      if (finePrint) {
        finePrint.textContent = 'Book by 31 October 2026. Applies to hire charges, excluding travel fees. Subject to availability.';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyOctoberCampaign, { once: true });
  } else {
    applyOctoberCampaign();
  }
})();

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


  // About Us is a first-level navigation item on every standard public page.
  if (links && !links.querySelector('a[href="/about-us"]')) {
    var aboutLink = document.createElement('a');
    aboutLink.href = '/about-us';
    aboutLink.textContent = 'About Us';
    if (window.location.pathname.replace(/\.html$/, '') === '/about-us') {
      aboutLink.className = 'current';
      aboutLink.setAttribute('aria-current', 'page');
    }
    var bookButton = links.querySelector('a.btn[href="/check-date"], a.btn[href="/booking"]');
    if (bookButton) bookButton.insertAdjacentElement('beforebegin', aboutLink);
    else links.appendChild(aboutLink);
  }
  var footerAboutLinks = document.querySelector('footer .foot-links');
  if (footerAboutLinks && !footerAboutLinks.querySelector('a[href="/about-us"]')) {
    var footerAbout = document.createElement('a');
    footerAbout.href = '/about-us';
    footerAbout.textContent = 'About Us';
    var faqLink = footerAboutLinks.querySelector('a[href="/booking-info"]');
    if (faqLink) faqLink.insertAdjacentElement('beforebegin', footerAbout);
    else footerAboutLinks.appendChild(footerAbout);
  }

  // Footer-only Contact Us link, consistently placed on every standard page.
  var footerLinks = document.querySelector('footer .foot-links');
  if (footerLinks && !footerLinks.querySelector('a[href="/contact"]')) {
    var contactLink = document.createElement('a');
    contactLink.href = '/contact';
    contactLink.textContent = 'Contact Us';
    if (window.location.pathname.replace(/\.html$/, '') === '/contact') {
      contactLink.className = 'current';
      contactLink.setAttribute('aria-current', 'page');
    }
    var termsLink = footerLinks.querySelector('a[href="/terms"]');
    if (termsLink) termsLink.insertAdjacentElement('beforebegin', contactLink);
    else footerLinks.appendChild(contactLink);
  }

  // The compact booking footer also gets a Contact Us link.
  var bookingFooter = document.querySelector('footer.footer-note > div');
  if (bookingFooter && !bookingFooter.querySelector('a[href="/contact"]')) {
    var bookingContact = document.createElement('a');
    bookingContact.href = '/contact';
    bookingContact.textContent = 'Contact Us';
    var separator = document.createTextNode(' · ');
    bookingFooter.appendChild(separator);
    bookingFooter.appendChild(bookingContact);
  }

  // Booking-page marketing preference. PECR soft opt-in requires a clear
  // opportunity to refuse marketing when the email address is collected.
  var emailField = document.getElementById('emailField');
  if (emailField && !document.getElementById('fMarketingOptOut')) {
    if (!document.getElementById('otgg-marketing-optout-styles')) {
      var marketingStyles = document.createElement('style');
      marketingStyles.id = 'otgg-marketing-optout-styles';
      marketingStyles.textContent = [
        '.field label.otgg-marketing-optout{display:flex;align-items:flex-start;gap:9px;margin-top:10px;margin-bottom:0;font-size:12.5px;line-height:1.5;font-weight:400;color:rgba(27,42,32,0.65);cursor:pointer;}',
        '.field label.otgg-marketing-optout span{font-size:12.5px;line-height:1.5;font-weight:400;color:rgba(27,42,32,0.65);}',
        '.field label.otgg-marketing-optout input{width:16px;height:16px;margin:1px 0 0;flex:none;accent-color:var(--green-deep);}',
        '.field label.otgg-marketing-optout a{color:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;text-decoration:underline;text-underline-offset:2px;}'
      ].join('\n');
      document.head.appendChild(marketingStyles);
    }

    var marketingOptOut = document.createElement('label');
    marketingOptOut.className = 'otgg-marketing-optout';
    marketingOptOut.setAttribute('for', 'fMarketingOptOut');
    marketingOptOut.innerHTML = '<input id="fMarketingOptOut" type="checkbox">' +
      '<span>Tick this box if you do not want us to email you about an unfinished booking, similar services or occasional offers. You can opt out at any time. <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.</span>';
    emailField.appendChild(marketingOptOut);

    // booking.html already sends customer.marketing_opt_in to create-booking-v3.
    // It is currently hard-coded false, so adjust only that booking request to
    // reflect the customer's opt-out choice without affecting any other fetch.
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/.netlify/functions/create-booking-v3') !== -1 && init && typeof init.body === 'string') {
          var payload = JSON.parse(init.body);
          if (payload && payload.customer) {
            payload.customer.marketing_opt_in = !document.getElementById('fMarketingOptOut').checked;
            init = Object.assign({}, init, { body: JSON.stringify(payload) });
          }
        }
      } catch (error) {
        console.warn('Could not attach marketing preference to booking request.', error);
      }
      return nativeFetch(input, init);
    };
  }
});

(function () {
  if (document.querySelector('script[data-otgg-site-analytics]')) return;
  var script = document.createElement('script');
  script.src = '/site-analytics.js';
  script.async = false;
  script.setAttribute('data-otgg-site-analytics', '');
  document.head.appendChild(script);
})();

// One shared enquiry widget across public pages, without modifying each template.
(function () {
  if (document.querySelector('script[data-otgg-enquiry-widget]')) return;
  var script = document.createElement('script');
  script.src = '/enquiry-widget.js';
  script.async = false;
  script.setAttribute('data-otgg-enquiry-widget', '');
  document.head.appendChild(script);
})();

/* All historic Check Your Date links now use the unified booking page. */
document.querySelectorAll('a[href^="/check-date"]').forEach(link => {
 const href = link.getAttribute("href");
 link.setAttribute("href", "/booking" + href.substring("/check-date".length));
});
