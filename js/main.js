/* =========================================================
   AGL BRASIL — DISTRIBUIDORA OFICIAL NESTI DANTE
   main.js — Navegação, modal e interações gerais da UI
   ========================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     AOS - Animate On Scroll (reveal suave dos blocos)
     --------------------------------------------------------- */
  if (window.AOS) {
    window.AOS.init({
      duration: 900,
      easing: 'ease-out-cubic',
      once: true,
      offset: 80
    });
  }

  /* ---------------------------------------------------------
     Ano dinâmico no rodapé
     --------------------------------------------------------- */
  var yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  /* ---------------------------------------------------------
     Header com sombra ao rolar a página
     --------------------------------------------------------- */
  var header = document.getElementById('header');

  function handleScroll() {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  /* ---------------------------------------------------------
     Menu mobile (hambúrguer)
     --------------------------------------------------------- */
  var navToggle = document.getElementById('navToggle');
  var nav = document.getElementById('nav');

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove('is-open');
    navToggle.classList.remove('is-active');
    navToggle.setAttribute('aria-expanded', 'false');
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('is-open');
      navToggle.classList.toggle('is-active', isOpen);
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    // Fecha o menu ao clicar em um link
    nav.querySelectorAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', closeNav);
    });
  }

  /* ---------------------------------------------------------
     Modal de Parceria Comercial
     --------------------------------------------------------- */
  var modal = document.getElementById('partnershipModal');
  var openTriggers = document.querySelectorAll('[data-open-modal]');
  var closeTriggers = document.querySelectorAll('[data-close-modal]');
  var lastFocusedElement = null;

  function getFocusableElements() {
    if (!modal) return [];
    return Array.prototype.slice.call(
      modal.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (el) {
      return el.offsetParent !== null;
    });
  }

  function openModal() {
    if (!modal) return;
    lastFocusedElement = document.activeElement;

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    closeNav();

    var focusable = getFocusableElements();
    if (focusable.length) {
      focusable[0].focus();
    }

    document.addEventListener('keydown', handleModalKeydown);
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');

    document.removeEventListener('keydown', handleModalKeydown);

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  function handleModalKeydown(event) {
    if (event.key === 'Escape') {
      closeModal();
      return;
    }

    // Focus trap (Tab / Shift+Tab)
    if (event.key === 'Tab') {
      var focusable = getFocusableElements();
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
  }

  openTriggers.forEach(function (trigger) {
    trigger.addEventListener('click', openModal);
  });

  closeTriggers.forEach(function (trigger) {
    trigger.addEventListener('click', closeModal);
  });

  // Expõe funções para uso pelo form-handler.js
  window.AGLModal = {
    open: openModal,
    close: closeModal
  };

  /* ---------------------------------------------------------
     Faixa de Autoridade — contadores com efeito crescente
     --------------------------------------------------------- */
  var counters = document.querySelectorAll('[data-counter]');

  if (counters.length) {
    var animateCounter = function (el) {
      var target = parseInt(el.getAttribute('data-target'), 10) || 0;
      var start = parseInt(el.getAttribute('data-start'), 10) || 0;
      var duration = 1800;
      var startTime = null;

      var step = function (timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var value = Math.round(start + (target - start) * eased);

        el.textContent = value.toLocaleString('pt-BR');

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = target.toLocaleString('pt-BR');
        }
      };

      requestAnimationFrame(step);
    };

    if ('IntersectionObserver' in window) {
      var counterObserver = new IntersectionObserver(
        function (entries, obs) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              animateCounter(entry.target);
              obs.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.4 }
      );

      counters.forEach(function (el) {
        counterObserver.observe(el);
      });
    } else {
      counters.forEach(function (el) {
        el.textContent = el.getAttribute('data-target');
      });
    }
  }
})();
