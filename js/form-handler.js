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
    GAS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbx1J7AlYWzIoMbJYawOjzLZRhqZcmXPQAkW7F2fhVRbF4HNTux4_dtlZDcJkXz0CGok/exec'
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
      var digits = value.replace(/\D/g, '');
      return digits.length === 14 ? '' : 'Informe um CNPJ válido (14 dígitos).';
    },
    segmento: function (value) {
      return value ? '' : 'Selecione o segmento da sua empresa.';
    },
    segmento_outro: function (value) {
      var segmento = getFieldValue('segmento');
      if (segmento !== 'Outro') return '';
      return value.trim() ? '' : 'Digite o segmento da sua empresa.';
    },
    cargo: function () {
      return '';
    },
    premium: function () {
      return '';
    },
    comoConheceuNestiDante: function () {
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
     Envio ao Google Apps Script (v2)
     ---------------------------------------------------------
     O envio usa CORS para ler a resposta JSON do Apps Script e
     só tratar como sucesso o que o servidor realmente confirmou
     (status "success"). Respostas possíveis:
       success   dados gravados na planilha
       duplicate o MESMO conteúdo já foi enviado nas últimas 24 h
                 ("Você já enviou seu formulário."). Quem altera qualquer
                 informação (ex.: segmento) faz um novo envio normalmente.
       invalid   erros de validação por campo (servidor)
       error     falha; o usuário pode tentar de novo com o MESMO
                 submissionId, desde que não tenha alterado os dados
                 (o servidor não duplica a linha)
     --------------------------------------------------------- */
  var REQUEST_TIMEOUT_MS = 25000;
  var DUPLICATE_MESSAGE = 'Você já enviou seu formulário.';

  var currentSubmissionId = null;
  var currentSubmissionContent = '';
  var isSubmitting = false;
  var isLocked = false;

  function generateSubmissionId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) {
      /* usa o fallback abaixo */
    }
    return 'sub-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function readCookie(name) {
    try {
      var parts = document.cookie ? document.cookie.split(';') : [];
      for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].trim();
        if (pair.indexOf(name + '=') === 0) {
          return pair.slice(name.length + 1);
        }
      }
    } catch (e) {
      /* cookies indisponíveis */
    }
    return '';
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (e) {
      return value;
    }
  }

  /* Identificador do visitante na RD. A documentação da API cita o cookie
     "_rdtrk" (valor simples, um UUID); o script de monitoramento da RD lê
     "rdtrk" (JSON com o campo "id"). Aceita os dois formatos nos dois nomes. */
  function readRdClientId() {
    var names = ['_rdtrk', 'rdtrk'];

    for (var i = 0; i < names.length; i++) {
      var raw = safeDecode(readCookie(names[i]) || '').trim();
      if (!raw) continue;

      if (raw.charAt(0) === '{') {
        try {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.id) return String(parsed.id);
        } catch (e) {
          /* tenta o próximo cookie */
        }
      } else {
        return raw;
      }
    }

    return '';
  }

  /* Cookies do código de monitoramento da RD (somente leitura): preservam o
     vínculo entre as visitas anônimas e o lead (histórico e origem). */
  function getRdTracking() {
    var clientId = '';
    var trafficSource = '';

    try {
      clientId = readRdClientId();
    } catch (e) {
      clientId = '';
    }

    try {
      trafficSource = safeDecode(readCookie('__trf.src') || '');
    } catch (e) {
      trafficSource = '';
    }

    return { clientId: clientId, trafficSource: trafficSource };
  }

  function sendToGoogleSheets(data, submissionId) {
    var payload = new URLSearchParams();
    Object.keys(data).forEach(function (key) {
      payload.append(key, data[key]);
    });
    payload.append('dataEnvio', new Date().toISOString());
    payload.append('origem', window.location.hostname || 'aglbrasil.com.br');
    payload.append('submissionId', submissionId);

    var tracking = getRdTracking();
    payload.append('rd_cid', tracking.clientId);
    payload.append('rd_trf', tracking.trafficSource);

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, REQUEST_TIMEOUT_MS)
      : null;

    var options = {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: payload.toString()
    };
    if (controller) options.signal = controller.signal;

    return fetch(CONFIG.GAS_WEB_APP_URL, options)
      .then(function (response) {
        if (!response.ok) throw new Error('http_' + response.status);
        return response.json();
      })
      .then(
        function (json) {
          if (timer) window.clearTimeout(timer);
          return json;
        },
        function (error) {
          if (timer) window.clearTimeout(timer);
          throw error;
        }
      );
  }

  /* ---------------------------------------------------------
     Estado de carregamento do botão
     --------------------------------------------------------- */
  function setLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = isLoading || isLocked;
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

  /* Depois de um envio confirmado o botão fica bloqueado. Ele só é
     liberado quando alguém volta a preencher o formulário. Não há bloqueio
     permanente por e-mail: quem precisa corrigir ou refazer uma solicitação
     envia de novo. Repetições idênticas (mesmo conteúdo, até 24 h) são
     barradas pelo servidor. */
  function unlockAfterNewInput() {
    if (!isLocked) return;
    isLocked = false;
    if (submitBtn && !isSubmitting) submitBtn.disabled = false;
  }

  form.addEventListener('input', unlockAfterNewInput);
  form.addEventListener('change', unlockAfterNewInput);

  function applyServerErrors(errors) {
    Object.keys(errors || {}).forEach(function (name) {
      if (!validators.hasOwnProperty(name)) return;
      showFieldError(name, errors[name]);
    });

    setFeedback('Por favor, corrija os campos destacados antes de enviar.', true);

    var firstInvalid = form.querySelector('.is-invalid, .form__radio.is-invalid input');
    if (firstInvalid) firstInvalid.focus();
  }

  function finishSubmission() {
    form.reset();
    fillUTMFields(form);
    showSuccessStep();
  }

  function handleServerResponse(response) {
    var status = response && response.status;

    if (status === 'success') {
      currentSubmissionId = null;
      currentSubmissionContent = '';
      isLocked = true;
      finishSubmission();
      return;
    }

    if (status === 'duplicate') {
      currentSubmissionId = null;
      currentSubmissionContent = '';
      setFeedback(DUPLICATE_MESSAGE, true);
      return;
    }

    if (status === 'invalid') {
      applyServerErrors(response.errors);
      return;
    }

    throw new Error('server_error');
  }

  /* ---------------------------------------------------------
     Submissão do formulário
     --------------------------------------------------------- */
  form.addEventListener('submit', function (event) {
    event.preventDefault();

    // Protege contra duplo clique/Enter e contra reenvio logo após o sucesso
    if (isSubmitting || isLocked) return;

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

    if (!gasConfigured) {
      finishSubmission();
      return;
    }

    isSubmitting = true;
    setLoading(true);

    // O mesmo ID é reutilizado nas novas tentativas após falha de rede, mas só
    // se os dados não mudaram: dados alterados são um novo envio (novo ID).
    var content = JSON.stringify(result.data);
    if (!currentSubmissionId || content !== currentSubmissionContent) {
      currentSubmissionId = generateSubmissionId();
      currentSubmissionContent = content;
    }

    sendToGoogleSheets(result.data, currentSubmissionId)
      .then(function (response) {
        handleServerResponse(response);
      })
      .catch(function () {
        setFeedback(
          'Não foi possível enviar seus dados agora. Verifique sua conexão e tente novamente.',
          true
        );
      })
      .finally(function () {
        isSubmitting = false;
        setLoading(false);
      });
  });
})();
