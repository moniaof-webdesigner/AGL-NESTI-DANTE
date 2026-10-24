'use strict';

/**
 * Melhoria de atribuição de origem (RD Station): leitura dos cookies da RD no
 * navegador e mapeamento dos campos de origem da API oficial no Apps Script.
 * Tudo local: nenhuma chamada à RD.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createEnv, validParams } = require('./gas-harness');
const { createPage, fetchToGas, settle } = require('./page-harness');

const API_KEY = 'CHAVE-SECRETA-DE-TESTE-123';
const UUID = '43b00843-09af-4fae-bf9d-a0697640b808';
const ROOT = path.join(__dirname, '..');

const dryEnv = () => createEnv({ props: { RD_MODE: 'dry', RD_API_KEY: API_KEY } });
const payloadOf = (env, i = 0) => JSON.parse(env.control().rows[i + 1][11]).payload;
const TRF_COOKIE = 'encoded_' + Buffer.from(JSON.stringify({
  first_session: { value: 'utm_source=google&utm_medium=cpc&utm_campaign=x', extra_params: {} },
  current_session: { value: 'https://www.google.com/', extra_params: {} },
  created_at: 1700000000000
})).toString('base64');

/* ================= Servidor: mapeamento dos campos de origem ================= */

test('Com cookie __trf.src: traffic_source = cookie, e medium/campaign/value ficam vazios', () => {
  const env = dryEnv();
  env.post(validParams({ rd_cid: UUID, rd_trf: TRF_COOKIE }));
  const p = payloadOf(env);
  assert.equal(p.traffic_source, TRF_COOKIE, 'valor bruto, sem alteração');
  assert.equal('traffic_medium' in p, false);
  assert.equal('traffic_campaign' in p, false);
  assert.equal('traffic_value' in p, false);
  assert.equal(p.client_tracking_id, UUID);
});

test('Sem cookie, com UTMs: origem montada pelos UTMs (source, medium, campaign, term)', () => {
  const env = dryEnv();
  env.post(validParams({ rd_cid: '', rd_trf: '' }));
  const p = payloadOf(env);
  assert.equal(p.traffic_source, 'google');
  assert.equal(p.traffic_medium, 'cpc');
  assert.equal(p.traffic_campaign, 'campanha-teste');
  assert.equal(p.traffic_value, 'sabonete');
  assert.equal('client_tracking_id' in p, false);
});

test('Sem cookie e sem UTM: nenhum campo de origem é inventado', () => {
  const env = dryEnv();
  env.post(validParams({
    rd_cid: '', rd_trf: '', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: ''
  }));
  const p = payloadOf(env);
  ['traffic_source', 'traffic_medium', 'traffic_campaign', 'traffic_value', 'client_tracking_id']
    .forEach((k) => assert.equal(k in p, false, k));
});

test('UTM sem utm_source não gera origem parcial', () => {
  const env = dryEnv();
  env.post(validParams({ rd_trf: '', utm_source: '', utm_medium: 'cpc', utm_campaign: 'x' }));
  const p = payloadOf(env);
  assert.equal('traffic_source' in p, false);
  assert.equal('traffic_medium' in p, false);
});

test('UTMs continuam indo aos campos personalizados cf_utm_* em TODOS os casos', () => {
  [{ rd_trf: TRF_COOKIE }, { rd_trf: '' }].forEach((extra, i) => {
    const env = dryEnv();
    env.post(validParams({ ...extra, email: `u${i}@empresa.com.br`, submissionId: `sub-utm-cf-${i}00000` }));
    const p = payloadOf(env);
    assert.equal(p.cf_utm_source, 'google');
    assert.equal(p.cf_utm_medium, 'cpc');
    assert.equal(p.cf_utm_campain, 'campanha-teste');
    assert.equal(p.cf_utm_content, 'anuncio-a');
    assert.equal(p.cf_utm_term, 'sabonete');
  });
});

test('Cookie longo (3000 caracteres) chega inteiro; acima de 4000 é descartado e a origem cai nos UTMs', () => {
  const long = 'encoded_' + 'A'.repeat(2992);
  const env = dryEnv();
  env.post(validParams({ rd_trf: long }));
  assert.equal(payloadOf(env).traffic_source, long);
  assert.equal(payloadOf(env).traffic_source.length, 3000);

  const env2 = dryEnv();
  env2.post(validParams({ rd_trf: 'encoded_' + 'A'.repeat(4100) }));
  const p = payloadOf(env2);
  assert.equal(p.traffic_source, 'google', 'caiu no fallback de UTM');
  assert.equal(p.traffic_medium, 'cpc');
});

