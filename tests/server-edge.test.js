'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createEnv, validParams } = require('./gas-harness');

const API_KEY = 'CHAVE-SECRETA-DE-TESTE-123';
const DEV_LIVE = path.join(__dirname, '..', 'apps-script', 'dev-only', 'TesteLive.gs');
const live = (extra = {}) => ({ RD_MODE: 'live', RD_API_KEY: API_KEY, ...extra });
const ok = () => ({ code: 200, body: JSON.stringify({ event_uuid: 'evt' }) });
const ctl = (env, i = 0) => {
  const h = env.control().rows[0];
  const r = env.control().rows[i + 1];
  return Object.fromEntries(h.map((k, idx) => [k, r[idx]]));
};

/* ---------- Compatibilidade com o site antigo (ordem de publicação) ---------- */

test('Site ANTIGO (sem submissionId, rd_cid, rd_trf) funciona com o servidor novo', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  const old = validParams();
  delete old.submissionId;
  delete old.rd_cid;
  delete old.rd_trf;
  const r = env.post(old);
  assert.equal(r.status, 'success');
  assert.ok(r.submissionId && r.submissionId.length >= 8, 'servidor gera o ID');
  assert.equal(env.parcerias().getLastRow(), 2);
  const p = JSON.parse(env.calls.fetch[0].opts.payload).payload;
  assert.equal('client_tracking_id' in p, false);
  // reenvio do mesmo e-mail pelo site antigo vira duplicate (não duplica linha)
  assert.equal(env.post(old).status, 'duplicate');
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('submissionId malformado é ignorado e o servidor gera outro', () => {
  const env = createEnv();
  const r = env.post(validParams({ submissionId: 'curto' }));
  assert.equal(r.status, 'success');
  assert.notEqual(r.submissionId, 'curto');
  const r2 = env.post(validParams({ submissionId: 'tem espaço e <script>' , email: 'b@empresa.com.br' }));
  assert.equal(r2.status, 'success');
  assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(r2.submissionId));
});

/* ---------- Respostas da RD ---------- */

test('Classificação das respostas da RD (408/429/5xx = fila; 404/422 = failed; 200 sem JSON = ok)', () => {
  const cases = [
    [408, 'pending'], [429, 'pending'], [500, 'pending'], [502, 'pending'],
    [404, 'failed'], [422, 'failed']
  ];
  cases.forEach(([code, expected], i) => {
    const env = createEnv({ props: live(), fetchHandler: () => ({ code, body: '' }) });
    env.post(validParams({ email: `c${i}@empresa.com.br`, submissionId: `sub-class-${i}0000` }));
    assert.equal(ctl(env).rd_status, expected, `HTTP ${code}`);
  });
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 202, body: 'ok' }) });
  env.post(validParams());
  assert.equal(ctl(env).rd_status, 'sent');
  assert.equal(ctl(env).rd_event_uuid, '');
});

test('Backoff: intervalos 5, 15, 60, 180, 360, 720 e 1440 min', () => {
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 503, body: '' }) });
  env.post(validParams());
  const expected = [5, 15, 60, 180, 360, 720, 1440];
  for (let i = 0; i < expected.length; i++) {
    const c = ctl(env);
    assert.equal(c.rd_status, 'pending');
    const waitMin = Math.round((c.rd_proxima_tentativa.getTime() - c.rd_ultima_tentativa.getTime()) / 60000);
    assert.equal(waitMin, expected[i], `após a tentativa ${i + 1}`);
    env.control().rows[1][7] = new Date(Date.now() - 1000);
    env.fn.processarPendentes();
  }
  assert.equal(ctl(env).rd_status, 'failed');
  assert.equal(ctl(env).rd_tentativas, 8);
});

test('Alerta de chave recusada: no máximo 1 e-mail por hora', () => {
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 401, body: '' }) });
  env.post(validParams());
  env.fn.retomarRD();
  env.post(validParams({ email: 'outro@empresa.com.br', submissionId: 'sub-alert-0002' }));
  assert.equal(env.calls.mail.length, 1);
  assert.ok(!JSON.stringify(env.calls.mail).includes(API_KEY));
});

test('Mesmo submissionId nunca é enviado duas vezes à RD, mesmo com processarPendentes em paralelo', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  env.post(validParams());
  for (let i = 0; i < 5; i++) env.fn.processarPendentes();
  assert.equal(env.calls.fetch.length, 1);
});

