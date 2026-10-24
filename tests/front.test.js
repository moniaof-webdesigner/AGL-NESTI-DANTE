'use strict';

/**
 * Testes do fluxo de envio de js/form-handler.js em jsdom.
 * Os scripts externos do index.html (GTM e RD Station) NÃO são carregados
 * (runScripts: "outside-only"), então nenhum teste gera conversão real.
 * `fetch` é simulado: nenhuma requisição de rede sai daqui.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FORM_JS = fs.readFileSync(path.join(ROOT, 'js', 'form-handler.js'), 'utf8');
const SELECT_JS = fs.readFileSync(path.join(ROOT, 'js', 'custom-select.js'), 'utf8');

const GAS_URL = (FORM_JS.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/) || [])[0];
const VALID_CNPJ = '11222333000181';
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

function createPage(options = {}) {
  const dom = new JSDOM(INDEX_HTML, {
    url: options.url || 'https://www.aglbrasil.com.br/?utm_source=google&utm_medium=cpc&utm_campaign=camp&utm_content=ad1&utm_term=sabonete',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];

  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
  window.TextEncoder = TextEncoder;

  Object.entries(options.storage || {}).forEach(([k, v]) => window.localStorage.setItem(k, v));
  Object.entries(options.cookies || {}).forEach(([k, v]) => {
    window.document.cookie = `${k}=${v}`;
  });

  let queue = (options.responses || []).slice();
  window.fetch = (url, opts) => {
    calls.push({ url, opts });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const r = typeof next === 'function' ? next(url, opts) : next;
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({
      ok: r.ok !== false,
      status: r.status || 200,
      json: () => Promise.resolve(r.json)
    });
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
    setResponses(list) {
      queue = list.slice();
    },
    set(name, value) {
      const el = doc.querySelector(`[name="${name}"]`);
      el.value = value;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    fill(overrides = {}) {
      const values = Object.assign(
        {
          nome: 'Maria da Silva',
          email: 'maria@empresa.com.br',
          telefone: '11912345678',
          empresa: 'Empresa Teste',
          cnpj: VALID_CNPJ,
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
    body() {
      return new URLSearchParams(calls[calls.length - 1].opts.body);
    },
    errorText(name) {
      return doc.getElementById('error-' + name).textContent;
    }
  };
  return page;
}

const success = { json: { status: 'success', submissionId: 'x' } };

/* ---------- Validação existente preservada ---------- */

test('Bloco de validação/máscaras é idêntico ao original (git HEAD)', () => {
  const cut = (src) => {
    const a = src.indexOf('Regras de validação por campo');
    const b = src.indexOf('Envia os dados para o Google');
    const c = src.indexOf('Envio ao Google Apps Script (v2)');
    return src.slice(a, b > -1 ? b : c);
  };
  const original = execSync('git show HEAD:js/form-handler.js', { cwd: ROOT }).toString();
  const head = cut(original);
  const now = cut(FORM_JS);
  assert.ok(head.includes("digits.length === 14 ? '' : 'Informe um CNPJ válido (14 dígitos).'"));
  assert.ok(head.length > 3000, 'trecho comparado cobre validadores, máscaras e validateForm');
  assert.equal(now, head, 'validação existente não pode mudar');
});

test('CNPJ incompleto: mensagem atual, nenhum envio', async () => {
  const page = createPage({ responses: [success] });
  page.fill({ cnpj: '1122233300' });
  page.submit();
  await settle();
  assert.equal(page.calls.length, 0);
  assert.equal(page.errorText('cnpj'), 'Informe um CNPJ válido (14 dígitos).');
  assert.ok(page.successStep.hidden);
});

test('Demais validações do front continuam funcionando', async () => {
  const page = createPage({ responses: [success] });
  page.fill({ nome: 'Al', email: 'x', telefone: '123', empresa: '', segmento: '' });
  page.submit();
  await settle();
  assert.equal(page.calls.length, 0);
  assert.equal(page.errorText('nome'), 'Informe seu nome completo.');
  assert.equal(page.errorText('email'), 'Informe um e-mail válido.');
  assert.equal(page.errorText('telefone'), 'Informe um WhatsApp válido com DDD.');
  assert.equal(page.errorText('empresa'), 'Informe o nome da empresa.');
  assert.equal(page.errorText('segmento'), 'Selecione o segmento da sua empresa.');
});

/* ---------- Envio confirmado ---------- */