test('client_tracking_id: UUID aceito; valor fora do padrão ou malicioso é descartado', () => {
  const ok = dryEnv();
  ok.post(validParams({ rd_cid: UUID }));
  assert.equal(payloadOf(ok).client_tracking_id, UUID);

  ['curto', 'tem espaço no meio de um id', '<script>alert(1)</script>', 'x'.repeat(200)].forEach((bad, i) => {
    const env = dryEnv();
    env.post(validParams({ rd_cid: bad, email: `b${i}@empresa.com.br`, submissionId: `sub-bad-cid-${i}0000` }));
    assert.equal('client_tracking_id' in payloadOf(env), false, bad.slice(0, 20));
  });
});

test('Dados de origem da RD nunca vão para a planilha: A–R inalteradas', () => {
  const env = dryEnv();
  env.post(validParams({ rd_cid: UUID, rd_trf: TRF_COOKIE }));
  const row = Array.from(env.parcerias().rows[1]);
  assert.equal(row.length, 18);
  assert.ok(!JSON.stringify(row).includes(UUID));
  assert.ok(!JSON.stringify(row).includes('encoded_'));
});

test('Erro 400 da RD num campo de origem: reenvia sem ele e o lead entra', () => {
  const responses = [
    { code: 400, body: JSON.stringify({ errors: [{ error_type: 'INVALID', path: '$.payload.traffic_source' }] }) },
    { code: 200, body: JSON.stringify({ event_uuid: 'e1' }) }
  ];
  const env = createEnv({
    props: { RD_MODE: 'live', RD_API_KEY: API_KEY },
    fetchHandler: () => responses.shift()
  });
  env.post(validParams({ rd_trf: TRF_COOKIE, rd_cid: UUID }));
  const second = JSON.parse(env.calls.fetch[1].opts.payload).payload;
  assert.equal('traffic_source' in second, false);
  assert.equal(second.client_tracking_id, UUID);
  assert.equal(second.cf_utm_source, 'google');
  assert.equal(second.conversion_identifier, 'partnershipForm');
});

test('Linhas "off" sem payload guardado (reconstrução pela planilha) usam o fallback de UTM', () => {
  const env = createEnv({ props: { RD_API_KEY: API_KEY, RD_MODE: 'off' } });
  env.post(validParams({ rd_trf: '', rd_cid: '' }));
  env.control().rows[1][11] = ''; // simula linha antiga sem payload
  env.props.RD_MODE = 'live';
  env.fn.enfileirarOffDesde('2000-01-01T00:00:00Z');
  const p = JSON.parse(env.control().rows[1][11]).payload;
  assert.equal(p.traffic_source, 'google');
  assert.equal(p.traffic_medium, 'cpc');
});

/* ================= Navegador: leitura dos cookies da RD ================= */

async function enviarComCookies(cookies) {
  const env = dryEnv();
  const page = createPage({ fetchImpl: fetchToGas(env), cookies });
  page.fill();
  page.submit();
  await settle();
  return { env, body: new URLSearchParams(page.calls[0].opts.body), page };
}

test('Cookie _rdtrk (valor simples, como na documentação da API) → rd_cid', async () => {
  const { body, env } = await enviarComCookies({ _rdtrk: UUID });
  assert.equal(body.get('rd_cid'), UUID);
  assert.equal(payloadOf(env).client_tracking_id, UUID);
});

test('Cookie rdtrk (JSON com id, como o script da RD lê) → rd_cid', async () => {
  const { body } = await enviarComCookies({ rdtrk: encodeURIComponent(JSON.stringify({ id: UUID })) });
  assert.equal(body.get('rd_cid'), UUID);
});

test('_rdtrk em JSON URL-encoded também funciona; _rdtrk tem prioridade sobre rdtrk', async () => {
  const outro = '99999999-aaaa-bbbb-cccc-dddddddddddd';
  const a = await enviarComCookies({ _rdtrk: encodeURIComponent(JSON.stringify({ id: UUID })) });
  assert.equal(a.body.get('rd_cid'), UUID);

  const b = await enviarComCookies({
    _rdtrk: UUID,
    rdtrk: encodeURIComponent(JSON.stringify({ id: outro }))
  });
  assert.equal(b.body.get('rd_cid'), UUID);
});

