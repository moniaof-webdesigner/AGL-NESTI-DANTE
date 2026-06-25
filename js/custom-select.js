/* =========================================================
   AGL BRASIL — DISTRIBUIDORA OFICIAL NESTI DANTE
   custom-select.js — Dropdown customizado (substitui <select>)
   ========================================================= */

(function () {
  'use strict';

  var selects = document.querySelectorAll('.custom-select');
  if (!selects.length) return;

  var segmentoOutroGroup = document.getElementById('segmento-outro-group');
  var segmentoOutroInput = document.getElementById('segmento_outro');

  function toggleSegmentoOutro(show) {
    if (!segmentoOutroGroup) return;
    segmentoOutroGroup.hidden = !show;
    if (segmentoOutroInput) {
      segmentoOutroInput.required = show;
      if (show) {
        segmentoOutroInput.focus();
      } else {
        segmentoOutroInput.value = '';
      }
    }
  }

  selects.forEach(function (wrapper, wrapperIndex) {
    var trigger = wrapper.querySelector('.custom-select__trigger');
    var valueEl = wrapper.querySelector('.custom-select__value');
    var list = wrapper.querySelector('.custom-select__list');
    var hiddenInput = wrapper.querySelector('input[type="hidden"]');
    var options = Array.prototype.slice.call(wrapper.querySelectorAll('.custom-select__option'));
    var activeIndex = -1;

    options.forEach(function (option, index) {
      option.id = (wrapper.dataset.name || 'custom-select-' + wrapperIndex) + '-option-' + index;
    });

    function setActive(index) {
      if (index < 0 || index >= options.length) return;
      options.forEach(function (option) {
        option.classList.remove('is-active');
      });
      options[index].classList.add('is-active');
      options[index].scrollIntoView({ block: 'nearest' });
      trigger.setAttribute('aria-activedescendant', options[index].id);
      activeIndex = index;
    }

    function closeDropdown() {
      wrapper.classList.remove('is-open', 'opens-up');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      options.forEach(function (option) {
        option.classList.remove('is-active');
      });
      activeIndex = -1;
    }

    function openDropdown() {
      document.querySelectorAll('.custom-select.is-open').forEach(function (other) {
        if (other !== wrapper) {
          var otherTrigger = other.querySelector('.custom-select__trigger');
          other.classList.remove('is-open', 'opens-up');
          if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
        }
      });

      wrapper.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');

      var triggerRect = trigger.getBoundingClientRect();
      var spaceBelow = window.innerHeight - triggerRect.bottom;
      var listHeight = list.offsetHeight;
      wrapper.classList.toggle('opens-up', spaceBelow < listHeight + 16 && triggerRect.top > listHeight);

      var selectedIndex = options.findIndex(function (option) {
        return option.classList.contains('is-selected');
      });
      setActive(selectedIndex >= 0 ? selectedIndex : 0);
    }

    function toggleDropdown() {
      if (wrapper.classList.contains('is-open')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    }

    function selectOption(option) {
      options.forEach(function (opt) {
        opt.classList.remove('is-selected');
        opt.setAttribute('aria-selected', 'false');
      });

      option.classList.add('is-selected');
      option.setAttribute('aria-selected', 'true');

      valueEl.textContent = option.textContent;
      valueEl.classList.remove('is-placeholder');

      hiddenInput.value = option.dataset.value;
      hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));

      closeDropdown();
      trigger.focus();

      if (wrapper.dataset.name === 'segmento') {
        toggleSegmentoOutro(option.dataset.value === 'Outro');
      }
    }

    trigger.addEventListener('click', function () {
      toggleDropdown();
    });

    trigger.addEventListener('keydown', function (event) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!wrapper.classList.contains('is-open')) {
            openDropdown();
          } else {
            setActive(Math.min(activeIndex + 1, options.length - 1));
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (!wrapper.classList.contains('is-open')) {
            openDropdown();
          } else {
            setActive(Math.max(activeIndex - 1, 0));
          }
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (wrapper.classList.contains('is-open')) {
            if (activeIndex >= 0) selectOption(options[activeIndex]);
          } else {
            openDropdown();
          }
          break;
        case 'Escape':
          closeDropdown();
          break;
        case 'Tab':
          closeDropdown();
          break;
        default:
          break;
      }
    });

    options.forEach(function (option, index) {
      option.addEventListener('click', function () {
        selectOption(option);
      });
      option.addEventListener('mouseenter', function () {
        setActive(index);
      });
    });
  });

  /* Fecha o dropdown ao clicar fora */
  document.addEventListener('click', function (event) {
    document.querySelectorAll('.custom-select.is-open').forEach(function (wrapper) {
      if (!wrapper.contains(event.target)) {
        var trigger = wrapper.querySelector('.custom-select__trigger');
        wrapper.classList.remove('is-open', 'opens-up');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });
  });

  /* Restaura o estado visual quando o formulário é resetado */
  var form = document.getElementById('partnershipForm');
  if (form) {
    form.addEventListener('reset', function () {
      window.setTimeout(function () {
        selects.forEach(function (wrapper) {
          var valueEl = wrapper.querySelector('.custom-select__value');
          var trigger = wrapper.querySelector('.custom-select__trigger');

          wrapper.querySelectorAll('.custom-select__option').forEach(function (option) {
            option.classList.remove('is-selected', 'is-active');
            option.setAttribute('aria-selected', 'false');
          });

          if (valueEl) {
            valueEl.textContent = valueEl.dataset.placeholder;
            valueEl.classList.add('is-placeholder');
          }

          if (trigger) trigger.classList.remove('is-invalid');

          wrapper.classList.remove('is-open', 'opens-up');
        });

        toggleSegmentoOutro(false);
      }, 0);
    });
  }
})();
