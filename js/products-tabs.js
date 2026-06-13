/* =========================================================
   AGL BRASIL — DISTRIBUIDORA OFICIAL NESTI DANTE
   products-tabs.js — Navegação por categorias da seção Produtos
   ========================================================= */

(function () {
  'use strict';

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.products-tab'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.products-panel'));
  if (!tabs.length || !panels.length) return;

  function activate(tab, focusTab) {
    tabs.forEach(function (t) {
      var isActive = t === tab;
      t.classList.toggle('is-active', isActive);
      t.setAttribute('aria-selected', String(isActive));
      t.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    panels.forEach(function (panel) {
      var isActive = panel.id === tab.getAttribute('aria-controls');
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });

    if (focusTab) tab.focus();
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () {
      if (!tab.classList.contains('is-active')) activate(tab);
    });

    tab.addEventListener('keydown', function (event) {
      var newIndex;

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          newIndex = (index + 1) % tabs.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          newIndex = (index - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          newIndex = 0;
          break;
        case 'End':
          newIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      activate(tabs[newIndex], true);
    });
  });
})();
