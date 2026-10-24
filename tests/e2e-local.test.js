'use strict';

/**
 * Ponta a ponta LOCAL: o formulário real (jsdom) conversando com o Code.gs real
 * (simulado em memória). Nada de rede, de planilha ou de RD reais.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./gas-harness');
const { createPage, fetchToGas, settle } = require('./page-harness');

const API_KEY = 'CHAVE-SECRETA-DE-TESTE-123';
const dryEnv = () => createEnv({ props: { RD_MODE: 'dry', RD_API_KEY: API_KEY, AMBIENTE_TESTE: '1' } });
const control = (env, i = 0) => {
  const h = env.control().rows[0];
  const r = env.control().rows[i + 1];
  return Object.fromEntries(h.map((k, idx) => [k, r[idx]]));
};

test('E2E: UTMs da URL, 18 colunas A–R, controle dry e payload simulado', async () => {
  const env = dryEnv();
  const page = createPage({
    url: 'https://www.aglbrasil.com.br/?utm_source=meta&utm_medium=paid-social&utm_campaign=lancamento&utm_content=video1&utm_term=sabonete',
    fetchImpl: fetchToGas(env),
    cookies: { rdtrk: encodeURIComponent(JSON.stringify({ id: '43b00843-09af-4fae-bf9d-a0697640b808' })), '__trf.src': 'facebook' }
  });
  page.fill();
  page.submit();
  await settle();

  assert.equal(page.successStep.hidden, false);
  assert.equal(env.parcerias().getLastRow(), 2);
  const row = Array.from(env.parcerias().rows[1]);
  assert.equal(row.length, 18);
  assert.deepEqual(row.slice(1, 12), [
    'Maria da Silva', 'maria@empresa.com.br', '(11) 91234-5678', 'Empresa Teste',
    '11.222.333/0001-81', 'Supermercado', '', 'Gerente', 'Sim', 'Indicação', 'www.aglbrasil.com.br'
  ]);
  assert.deepEqual(row.slice(13), ['meta', 'paid-social', 'lancamento', 'video1', 'sabonete']);

  const c = control(env);
  assert.equal(c.rd_status, 'dry');
  const p = JSON.parse(c.rd_payload).payload;
  assert.equal(p.conversion_identifier, 'partnershipForm');
  assert.equal(p.cf_utm_source, 'meta');
  assert.equal(p.cf_utm_campain, 'lancamento');
  assert.equal(p.client_tracking_id, '43b00843-09af-4fae-bf9d-a0697640b808');
  assert.equal(p.traffic_source, 'facebook');
  assert.equal(p.cf_cnpj, '11.222.333/0001-81');
});

test('E2E: UTMs persistem na navegação (sessionStorage) mesmo sem query na URL do formulário', async () => {
  const env = dryEnv();
  const page = createPage({
    url: 'https://www.aglbrasil.com.br/',
    session: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'busca' },
    fetchImpl: fetchToGas(env)
  });
  page.fill();
  page.submit();
  await settle();
  const row = Array.from(env.parcerias().rows[1]);
  assert.deepEqual(row.slice(13), ['google', 'cpc', 'busca', '', '']);
});

test('E2E: sem UTMs, as colunas N–R ficam vazias e o payload da RD as omite', async () => {
  const env = dryEnv();
  const page = createPage({ fetchImpl: fetchToGas(env) });
  page.fill();
  page.submit();
  await settle();
  assert.deepEqual(Array.from(env.parcerias().rows[1]).slice(13), ['', '', '', '', '']);
  const p = JSON.parse(control(env).rd_payload).payload;
  assert.equal(Object.keys(p).some((k) => k.startsWith('cf_utm_')), false);
  assert.equal('client_tracking_id' in p, false);
});

test('E2E: resposta perdida (servidor gravou, navegador não recebeu) → reenvio gera UMA linha', async () => {
  const env = dryEnv();
  let lose = true;
  const page = createPage({
    fetchImpl: fetchToGas(env, {
      afterServer: async () => {
        if (lose) {
          lose = false;
          throw new Error('Failed to fetch'); // a rede caiu na volta
        }
      }
    })
  });
  page.fill();
  page.submit();
  await settle();

  assert.ok(page.successStep.hidden, 'o usuário não vê sucesso sem confirmação');
  assert.match(page.feedback.textContent, /Não foi possível enviar/);
  assert.equal(env.parcerias().getLastRow(), 2, 'o servidor gravou');

  page.submit();
  await settle();
  assert.equal(page.successStep.hidden, false);
  assert.equal(env.parcerias().getLastRow(), 2, 'continua 1 linha');
  assert.equal(env.control().getLastRow(), 2);
  assert.equal(new URLSearchParams(page.calls[0].opts.body).get('submissionId'),
    new URLSearchParams(page.calls[1].opts.body).get('submissionId'));
});

test('E2E: timeout de 25 s aborta a requisição, avisa o usuário e permite tentar de novo', async () => {
  const env = dryEnv();
  let hang = true;
  const page = createPage({
    fastTimeout: true,
    fetchImpl: (url, opts) => {
      if (hang) {
        hang = false;
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return fetchToGas(env)(url, opts);
    }
  });
  page.fill();
  page.submit();
  await settle();
  assert.ok(page.successStep.hidden);
  assert.match(page.feedback.textContent, /Não foi possível enviar/);
  assert.equal(page.btn.disabled, false);

  page.submit();
  await settle();
  assert.equal(page.successStep.hidden, false);
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('E2E: e-mail já cadastrado em OUTRO dispositivo → servidor devolve a mensagem', async () => {
  const env = dryEnv();
  const a = createPage({ fetchImpl: fetchToGas(env) });
  a.fill();
  a.submit();
  await settle();

  const b = createPage({ fetchImpl: fetchToGas(env) }); // storage vazio
  b.fill({ email: 'MARIA@empresa.com.br ' });
  b.submit();
  await settle();
  assert.equal(b.feedback.textContent, 'Você já enviou seu formulário.');
  assert.ok(b.successStep.hidden);
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('E2E: erro do servidor no CNPJ (dígito errado) → campo marcado, nada gravado, corrige e envia', async () => {
  const env = dryEnv();
  const page = createPage({ fetchImpl: fetchToGas(env) });
  page.fill({ cnpj: '11222333000182' });
  page.submit();
  await settle();
  assert.equal(page.errorText('cnpj'), 'Informe um CNPJ válido.');
  assert.equal(env.parcerias().getLastRow(), 1);
  assert.equal(page.btn.disabled, false);

  page.set('cnpj', '11222333000181');
  page.submit();
  await settle();
  assert.equal(page.successStep.hidden, false);
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('E2E: segmento "Outro" exige o texto e chega à planilha e à RD', async () => {
  const env = dryEnv();
  const page = createPage({ fetchImpl: fetchToGas(env) });
  page.fill({ segmento: 'Outro' });
  page.submit();
  await settle();
  assert.equal(page.calls.length, 0, 'o front exige segmento_outro');
  assert.ok(page.errorText('segmento_outro'));

  page.set('segmento_outro', 'Hotelaria');
  page.submit();
  await settle();
  assert.equal(Array.from(env.parcerias().rows[1])[7], 'Hotelaria');
  assert.equal(JSON.parse(control(env).rd_payload).payload.cf_segmento_outro, 'Hotelaria');
});

test('E2E: acentos e símbolos (& + = % " \') chegam intactos; fórmula é neutralizada', async () => {
  const env = dryEnv();
  const page = createPage({ fetchImpl: fetchToGas(env) });
  page.fill({
    nome: "José D'Ávila & Filhos",
    empresa: 'A+B "Comércio" 100% LTDA ½',
    cargo: '=HYPERLINK("http://x")'
  });
  page.submit();
  await settle();
  const row = Array.from(env.parcerias().rows[1]);
  assert.equal(row[1], "José D'Ávila & Filhos");
  assert.equal(row[4], 'A+B "Comércio" 100% LTDA ½');
  assert.equal(row[8], "'=HYPERLINK(\"http://x\")");
});

test('E2E: localStorage/sessionStorage indisponíveis (navegação restrita): o envio funciona', async () => {
  const env = dryEnv();
  const page = createPage({
    brokenLocalStorage: true,
    brokenSessionStorage: true,
    fetchImpl: fetchToGas(env)
  });
  page.fill();
  page.submit();
  await settle();
  assert.equal(page.successStep.hidden, false);
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('E2E: sem crypto.subtle: sem checagem local, mas o servidor continua bloqueando duplicados', async () => {
  const env = dryEnv();
  const page = createPage({ noCrypto: true, fetchImpl: fetchToGas(env) });
  page.fill();
  page.submit();
  await settle();
  assert.equal(env.parcerias().getLastRow(), 2);

  page.reopenForm();
  page.fill();
  page.submit();
  await settle();
  assert.equal(page.calls.length, 2, 'foi ao servidor');
  assert.equal(page.feedback.textContent, 'Você já enviou seu formulário.');
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('E2E: duplo clique + Enter simultâneos geram uma linha só', async () => {
  const env = dryEnv();
  const page = createPage({ fetchImpl: fetchToGas(env, { before: () => settle(30) }) });
  page.fill();
  page.submit();
  page.submit();
  page.form.dispatchEvent(new page.window.Event('submit', { cancelable: true, bubbles: true }));
  await settle(400);
  assert.equal(page.calls.length, 1);
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('E2E: 40 pessoas distintas e 40 repetições idênticas: 40 linhas, sem contaminação entre registros', async () => {
  const env = dryEnv();
  for (let i = 0; i < 40; i++) {
    const page = createPage({ fetchImpl: fetchToGas(env) });
    page.fill({ nome: `Pessoa ${i}`, email: `pessoa${i}@empresa.com.br`, empresa: `Empresa ${i}` });
    page.submit();
    await settle(60);
  }
  for (let i = 0; i < 40; i++) {
    const page = createPage({ fetchImpl: fetchToGas(env) });
    page.fill({ nome: `Pessoa ${i}`, email: `PESSOA${i}@empresa.com.br`, empresa: `Empresa ${i}` });
    page.submit();
    await settle(60);
  }
  assert.equal(env.parcerias().getLastRow(), 41);
  assert.equal(env.control().getLastRow(), 41);
  const rows = env.parcerias().rows.slice(1);
  rows.forEach((r, i) => {
    assert.equal(r[1], `Pessoa ${i}`);
    assert.equal(r[4], `Empresa ${i}`);
  });
  const ids = new Set(env.control().rows.slice(1).map((r) => r[0]));
  assert.equal(ids.size, 40);
});
