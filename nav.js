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
});