test('Cookie com JSON inválido: ignora e tenta o outro; sem cookies: rd_cid vazio', async () => {
  const a = await enviarComCookies({ _rdtrk: '{quebrado', rdtrk: encodeURIComponent(JSON.stringify({ id: UUID })) });
  assert.equal(a.body.get('rd_cid'), UUID);

  const b = await enviarComCookies({});
  assert.equal(b.body.get('rd_cid'), '');
  assert.equal(b.body.get('rd_trf'), '');
  assert.equal(b.page.successStep.hidden, false, 'o envio funciona sem cookies');
});

test('__trf.src (base64 com "=" e "+") chega ao servidor sem alteração', async () => {
  const trf = TRF_COOKIE + '+/==';
  const { body, env } = await enviarComCookies({ '__trf.src': trf });
  assert.equal(body.get('rd_trf'), trf);
  assert.equal(payloadOf(env).traffic_source, trf);
  assert.equal('traffic_medium' in payloadOf(env), false);
});

test('Ponta a ponta sem cookies e com UTMs na URL: origem sai dos UTMs; UTMs seguem nas colunas N–R', async () => {
  const env = dryEnv();
  const page = createPage({
    url: 'https://www.aglbrasil.com.br/?utm_source=meta&utm_medium=paid-social&utm_campaign=lancamento&utm_term=kit',
    fetchImpl: fetchToGas(env)
  });
  page.fill();
  page.submit();
  await settle();
  const p = payloadOf(env);
  assert.equal(p.traffic_source, 'meta');
  assert.equal(p.traffic_medium, 'paid-social');
  assert.equal(p.traffic_campaign, 'lancamento');
  assert.equal(p.traffic_value, 'kit');
  assert.deepEqual(Array.from(env.parcerias().rows[1]).slice(13), ['meta', 'paid-social', 'lancamento', '', 'kit']);
});

/* ================= Preservação: UTMs, nomes de campos, validação, GTM ================= */

test('Captura de UTMs e validação do front: texto idêntico ao original (git HEAD)', () => {
  const original = execSync('git show HEAD:js/form-handler.js', { cwd: ROOT }).toString();
  const current = fs.readFileSync(path.join(ROOT, 'js', 'form-handler.js'), 'utf8');
  const cut = (src) => src.slice(0, src.indexOf('Envia os dados para o Google') > -1
    ? src.indexOf('Envia os dados para o Google')
    : src.indexOf('Envio ao Google Apps Script (v2)'));
  const a = cut(original);
  const b = cut(current);
  assert.ok(a.includes('captureUTMs') && a.includes('UTM_FIELDS'), 'trecho comparado inclui a captura de UTMs');
  assert.ok(a.length > 6000);
  assert.equal(b, a);
});

test('Nada de GTM/dataLayer/pixels no código do site e HTML intocado', () => {
  const handler = fs.readFileSync(path.join(ROOT, 'js', 'form-handler.js'), 'utf8');
  assert.ok(!/dataLayer|fbq\(|gtag\(|googletagmanager|rdstation|event-api|form_integrations/i.test(handler));
  const changed = execSync('git diff --name-only HEAD -- privacidade.html termos.html js/main.js js/custom-select.js js/products-tabs.js', { cwd: ROOT }).toString().trim();
  assert.equal(changed, '');

  // Único ajuste visual autorizado: texto da tela de sucesso sem palavra viúva.
  const lines = (file) => execSync('git diff -U0 HEAD -- ' + file, { cwd: ROOT }).toString()
    .split(/\r?\n/).filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  // O texto visível das duas frases é o mesmo do git HEAD: só entram espaços não separáveis.
  const visible = (html) => html.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const head = execSync('git show HEAD:index.html', { cwd: ROOT, maxBuffer: 20e6 }).toString();
  const current = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(visible(current), visible(head));
  assert.equal(lines('index.html').length, 6, 'só as duas frases da tela de sucesso mudam');
  assert.deepEqual(lines('css/style.css').map((l) => l.trim()), ['+  text-wrap: balance;', '+  text-wrap: balance;']);
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(/googletagmanager\.com\/gtm\.js/.test(index) && /cloudfront\.net\/js\/loader-scripts/.test(index), 'GTM e RD continuam no HTML');
});

test('O front só LÊ cookies: nenhuma escrita em document.cookie', () => {
  const handler = fs.readFileSync(path.join(ROOT, 'js', 'form-handler.js'), 'utf8');
  assert.ok(!/document\.cookie\s*=/.test(handler));
  const readCookieFn = handler.slice(handler.indexOf('function readCookie'), handler.indexOf('function safeDecode'));
  assert.ok(readCookieFn.includes('document.cookie'));
  assert.ok(!/document\.cookie/.test(handler.replace(readCookieFn, '')), 'document.cookie só é lido dentro de readCookie');
});
