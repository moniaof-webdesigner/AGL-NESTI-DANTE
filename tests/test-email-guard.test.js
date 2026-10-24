'use strict';

/**
 * Trava 3 (ambiente de teste): com AMBIENTE_TESTE=1, a API da RD só pode
 * receber o e-mail definido em TESTE_LIVE_EMAIL. Tudo local, sem RD real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createEnv, validParams } = require('./gas-harness');

const API_KEY = 'CHAVE-SECRETA-DE-TESTE-123';
const DEV_LIVE = path.join(__dirname, '..', 'apps-script', 'dev-only', 'TesteLive.gs');
const ALLOWED = 'eu@exemplo.com';
const ok = () => ({ code: 200, body: JSON.stringify({ event_uuid: 'evt-ok' }) });

const testLive = (extra = {}) => ({
  RD_MODE: 'live', RD_API_KEY: API_KEY, AMBIENTE_TESTE: '1',
  RD_CONVERSION_IDENTIFIER: 'partnershipForm_TESTE',
  TESTE_LIVE_EMAIL: ALLOWED, TESTE_LIVE_PHONE: '(11) 98888-7777', ...extra
});
const status = (env, i = 0) => env.control().rows[i + 1][5];
const errorOf = (env, i = 0) => env.control().rows[i + 1][10];

test('E-mail DIFERENTE é bloqueado antes da API (envio imediato): lead gravado, nada enviado', () => {
  const env = createEnv({ props: testLive(), fetchHandler: ok });
  const r = env.post(validParams({ email: 'outra.pessoa@empresa.com.br' }));
  assert.equal(r.status, 'success', 'o cadastro na planilha de teste continua funcionando');
  assert.equal(env.parcerias().getLastRow(), 2);
  assert.equal(env.calls.fetch.length, 0, 'nenhuma chamada à RD');
  assert.equal(status(env), 'blocked');
  assert.match(errorOf(env), /TESTE_LIVE_EMAIL/);
});

test('O e-mail liberado envia, mesmo com maiúsculas e espaços', () => {
  const env = createEnv({ props: testLive({ TESTE_LIVE_EMAIL: '  EU@Exemplo.COM ' }), fetchHandler: ok });
  env.post(validParams({ email: 'eu@exemplo.com' }));
  assert.equal(env.calls.fetch.length, 1);
  assert.equal(status(env), 'sent');
  assert.equal(JSON.parse(env.calls.fetch[0].opts.payload).payload.email, 'eu@exemplo.com');
});

test('Sem TESTE_LIVE_EMAIL definido, NENHUM e-mail é enviado', () => {
  const props = testLive();
  delete props.TESTE_LIVE_EMAIL;
  const env = createEnv({ props, fetchHandler: ok });
  env.post(validParams({ email: 'eu@exemplo.com' }));
  env.post(validParams({ email: 'outro@exemplo.com', submissionId: 'sub-guard-0002' }));
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(status(env, 0), 'blocked');
  assert.equal(status(env, 1), 'blocked');
});

test('Chamada direta a sendToRd_ com e-mail diferente, vazio ou ausente é bloqueada', () => {
  const env = createEnv({ props: testLive(), fetchHandler: ok });
  const base = { event_type: 'CONVERSION', event_family: 'CDP' };
  [{ email: 'x@y.com' }, { email: '' }, {}, { email: ALLOWED + '.br' }, { email: 'a' + ALLOWED }].forEach((p) => {
    const r = env.fn.sendToRd_({ ...base, payload: { conversion_identifier: 'partnershipForm_TESTE', ...p } });
    assert.equal(r.kind, 'blocked_email', JSON.stringify(p));
  });
  assert.equal(env.fn.sendToRd_({ ...base }).kind, 'blocked_email');
  assert.equal(env.calls.fetch.length, 0);
});

test('Reenvio/pendências: linha pendente de outro e-mail NÃO é enviada por processarPendentes', () => {
  // A linha nasce fora do ambiente de teste (RD indisponível) e fica pendente...
  const env = createEnv({
    props: { RD_MODE: 'live', RD_API_KEY: API_KEY, RD_CONVERSION_IDENTIFIER: 'partnershipForm_TESTE' },
    fetchHandler: () => ({ code: 503, body: '' })
  });
  env.post(validParams({ email: 'cliente.real@empresa.com.br' }));
  assert.equal(status(env), 'pending');

  // ...e só depois o projeto vira "ambiente de teste" com a RD funcionando
  env.props.AMBIENTE_TESTE = '1';
  env.props.TESTE_LIVE_EMAIL = ALLOWED;
  env.fetchHandler = ok;
  env.control().rows[1][7] = new Date(Date.now() - 1000);

  assert.equal(env.fn.processarPendentes(), 1, 'a linha foi processada...');
  assert.equal(env.calls.fetch.length, 1, '...mas apenas a tentativa anterior de 503 existe');
  assert.equal(status(env), 'blocked', '...e foi bloqueada');
});

test('Reenvio do e-mail liberado após falha temporária continua permitido', () => {
  let up = false;
  const env = createEnv({
    props: testLive(),
    fetchHandler: () => (up ? ok() : { code: 503, body: '' })
  });
  env.post(validParams({ email: ALLOWED }));
  assert.equal(status(env), 'pending');
  up = true;
  env.control().rows[1][7] = new Date(Date.now() - 1000);
  assert.equal(env.fn.processarPendentes(), 1);
  assert.equal(status(env), 'sent');
});

test('Segunda chamada após erro 400 também passa pela trava (e-mail liberado: 2 chamadas; outro: 0)', () => {
  const bad = {
    code: 400,
    body: JSON.stringify({ errors: [{ error_type: 'INVALID_OPTION', path: '$.payload.cf_como_conheceram_a_nesti_dante' }] })
  };

  const permitido = createEnv({ props: testLive(), fetchHandler: (() => { const q = [bad, ok()]; return () => q.shift(); })() });
  permitido.post(validParams({ email: ALLOWED }));
  assert.equal(permitido.calls.fetch.length, 2);

  const negado = createEnv({ props: testLive(), fetchHandler: () => bad });
  negado.post(validParams({ email: 'outro@empresa.com.br' }));
  assert.equal(negado.calls.fetch.length, 0);
});

test('Linhas "blocked" não voltam à fila por nenhuma rotina de recuperação', () => {
  const env = createEnv({ props: testLive(), fetchHandler: ok });
  env.post(validParams({ email: 'outro@empresa.com.br' }));
  assert.equal(status(env), 'blocked');

  assert.equal(env.fn.reenviarFalhas(), 0);
  assert.equal(env.fn.enfileirarOffDesde('2000-01-01T00:00:00Z'), 0);
  env.control().rows[1][7] = new Date(Date.now() - 1000);
  assert.equal(env.fn.processarPendentes(), 0);
  env.fn.retomarRD();
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(status(env), 'blocked');
});

test('Mensagem de bloqueio não contém e-mails nem a chave; nenhum alerta é enviado', () => {
  const env = createEnv({ props: testLive(), fetchHandler: ok });
  env.post(validParams({ email: 'cliente.real@empresa.com.br' }));
  const dump = JSON.stringify([errorOf(env), env.calls.logs, env.calls.mail]);
  assert.ok(!dump.includes('cliente.real'));
  assert.ok(!dump.includes(ALLOWED));
  assert.ok(!dump.includes(API_KEY));
  assert.equal(env.calls.mail.length, 0);
});

test('Trava inerte em produção (sem AMBIENTE_TESTE): qualquer e-mail continua sendo enviado', () => {
  const env = createEnv({ props: { RD_MODE: 'live', RD_API_KEY: API_KEY, TESTE_LIVE_EMAIL: ALLOWED }, fetchHandler: ok });
  env.post(validParams({ email: 'cliente@empresa.com.br' }));
  assert.equal(env.calls.fetch.length, 1);
  assert.equal(JSON.parse(env.calls.fetch[0].opts.payload).payload.conversion_identifier, 'partnershipForm');
  assert.equal(status(env), 'sent');
});

test('Em dry, a trava não muda nada (nenhuma chamada de qualquer forma)', () => {
  const env = createEnv({ props: testLive({ RD_MODE: 'dry' }), fetchHandler: ok });
  env.post(validParams({ email: ALLOWED }));
  env.post(validParams({ email: 'outro@empresa.com.br', submissionId: 'sub-guard-dry2' }));
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(status(env, 0), 'dry');
  assert.equal(status(env, 1), 'dry');
});

test('TesteLive: o e-mail do teste é o único que passa; um POST estranho na janela live é bloqueado', () => {
  const env = createEnv({
    props: testLive({ LIVE_TEST_OK: '1' }),
    extraFiles: [DEV_LIVE],
    fetchHandler: ok
  });
  env.fn.testeLive1_UmEnvio();
  assert.equal(env.calls.fetch.length, 1);
  assert.equal(JSON.parse(env.calls.fetch[0].opts.payload).payload.email, ALLOWED);

  // alguém posta na URL pública enquanto o modo ainda é live
  const estranho = env.post(validParams({ email: 'curioso@internet.com', submissionId: 'sub-estranho-01' }));
  assert.equal(estranho.status, 'success');
  assert.equal(env.calls.fetch.length, 1, 'continua sendo uma única chamada');
  assert.equal(env.control().rows[2][5], 'blocked');

  // e depois do teste, linhas "blocked" não impedem encerrar nem um novo teste
  env.fn.testeLive3_Encerrar();
  assert.equal(env.props.RD_MODE, 'dry');
});
