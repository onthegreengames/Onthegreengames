document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', function () {
  var mobileQuery = window.matchMedia('(max-width: 760px)');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var allRevealItems = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  var revealObservers = [];
  var lastScrollY = window.scrollY;
  var scrollDirection = 'down';

  function updateScrollDirection() {
    var y = window.scrollY;
    if (Math.abs(y - lastScrollY) > 2) {
      scrollDirection = y > lastScrollY ? 'down' : 'up';
      lastScrollY = y;
    }
  }
  window.addEventListener('scroll', updateScrollDirection, { passive: true });

  function setHiddenDirection(el, direction) {
    el.classList.toggle('reveal-from-top', direction === 'top');
    el.classList.toggle('reveal-from-bottom', direction !== 'top');
  }

  function makeViewportRevealObserver(items) {
    if (!items.length) return null;
    if (reducedMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return null;
    }
    var visibleCutoff = mobileQuery.matches ? 0.10 : 0.14;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var visible = entry.isIntersecting && entry.intersectionRatio >= visibleCutoff;
        if (visible) {
          setHiddenDirection(entry.target, scrollDirection === 'up' ? 'top' : 'bottom');
          entry.target.classList.add('is-visible');
        } else {
          setHiddenDirection(entry.target, scrollDirection === 'down' ? 'top' : 'bottom');
          entry.target.classList.remove('is-visible');
        }
      });
    }, {
      threshold: [0, visibleCutoff, 0.25, 0.6],
      rootMargin: mobileQuery.matches ? '0px 0px -4% 0px' : '0px 0px -5% 0px'
    });
    items.forEach(function (el) {
      if (!el.classList.contains('reveal-from-top') && !el.classList.contains('reveal-from-bottom')) {
        setHiddenDirection(el, 'bottom');
      }
      observer.observe(el);
    });
    revealObservers.push(observer);
    return observer;
  }

  function uniqueRails() {
    var rails = Array.prototype.slice.call(document.querySelectorAll('.scorecard, .choice-grid, .swipe-mobile'));
    return rails.filter(function (rail, index) { return rails.indexOf(rail) === index; });
  }

  if (mobileQuery.matches && !reducedMotion && 'IntersectionObserver' in window) {
    var rails = uniqueRails();
    var pageRevealItems = allRevealItems.filter(function (el) {
      return !el.closest('.scorecard, .choice-grid, .swipe-mobile');
    });
    makeViewportRevealObserver(pageRevealItems);

    rails.forEach(function (rail) {
      var cards = Array.prototype.slice.call(rail.querySelectorAll('[data-reveal]'));
      if (!cards.length) return;
      var cutoff = 0.34;
      var lastLeft = rail.scrollLeft;
      var railDirection = 'right';

      rail.addEventListener('scroll', function () {
        var left = rail.scrollLeft;
        if (Math.abs(left - lastLeft) > 1) {
          railDirection = left > lastLeft ? 'right' : 'left';
          lastLeft = left;
        }
      }, { passive: true });

      var railObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var visible = entry.isIntersecting && entry.intersectionRatio >= cutoff;
          if (visible) {
            setHiddenDirection(entry.target, scrollDirection === 'up' ? 'top' : 'bottom');
            entry.target.classList.add('is-visible');
          } else {
            setHiddenDirection(entry.target, railDirection === 'right' ? 'top' : 'bottom');
            entry.target.classList.remove('is-visible');
          }
        });
      }, {
        root: rail,
        threshold: [0, cutoff, 0.6, 0.9],
        rootMargin: '0px -4% 0px -4%'
      });
      cards.forEach(function (card) {
        setHiddenDirection(card, 'bottom');
        railObserver.observe(card);
      });
      revealObservers.push(railObserver);
    });
  } else {
    makeViewportRevealObserver(allRevealItems);
  }

  // Update the compact swipe-position dots used on mobile card rails.
  function initSwipeDots() {
    if (!mobileQuery.matches) return;
    document.querySelectorAll('.mobile-swipe-dots').forEach(function (dots) {
      var railId = dots.getAttribute('data-for');
      var rail = document.getElementById(railId);
      if (!rail) return;
      var dotItems = Array.prototype.slice.call(dots.children);
      function update() {
        var first = rail.firstElementChild;
        var cardWidth = first ? first.getBoundingClientRect().width + 16 : 1;
        var index = Math.max(0, Math.min(dotItems.length - 1, Math.round(rail.scrollLeft / cardWidth)));
        dotItems.forEach(function (dot, i) { dot.classList.toggle('is-active', i === index); });
      }
      rail.addEventListener('scroll', update, { passive: true });
      update();
    });
  }
  initSwipeDots();

  // Homepage only: one-time staged How It Works sequence. After completion it becomes a normal scroll-animated section.
  var section = document.getElementById('howItWorks');
  if (section) {
    var grid = section.querySelector('.process-grid');
    var steps = Array.prototype.slice.call(section.querySelectorAll('.process-step'));
    var buttons = Array.prototype.slice.call(section.querySelectorAll('.process-next'));
    var sequenceStarted = false;
    var sequenceComplete = false;
    var currentStep = -1;
    var timers = [];
    var completedGridObserver = null;

    section.classList.add('process-sequence');

    function clearTimers() {
      timers.forEach(function (id) { window.clearTimeout(id); });
      timers = [];
    }
    function later(fn, ms) {
      var id = window.setTimeout(fn, ms);
      timers.push(id);
      return id;
    }
    function clearStepState() {
      steps.forEach(function (step) { step.classList.remove('stage-active', 'show-number', 'show-copy'); });
      buttons.forEach(function (button) { button.disabled = false; });
    }
    function showStageStep(index) {
      if (sequenceComplete || index < 0 || index >= steps.length) return;
      clearTimers();
      var nextStep = steps[index];
      var current = currentStep >= 0 ? steps[currentStep] : null;
      if (current && current !== nextStep) {
        current.classList.remove('show-copy', 'show-number');
        later(function () { current.classList.remove('stage-active'); }, 210);
      }
      var delay = current && current !== nextStep ? 245 : 0;
      later(function () {
        if (sequenceComplete) return;
        currentStep = index;
        nextStep.classList.add('stage-active');
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { nextStep.classList.add('show-number'); });
        });
        later(function () {
          if (!sequenceComplete && currentStep === index) nextStep.classList.add('show-copy');
        }, 500);
      }, delay);
    }
    function startSequence() {
      if (sequenceStarted || sequenceComplete) return;
      sequenceStarted = true;
      clearStepState();
      showStageStep(0);
    }
    function attachCompletedGridReveal() {
      if (completedGridObserver || !grid) return;
      grid.setAttribute('data-reveal', '');
      grid.style.setProperty('--reveal-delay', '70ms');
      setHiddenDirection(grid, scrollDirection === 'up' ? 'top' : 'bottom');
      grid.classList.add('is-visible');
      completedGridObserver = makeViewportRevealObserver([grid]);
    }
    function finishSequence() {
      if (sequenceComplete || !grid) return;
      sequenceComplete = true;
      clearTimers();
      section.classList.add('is-returning');
      later(function () {
        var startHeight = grid.getBoundingClientRect().height;
        grid.style.height = startHeight + 'px';
        grid.style.minHeight = '0px';
        section.classList.remove('is-returning');
        section.classList.add('is-complete', 'is-normalising');
        clearStepState();
        grid.style.height = 'auto';
        var targetHeight = grid.getBoundingClientRect().height;
        grid.style.height = startHeight + 'px';
        void grid.offsetHeight;
        requestAnimationFrame(function () {
          grid.style.height = targetHeight + 'px';
          requestAnimationFrame(function () { section.classList.remove('is-normalising'); });
        });
        later(function () {
          grid.style.height = '';
          grid.style.minHeight = '';
          attachCompletedGridReveal();
        }, 650);
      }, 330);
    }

    if (reducedMotion) {
      sequenceStarted = true;
      sequenceComplete = true;
      section.classList.add('is-complete');
      clearStepState();
      attachCompletedGridReveal();
    } else if ('IntersectionObserver' in window) {
      var sectionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!sequenceStarted && !sequenceComplete && entry.isIntersecting && entry.intersectionRatio >= 0.16) startSequence();
        });
      }, { threshold: [0, 0.08, 0.16, 0.35], rootMargin: '0px 0px -4% 0px' });
      sectionObserver.observe(section);
    } else {
      startSequence();
    }

    section.addEventListener('click', function (e) {
      var button = e.target.closest('.process-next');
      if (!button || button.disabled || sequenceComplete) return;
      var nextValue = button.getAttribute('data-next-step');
      button.disabled = true;
      if (nextValue === 'complete') { finishSequence(); return; }
      var nextNumber = parseInt(nextValue, 10);
      if (nextNumber) showStageStep(nextNumber - 1);
    });
  }

  // Keyboard support for horizontal card rails on phones.
  document.querySelectorAll('.scorecard, .choice-grid, .swipe-mobile, .process-grid').forEach(function (rail) {
    if (!rail.hasAttribute('tabindex') && (rail.classList.contains('scorecard') || rail.classList.contains('choice-grid') || rail.classList.contains('swipe-mobile'))) {
      rail.setAttribute('tabindex', '0');
    }
    rail.addEventListener('keydown', function (e) {
      if (!mobileQuery.matches || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      if (rail.closest('#howItWorks') && !rail.closest('#howItWorks').classList.contains('is-complete')) return;
      e.preventDefault();
      var card = rail.querySelector('.hole, .choice-card, .process-step, [data-reveal]');
      var amount = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth * 0.86;
      rail.scrollBy({ left: e.key === 'ArrowRight' ? amount : -amount, behavior: 'smooth' });
    });
  });
});
