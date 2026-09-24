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

  /* ------------------------------------------------------------------
     Phone swipe rails.
     Cards in a rail no longer fade in and out individually as they scroll
     sideways (that hid the peeking next card, so rows looked like a single
     card). Instead each rail staggers its cards in from the right once, the
     first time it enters the viewport, then stays put. Every rail gets
     position dots and a "Swipe" hint, plus a one-off nudge so it's obvious
     the row moves.
     ------------------------------------------------------------------ */
  var railIdCounter = 0;

  function railCards(rail) {
    return Array.prototype.slice.call(rail.children).filter(function (el) {
      return el.nodeType === 1;
    });
  }

  function ensureDots(rail) {
    if (!rail.id) rail.id = 'swipeRail' + (++railIdCounter);
    var dots = document.querySelector('.mobile-swipe-dots[data-for="' + rail.id + '"]');
    var count = railCards(rail).length;
    if (!dots) {
      dots = document.createElement('div');
      dots.className = 'mobile-swipe-dots';
      dots.setAttribute('data-for', rail.id);
      rail.insertAdjacentElement('afterend', dots);
    }
    // Rebuild the dots so the count always matches the cards.
    dots.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var dot = document.createElement('span');
      if (i === 0) dot.className = 'is-active';
      dots.appendChild(dot);
    }
    var hint = document.createElement('em');
    hint.className = 'swipe-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.innerHTML = 'Swipe <b>→</b>';
    dots.appendChild(hint);
    return dots;
  }

  function nearestIndex(rail, cards) {
    var left = rail.scrollLeft;
    var best = 0;
    var bestDist = Infinity;
    cards.forEach(function (card, i) {
      var d = Math.abs(card.offsetLeft - rail.firstElementChild.offsetLeft - left);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    // At the very end of the rail, the last card counts as active.
    if (left + rail.clientWidth >= rail.scrollWidth - 4) best = cards.length - 1;
    return best;
  }

  function initRail(rail, options) {
    var cards = railCards(rail);
    if (cards.length < 2) return;
    var dots = ensureDots(rail);
    var dotItems = Array.prototype.slice.call(dots.querySelectorAll('span'));
    var interacted = false;

    function update() {
      var index = nearestIndex(rail, cards);
      dotItems.forEach(function (dot, i) { dot.classList.toggle('is-active', i === index); });
      dots.classList.toggle('at-end', index === cards.length - 1);
    }

    function markInteracted() {
      if (interacted) return;
      interacted = true;
      rail.classList.remove('rail-nudge');
      dots.classList.add('hint-done');
    }

    rail.addEventListener('scroll', function () {
      update();
      // Small shifts happen on their own as the snap settles; only a real swipe counts.
      if (rail.scrollLeft > 40) markInteracted();
    }, { passive: true });
    rail.addEventListener('touchstart', markInteracted, { passive: true });
    rail.addEventListener('pointerdown', markInteracted, { passive: true });

    // Tapping a dot jumps to that card.
    dotItems.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        markInteracted();
        rail.scrollTo({
          left: cards[i].offsetLeft - cards[0].offsetLeft,
          behavior: reducedMotion ? 'auto' : 'smooth'
        });
      });
    });
    update();

    if (options.animateCards) {
      cards.forEach(function (card, i) {
        card.removeAttribute('data-reveal');
        card.classList.add('rail-card');
        card.style.setProperty('--rail-i', Math.min(i, 3));
      });
    }

    function enter() {
      rail.classList.add('rail-in');
      if (reducedMotion || options.nudge === false) return;
      // One gentle nudge after the cards have settled, only if the visitor
      // hasn't already started swiping.
      window.setTimeout(function () {
        if (interacted) return;
        rail.classList.add('rail-nudge');
        window.setTimeout(function () { rail.classList.remove('rail-nudge'); }, 1100);
      }, options.animateCards ? 750 : 250);
    }

    if (reducedMotion || !('IntersectionObserver' in window)) {
      rail.classList.add('rail-in');
      return;
    }
    var railObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          railObserver.disconnect();
          enter();
        }
      });
    }, { threshold: [0, 0.35, 0.6] });
    railObserver.observe(rail);
  }

  if (mobileQuery.matches) {
    var rails = uniqueRails();
    var pageRevealItems = allRevealItems.filter(function (el) {
      return !rails.some(function (rail) { return rail.contains(el) && rail !== el; });
    });
    makeViewportRevealObserver(pageRevealItems);
    rails.forEach(function (rail) { initRail(rail, { animateCards: true }); });
  } else {
    makeViewportRevealObserver(allRevealItems);
  }

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
      // On phones the finished steps become a swipe rail, so give it dots and a hint too.
      if (mobileQuery.matches) initRail(grid, { animateCards: false });
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
      var card = rail.querySelector('.hole, .choice-card, .process-step, .rail-card, [data-reveal]');
      var amount = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth * 0.86;
      rail.scrollBy({ left: e.key === 'ArrowRight' ? amount : -amount, behavior: 'smooth' });
    });
  });
});