test('Envio válido: CORS, campos inalterados, UTMs, submissionId, cookies da RD; sucesso só após confirmação', async () => {
  const page = createPage({
    responses: [success],
    cookies: { rdtrk: encodeURIComponent(JSON.stringify({ id: '43b00843-09af-4fae-bf9d-a0697640b808' })), '__trf.src': 'google' }
  });
  page.fill();
  page.submit();
  assert.ok(page.successStep.hidden, 'ainda não confirmou');
  await settle();

  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].url, GAS_URL);
  assert.equal(page.calls[0].opts.method, 'POST');
  assert.equal(page.calls[0].opts.mode, 'cors');

  const body = page.body();
  assert.deepEqual(
    [...body.keys()].sort(),
    [
      'cargo', 'cnpj', 'comoConheceuNestiDante', 'dataEnvio', 'email', 'empresa', 'nome',
      'origem', 'premium', 'rd_cid', 'rd_trf', 'segmento', 'segmento_outro', 'submissionId',
      'telefone', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'
    ].sort()
  );
  assert.equal(body.get('utm_source'), 'google');
  assert.equal(body.get('utm_medium'), 'cpc');
  assert.equal(body.get('utm_campaign'), 'camp');
  assert.equal(body.get('utm_content'), 'ad1');
  assert.equal(body.get('utm_term'), 'sabonete');
  assert.equal(body.get('cnpj'), '11.222.333/0001-81', 'máscara preservada');
  assert.equal(body.get('telefone'), '(11) 91234-5678');
  assert.equal(body.get('rd_cid'), '43b00843-09af-4fae-bf9d-a0697640b808');
  assert.equal(body.get('rd_trf'), 'google');
  assert.ok(body.get('submissionId').length >= 8);

  assert.equal(page.successStep.hidden, false);
  assert.equal(page.formStep.hidden, true);
  assert.equal(page.btn.disabled, true, 'botão bloqueado após o sucesso');
});

test('Nenhuma chamada do front vai à RD: só ao Apps Script', async () => {
  const page = createPage({ responses: [success] });
  page.fill();
  page.submit();
  await settle();
  page.calls.forEach((c) => assert.equal(c.url, GAS_URL));
});

test('Duplo clique/Enter: um único envio', async () => {
  const page = createPage({ responses: [success] });
  page.fill();
  page.submit();
  page.submit();
  page.form.dispatchEvent(new page.window.Event('submit', { cancelable: true, bubbles: true }));
  await settle();
  assert.equal(page.calls.length, 1);
});

/* ---------- Reenvio: sem bloqueio permanente por e-mail ---------- */

test('Após o sucesso o botão trava; ao alterar qualquer dado o formulário volta a enviar (novo submissionId)', async () => {
  const page = createPage({ responses: [success, success] });
  page.fill();
  page.submit();
  await settle();
  assert.equal(page.calls.length, 1);
  const firstId = page.body().get('submissionId');

  // mesma pessoa corrige o segmento: destrava e envia de novo, com outro submissionId
  page.window.eval("document.getElementById('modalFormStep').hidden = false");
  page.fill({ segmento: 'Farmácia' });
  assert.equal(page.btn.disabled, false);
  page.submit();
  await settle();
  assert.equal(page.calls.length, 2, 'o mesmo e-mail NÃO é mais barrado pelo navegador');
  assert.equal(page.body().get('segmento'), 'Farmácia');
  assert.notEqual(page.body().get('submissionId'), firstId);
  assert.equal(page.successStep.hidden, false);
});

test('Nada fica guardado no navegador sobre o e-mail (sem bloqueio local, sem hash)', async () => {
  const page = createPage({ responses: [success] });
  page.fill();
  page.submit();
  await settle();
  assert.equal(page.window.localStorage.length, 0);
  // sessionStorage guarda só as UTMs (comportamento original, inalterado)
  const stored = JSON.stringify(Object.entries(page.window.sessionStorage));
  assert.ok(!/maria|empresa\.com|11222333/i.test(stored), 'nenhum dado do formulário é guardado');
});

test('Atualizar a página não bloqueia no navegador: quem decide é o servidor (duplicate só se idêntico)', async () => {
  const reloaded = createPage({
    storage: { agl_partnership_sent: JSON.stringify(['hash-antigo-de-versao-anterior']) },
    responses: [success]
  });
  reloaded.fill();
  reloaded.submit();
  await settle();
  assert.equal(reloaded.calls.length, 1, 'foi ao servidor');
  assert.equal(reloaded.successStep.hidden, false);
});