test('Linhas off enfileiradas preservam cookies de rastreio no payload', () => {
  const env = createEnv({ props: { RD_API_KEY: API_KEY, RD_MODE: 'off' }, fetchHandler: ok });
  env.post(validParams({ rd_cid: '43b00843-09af-4fae-bf9d-a0697640b808', rd_trf: 'google' }));
  env.props.RD_MODE = 'live';
  env.fn.enfileirarOffDesde('2000-01-01T00:00:00Z');
  env.control().rows[1][7] = new Date(Date.now() - 1000);
  env.fn.processarPendentes();
  const p = JSON.parse(env.calls.fetch[0].opts.payload).payload;
  assert.equal(p.client_tracking_id, '43b00843-09af-4fae-bf9d-a0697640b808');
  assert.equal(p.traffic_source, 'google');
});

/* ---------- Dados ---------- */

test('Campos gigantes são truncados e emojis/Unicode são preservados', () => {
  const env = createEnv();
  env.post(validParams({ nome: 'N'.repeat(900), empresa: 'Café ☕ Ltda 🧼', utm_source: 'u'.repeat(900) }));
  const row = env.parcerias().rows[1];
  assert.equal(row[1].length, 200);
  assert.equal(row[4], 'Café ☕ Ltda 🧼');
  assert.equal(row[13].length, 200);
});

test('Formatos de telefone e e-mail aceitos', () => {
  const env = createEnv();
  ['(11) 91234-5678', '(11) 1234-5678', '11912345678'].forEach((t, i) => {
    assert.equal(env.post(validParams({ telefone: t, email: `t${i}@empresa.com.br`, submissionId: `sub-tel-${i}0000` })).status, 'success', t);
  });
  ['(11) 1234-567', '119123456789', ''].forEach((t, i) => {
    assert.equal(env.post(validParams({ telefone: t, email: `x${i}@empresa.com.br`, submissionId: `sub-bad-${i}0000` })).status, 'invalid', t);
  });
  ['a+tag@empresa.com.br', 'MAIÚSCULA@Empresa.COM.br'].forEach((e, i) => {
    assert.equal(env.post(validParams({ email: e, submissionId: `sub-em-${i}00000` })).status, 'success', e);
  });
});

test('Volume: 300 envios com 150 e-mails únicos → 150 linhas e 150 controles', () => {
  const env = createEnv({ props: { RD_MODE: 'dry', RD_API_KEY: API_KEY } });
  for (let i = 0; i < 300; i++) {
    env.post(validParams({ email: `vol${i % 150}@empresa.com.br`, submissionId: `sub-vol-${String(i).padStart(6, '0')}` }));
  }
  assert.equal(env.parcerias().getLastRow(), 151);
  assert.equal(env.control().getLastRow(), 151);
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(env.calls.locks.acquired, env.calls.locks.released);
});

/* ---------- Trava do teste real (nada é chamado aqui) ---------- */

const liveTestProps = (extra = {}) => ({
  RD_MODE: 'live', RD_API_KEY: API_KEY, AMBIENTE_TESTE: '1',
  RD_CONVERSION_IDENTIFIER: 'partnershipForm_TESTE',
  TESTE_LIVE_EMAIL: 'eu@exemplo.com', TESTE_LIVE_PHONE: '(11) 98888-7777',
  LIVE_TEST_OK: '1', ...extra
});

test('TesteLive: recusa quando falta qualquer proteção', () => {
  const faltas = [
    { LIVE_TEST_OK: undefined }, { AMBIENTE_TESTE: undefined }, { RD_MODE: 'dry' },
    { RD_CONVERSION_IDENTIFIER: 'partnershipForm' }, { RD_CONVERSION_IDENTIFIER: undefined },
    { TESTE_LIVE_EMAIL: undefined }, { TESTE_LIVE_PHONE: '123' }, { RD_API_KEY: undefined }
  ];
  faltas.forEach((f) => {
    const props = { ...liveTestProps(), ...f };
    Object.keys(props).forEach((k) => props[k] === undefined && delete props[k]);
    const env = createEnv({ props, extraFiles: [DEV_LIVE], fetchHandler: ok });
    assert.throws(() => env.fn.testeLive1_UmEnvio(), /Recusado/, JSON.stringify(f));
    assert.equal(env.calls.fetch.length, 0);
    assert.equal(env.parcerias().getLastRow(), 1);
  });
});

test('TesteLive: com tudo certo faz UM envio com o identificador de teste e o telefone/e-mail do dono; não repete', () => {
  const env = createEnv({ props: liveTestProps(), extraFiles: [DEV_LIVE], fetchHandler: ok });
  env.fn.testeLive1_UmEnvio();
  assert.equal(env.calls.fetch.length, 1);
  const p = JSON.parse(env.calls.fetch[0].opts.payload).payload;
  assert.equal(p.conversion_identifier, 'partnershipForm_TESTE');
  assert.equal(p.email, 'eu@exemplo.com');
  assert.equal(p.personal_phone, '(11) 98888-7777');
  assert.ok(env.calls.fetch[0].url.startsWith('https://api.rd.services/platform/conversions?api_key='));

  assert.throws(() => env.fn.testeLive1_UmEnvio(), /já foi feito/);
  assert.equal(env.calls.fetch.length, 1);

  env.fn.testeLive2_ConferirControle();
  const log = env.calls.logs.join('\n');
  assert.match(log, /rd_status: sent/);
  assert.match(log, /rd_event_uuid: presente/);
  assert.ok(!log.includes(API_KEY));
  assert.ok(!log.includes('eu@exemplo.com'), 'o log não expõe dados pessoais');

  env.fn.testeLive3_Encerrar();
  assert.equal(env.props.RD_MODE, 'dry');
  assert.equal(env.props.LIVE_TEST_OK, undefined);
});

