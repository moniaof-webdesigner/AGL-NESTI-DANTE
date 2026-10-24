'use strict';

/**
 * Página do site em jsdom, SEM scripts externos (GTM/RD) e com `fetch`
 * simulado. Usada pelos testes ponta a ponta (site → Apps Script simulado).
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FORM_JS = fs.readFileSync(path.join(ROOT, 'js', 'form-handler.js'), 'utf8');
const SELECT_JS = fs.readFileSync(path.join(ROOT, 'js', 'custom-select.js'), 'utf8');

const GAS_URL = (FORM_JS.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/) || [])[0];
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

function createPage(options = {}) {
  const dom = new JSDOM(INDEX_HTML, {
    url: options.url || 'https://www.aglbrasil.com.br/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];

  if (options.noCrypto) {
    Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
  } else {
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
  }
  window.TextEncoder = TextEncoder;

  if (options.brokenLocalStorage) {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('localStorage indisponível');
      }
    });
  } else {
    Object.entries(options.storage || {}).forEach(([k, v]) => window.localStorage.setItem(k, v));
  }
  if (options.brokenSessionStorage) {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('sessionStorage indisponível');
      }
    });
  } else {
    Object.entries(options.session || {}).forEach(([k, v]) => window.sessionStorage.setItem(k, v));
  }
  Object.entries(options.cookies || {}).forEach(([k, v]) => {
    window.document.cookie = `${k}=${v}`;
  });

  if (options.fastTimeout) {
    // O timeout de 25 s da requisição dispara em milissegundos nos testes
    const real = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...rest) => real(fn, ms === 25000 ? 5 : ms, ...rest);
  }

  window.fetch = (url, opts) => {
    calls.push({ url, opts });
    return options.fetchImpl(url, opts);
  };

  window.eval(SELECT_JS);
  window.eval(FORM_JS);

  const doc = window.document;
  const page = {
    window,
    doc,
    calls,
    form: doc.getElementById('partnershipForm'),
    btn: doc.getElementById('submitBtn'),
    feedback: doc.getElementById('formFeedback'),
    formStep: doc.getElementById('modalFormStep'),
    successStep: doc.getElementById('modalSuccessStep'),
    set(name, value) {
      const el = doc.querySelector(`[name="${name}"]`);
      el.value = value;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
      el.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    fill(overrides = {}) {
      const values = Object.assign(
        {
          nome: 'Maria da Silva',
          email: 'maria@empresa.com.br',
          telefone: '11912345678',
          empresa: 'Empresa Teste',
          cnpj: '11222333000181',
          segmento: 'Supermercado',
          cargo: 'Gerente',
          premium: 'Sim',
          comoConheceuNestiDante: 'Indicação'
        },
        overrides
      );
      Object.entries(values).forEach(([k, v]) => page.set(k, v));
    },
    submit() {
      page.btn.click();
    },
    reopenForm() {
      page.formStep.hidden = false;
      page.successStep.hidden = true;
    },
    errorText(name) {
      return doc.getElementById('error-' + name).textContent;
    }
  };
  return page;
}

/** fetch que entrega o POST ao Apps Script simulado (harness) e devolve o JSON. */
function fetchToGas(env, hooks = {}) {
  return async (url, opts) => {
    if (hooks.before) await hooks.before(url, opts);
    const params = Object.fromEntries(new URLSearchParams(opts.body));
    const json = env.post(params);
    if (hooks.afterServer) await hooks.afterServer(json, params);
    return { ok: true, status: 200, json: async () => json };
  };
}

module.exports = { createPage, fetchToGas, settle, GAS_URL };
