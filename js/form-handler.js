/* =========================================================
   AGL BRASIL — DISTRIBUIDORA OFICIAL NESTI DANTE
   form-handler.js — Validação e envio dos dados do formulário
   de parceria ao Google Sheets (Apps Script)
   ========================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     CONFIGURAÇÃO
     ---------------------------------------------------------
     GAS_WEB_APP_URL: cole aqui a URL do Web App publicado
     a partir do Google Apps Script (veja docs/google-apps-script.md).
     --------------------------------------------------------- */
  var CONFIG = {
    GAS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwfdkSUri4EzS1CXtv3cR00oLzcoMHTZQajauN7Rq6S7qf3SnKpBZSYQbgCWATtPcO3/exec'
  };

  /* ---------------------------------------------------------
     Captura de UTMs (tráfego pago: Meta Ads / Google Ads)
     ---------------------------------------------------------
     Lê os parâmetros utm_* da URL assim que a página carrega e
     guarda em sessionStorage, para que continuem disponíveis
     mesmo que o usuário navegue pela página antes de abrir o
     pop-up. Os valores são gravados nos campos ocultos do
     formulário logo abaixo.
     --------------------------------------------------------- */
  var UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function captureUTMs() {
    var params = new URLSearchParams(window.location.search);

    UTM_FIELDS.forEach(function (key) {
      var value = params.get(key);

      if (value) {
        try {
          window.sessionStorage.setItem(key, value);
        } catch (e) {
          /* sessionStorage indisponível (ex.: navegação privada) */
        }
      }
    });
  }

  function fillUTMFields(form) {
    UTM_FIELDS.forEach(function (key) {
      var field = form.querySelector('[name="' + key + '"]');
      if (!field) return;

      var value = '';
      try {
        value = window.sessionStorage.getItem(key) || '';
      } catch (e) {
        value = '';
      }

      field.value = value;
    });
  }

  captureUTMs();

  var form = document.getElementById('partnershipForm');
  if (!form) return;

  fillUTMFields(form);

  var submitBtn = document.getElementById('submitBtn');
  var feedbackEl = document.getElementById('formFeedback');
  var formStep = document.getElementById('modalFormStep');
  var successStep = document.getElementById('modalSuccessStep');

  /* ---------------------------------------------------------
     Regras de validação por campo
     --------------------------------------------------------- */
  var validators = {
    nome: function (value) {
      return value.trim().length >= 3 ? '' : 'Informe seu nome completo.';
    },
    email: function (value) {
      var pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return pattern.test(value.trim()) ? '' : 'Informe um e-mail válido.';
    },
    telefone: function (value) {
      var digits = value.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 11
        ? ''
        : 'Informe um WhatsApp válido com DDD.';
    },
    empresa: function (value) {
      return value.trim().length >= 2 ? '' : 'Informe o nome da empresa.';
    },
    cnpj: function (value) {
      if (!value.trim()) return '';
      var digits = value.replace(/\D/g, '');
      return digits.length === 14 ? '' : 'Informe um CNPJ válido (14 dígitos) ou deixe em branco.';
    },
    segmento: function (value) {
      return value ? '' : 'Selecione o segmento da sua empresa.';
    },
    cargo: function () {
      return '';
    },
    premium: function () {
      return '';
    },
    origem: function () {
      return '';
    }
  };

  /* ---------------------------------------------------------
     Máscaras simples (telefone e CNPJ)
     --------------------------------------------------------- */
  function maskPhone(value) {
    var digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length > 10) {
      return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
    }
    if (digits.length > 6) {
      return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
    }
    if (digits.length > 2) {
      return digits.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    }
    return digits;
  }

  function maskCNPJ(value) {
    var digits = value.replace(/\D/g, '').slice(0, 14);
    return digits
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
  }

  var telefoneInput = document.getElementById('telefone');
  var cnpjInput = document.getElementById('cnpj');

  if (telefoneInput) {
    telefoneInput.addEventListener('input', function (e) {
      e.target.value = maskPhone(e.target.value);
    });
  }

  if (cnpjInput) {
    cnpjInput.addEventListener('input', function (e) {
      e.target.value = maskCNPJ(e.target.value);
    });
  }

  /* ---------------------------------------------------------
     Funções auxiliares de validação visual
     --------------------------------------------------------- */
  function showFieldError(name, message) {
    var errorEl = document.getElementById('error-' + name);
    var field = form.querySelector('[name="' + name + '"]');

    if (errorEl) {
      errorEl.textContent = message;
    }

    if (field) {
      if (field.type === 'radio') {
        form.querySelectorAll('[name="' + name + '"]').forEach(function (el) {
          el.closest('.form__radio') && el.closest('.form__radio').classList.toggle('is-invalid', !!message);
        });
      } else if (field.type === 'hidden' && field.closest('.custom-select')) {
        var trigger = field.closest('.custom-select').querySelector('.custom-select__trigger');
        if (trigger) trigger.classList.toggle('is-invalid', !!message);
      } else {
        field.classList.toggle('is-invalid', !!message);
      }
    }
  }

  function getFieldValue(name) {
    var field = form.querySelector('[name="' + name + '"]:checked, [name="' + name + '"]');
    if (!field) return '';

    if (field.type === 'radio') {
      var checked = form.querySelector('[name="' + name + '"]:checked');
      return checked ? checked.value : '';
    }

    return field.value;
  }

  function validateForm() {
    var isValid = true;
    var data = {};

    Object.keys(validators).forEach(function (name) {
      var value = getFieldValue(name);
      var error = validators[name](value);

      data[name] = value;
      showFieldError(name, error);

      if (error) {
        isValid = false;
      }
    });

    return { isValid: isValid, data: data };
  }

  /* Limpa erro ao digitar/alterar o campo */
  Object.keys(validators).forEach(function (name) {
    form.querySelectorAll('[name="' + name + '"]').forEach(function (field) {
      var eventType = field.tagName === 'SELECT' || field.type === 'radio' ? 'change' : 'input';
      field.addEventListener(eventType, function () {
        showFieldError(name, '');
      });
    });
  });

  /* ---------------------------------------------------------
     Envia os dados para o Google Sheets via Apps Script
     ---------------------------------------------------------
     Como o Apps Script Web App não retorna cabeçalhos CORS
     completos para leitura da resposta, usamos modo "no-cors".
     Isso significa que não conseguimos ler o corpo da resposta,
     mas a requisição é entregue normalmente ao script, que grava
     a linha na planilha. Tratamos a ausência de erro de rede
     como sucesso.
     --------------------------------------------------------- */
  function sendToGoogleSheets(data) {
    var payload = new URLSearchParams();
    Object.keys(data).forEach(function (key) {
      payload.append(key, data[key]);
    });
    payload.append('dataEnvio', new Date().toISOString());
    payload.append('origemSite', window.location.hostname || 'aglbrasil.com.br');

    return fetch(CONFIG.GAS_WEB_APP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: payload.toString()
    });
  }

  /* ---------------------------------------------------------
     Estado de carregamento do botão
     --------------------------------------------------------- */
  function setLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = isLoading;
    submitBtn.classList.toggle('btn--loading', isLoading);
  }

  function setFeedback(message, isError) {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    feedbackEl.classList.toggle('is-error', !!isError);
  }

  /* ---------------------------------------------------------
     Exibe a etapa de sucesso dentro do modal
     --------------------------------------------------------- */
  function showSuccessStep() {
    if (formStep) formStep.hidden = true;
    if (successStep) {
      successStep.hidden = false;
      var heading = successStep.querySelector('.success__title');
      if (heading) heading.focus();
    }
  }

  function resetModalSteps() {
    if (formStep) formStep.hidden = false;
    if (successStep) successStep.hidden = true;
  }

  // Reseta as etapas do modal sempre que ele for fechado
  document.querySelectorAll('[data-close-modal]').forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      window.setTimeout(resetModalSteps, 300);
    });
  });

  /* ---------------------------------------------------------
     Submissão do formulário
     --------------------------------------------------------- */
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    setFeedback('', false);

    var result = validateForm();

    if (!result.isValid) {
      setFeedback('Por favor, corrija os campos destacados antes de enviar.', true);

      var firstInvalid = form.querySelector('.is-invalid, .form__radio.is-invalid input');
      if (firstInvalid) {
        firstInvalid.focus();
      }
      return;
    }

    // Inclui as UTMs capturadas da URL no pacote enviado à planilha
    UTM_FIELDS.forEach(function (key) {
      var field = form.querySelector('[name="' + key + '"]');
      result.data[key] = field ? field.value : '';
    });

    var gasConfigured = CONFIG.GAS_WEB_APP_URL && CONFIG.GAS_WEB_APP_URL.indexOf('COLE_AQUI') !== 0;

    function finishSubmission() {
      form.reset();
      fillUTMFields(form);
      showSuccessStep();
    }

    if (!gasConfigured) {
      finishSubmission();
      return;
    }

    setLoading(true);

    sendToGoogleSheets(result.data)
      .then(finishSubmission)
      .catch(function () {
        setFeedback(
          'Não foi possível enviar seus dados agora. Verifique sua conexão e tente novamente.',
          true
        );
      })
      .finally(function () {
        setLoading(false);
      });
  });
})();