test('Servidor responde duplicate: mensagem, sem tela de sucesso, botão liberado, nada guardado', async () => {
  const page = createPage({ responses: [{ json: { status: 'duplicate', message: 'Você já enviou seu formulário.' } }] });
  page.fill();
  page.submit();
  await settle();
  assert.equal(page.feedback.textContent, 'Você já enviou seu formulário.');
  assert.ok(page.successStep.hidden);
  assert.equal(page.window.localStorage.length, 0);
  assert.equal(page.btn.disabled, false);
});

/* ---------- Erros ---------- */

test('Servidor responde invalid: erro no campo (CNPJ), sem sucesso', async () => {
  const page = createPage({
    responses: [{ json: { status: 'invalid', errors: { cnpj: 'Informe um CNPJ válido.' } } }]
  });
  page.fill();
  page.submit();
  await settle();
  assert.equal(page.errorText('cnpj'), 'Informe um CNPJ válido.');
  assert.ok(page.successStep.hidden);
  assert.equal(page.btn.disabled, false);
});

test('Falha de rede: mensagem de erro; nova tentativa usa o MESMO submissionId e funciona', async () => {
  const page = createPage({ responses: [new Error('Failed to fetch'), success] });
  page.fill();
  page.submit();
  await settle();
  assert.equal(page.feedback.textContent,
    'Não foi possível enviar seus dados agora. Verifique sua conexão e tente novamente.');
  assert.ok(page.successStep.hidden);
  assert.equal(page.btn.disabled, false);
  const firstId = page.body().get('submissionId');
  const firstValues = page.body().get('email');

  page.submit();
  await settle();
  assert.equal(page.calls.length, 2);
  assert.equal(page.body().get('submissionId'), firstId);
  assert.equal(page.body().get('email'), firstValues);
  assert.equal(page.successStep.hidden, false);
});

test('Falha de rede e dados ALTERADOS antes de tentar de novo: novo submissionId (não perde a correção)', async () => {
  const page = createPage({ responses: [new Error('Failed to fetch'), success] });
  page.fill();
  page.submit();
  await settle();
  const firstId = page.body().get('submissionId');

  page.set('segmento', 'Farmácia');
  page.submit();
  await settle();
  assert.equal(page.calls.length, 2);
  assert.equal(page.body().get('segmento'), 'Farmácia');
  assert.notEqual(page.body().get('submissionId'), firstId);
});

test('HTTP 500 ou resposta inesperada não é tratada como sucesso', async () => {
  const a = createPage({ responses: [{ ok: false, status: 500, json: {} }] });
  a.fill();
  a.submit();
  await settle();
  assert.ok(a.successStep.hidden);
  assert.ok(a.feedback.classList.contains('is-error'));

  const b = createPage({ responses: [{ json: { status: 'error', message: 'x' } }] });
  b.fill();
  b.submit();
  await settle();
  assert.ok(b.successStep.hidden);
  assert.equal(b.window.localStorage.length, 0);

  const c = createPage({ responses: [{ json: undefined }] });
  c.fill();
  c.submit();
  await settle();
  assert.ok(c.successStep.hidden);
});

/* ---------- Layout/markup ---------- */

test('Markup do formulário e do index.html não foi alterado', () => {
  // O formulário (campos, nomes, ids, classes) é idêntico ao do git HEAD; só o texto da
  // tela de sucesso recebeu ajuste tipográfico (sem palavra viúva), fora do <form>.
  const head = execSync('git show HEAD:index.html', { cwd: ROOT, maxBuffer: 20e6 }).toString();
  const formOf = (html) => new JSDOM(html).window.document.getElementById('partnershipForm').outerHTML;
  assert.equal(formOf(INDEX_HTML), formOf(head));
  const names = [...new JSDOM(INDEX_HTML).window.document.querySelectorAll('#partnershipForm [name]')]
    .map((e) => e.name);
  assert.deepEqual(names, [
    'nome', 'email', 'telefone', 'empresa', 'cnpj', 'segmento', 'segmento_outro', 'cargo',
    'premium', 'comoConheceuNestiDante', 'utm_source', 'utm_medium', 'utm_campaign',
    'utm_content', 'utm_term'
  ]);
});