test('Trava interna: com AMBIENTE_TESTE=1 o identificador real nunca sai, mesmo em live e fora do TesteLive', () => {
  const env = createEnv({
    props: { RD_MODE: 'live', RD_API_KEY: API_KEY, AMBIENTE_TESTE: '1' },
    fetchHandler: ok
  });
  env.post(validParams());
  assert.equal(env.calls.fetch.length, 0);
});

/* ---------- Proteção extra do TesteLive: gatilhos e fila ---------- */

test('TesteLive: recusa se existir QUALQUER gatilho no projeto', () => {
  const env = createEnv({ props: liveTestProps(), extraFiles: [DEV_LIVE], fetchHandler: ok });
  env.fn.instalarGatilhos();
  assert.equal(env.triggers.length, 2);
  assert.throws(() => env.fn.testeLive1_UmEnvio(), /gatilho/);
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(env.parcerias().getLastRow(), 1);
  assert.equal(env.props.TESTE_LIVE_ENVIADO, undefined, 'a trava de envio único não foi consumida');

  // removido o gatilho, o teste volta a ser permitido
  env.triggers.splice(0, env.triggers.length);
  env.fn.testeLive1_UmEnvio();
  assert.equal(env.calls.fetch.length, 1);
});

test('TesteLive: recusa se houver linha pending, sending ou off em Controle_Envios', () => {
  for (const status of ['pending', 'sending', 'off', ' PENDING ']) {
    const env = createEnv({ props: liveTestProps(), extraFiles: [DEV_LIVE], fetchHandler: ok });
    // cria a aba de controle com uma linha no status testado
    env.fn.getControlSheet_();
    const row = new Array(13).fill('');
    row[0] = 'sub-antigo-0001';
    row[1] = 'antigo@exemplo.invalid';
    row[5] = status;
    env.control().appendRow(row);

    assert.throws(() => env.fn.testeLive1_UmEnvio(), /pending\/sending\/off/, status);
    assert.equal(env.calls.fetch.length, 0, status);
    assert.equal(env.props.TESTE_LIVE_ENVIADO, undefined, 'trava não consumida: ' + status);
    assert.equal(env.parcerias().getLastRow(), 1);
  }
});

test('TesteLive: linhas dry, sent e failed NÃO bloqueiam; aba ausente também não', () => {
  const semAba = createEnv({ props: liveTestProps(), extraFiles: [DEV_LIVE], fetchHandler: ok });
  assert.equal(semAba.control(), undefined);
  semAba.fn.testeLive1_UmEnvio();
  assert.equal(semAba.calls.fetch.length, 1);

  const env = createEnv({ props: liveTestProps(), extraFiles: [DEV_LIVE], fetchHandler: ok });
  env.fn.getControlSheet_();
  ['dry', 'sent', 'failed'].forEach((status, i) => {
    const row = new Array(13).fill('');
    row[0] = `sub-ok-000${i}`;
    row[1] = `ok${i}@exemplo.invalid`;
    row[5] = status;
    env.control().appendRow(row);
  });
  env.fn.testeLive1_UmEnvio();
  assert.equal(env.calls.fetch.length, 1);
  assert.equal(JSON.parse(env.calls.fetch[0].opts.payload).payload.conversion_identifier, 'partnershipForm_TESTE');
});

test('TesteLive: mensagens de recusa listam todos os problemas e não vazam chave nem dados', () => {
  const env = createEnv({
    props: liveTestProps({ LIVE_TEST_OK: undefined }),
    extraFiles: [DEV_LIVE],
    fetchHandler: ok
  });
  Object.keys(env.props).forEach((k) => env.props[k] === undefined && delete env.props[k]);
  env.fn.instalarGatilhos();
  let message = '';
  try {
    env.fn.testeLive1_UmEnvio();
  } catch (e) {
    message = e.message;
  }
  assert.match(message, /LIVE_TEST_OK/);
  assert.match(message, /gatilho/);
  assert.ok(!message.includes(API_KEY));
  assert.ok(!message.includes('eu@exemplo.com'));
});
