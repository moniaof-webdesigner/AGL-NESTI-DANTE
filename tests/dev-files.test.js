'use strict';

/**
 * Funções de teste do projeto de TESTE (TesteDry.gs / TesteLive.gs) contra a
 * regra de deduplicação v2.1. Tudo local: nenhuma chamada real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createEnv } = require('./gas-harness');

const API_KEY = 'CHAVE-SECRETA-DE-TESTE-123';
const DRY = path.join(__dirname, '..', 'apps-script', 'dev-only', 'TesteDry.gs');
const LIVE = path.join(__dirname, '..', 'apps-script', 'dev-only', 'TesteLive.gs');
const ALLOWED = 'eu@exemplo.com';
const ok = () => ({ code: 200, body: JSON.stringify({ event_uuid: 'evt-ok' }) });

const dryEnv = (extra = {}) =>
  createEnv({
    props: { RD_MODE: 'dry', RD_API_KEY: API_KEY, AMBIENTE_TESTE: '1', ...extra },
    extraFiles: [DRY]
  });

const liveProps = (extra = {}) => ({
  RD_MODE: 'live', RD_API_KEY: API_KEY, AMBIENTE_TESTE: '1',
  RD_CONVERSION_IDENTIFIER: 'partnershipForm_TESTE',
  TESTE_LIVE_EMAIL: ALLOWED, TESTE_LIVE_PHONE: '(11) 98888-7777', LIVE_TEST_OK: '1', ...extra
});

test('Sequência completa do TesteDry (1 a 5, 7 a 10) passa sem nenhum FALHOU e sem chamar a RD', () => {
  const env = dryEnv();
  ['testeDry1_EnvioValido', 'testeDry2_EmailDuplicado', 'testeDry3_MesmoSubmissionId',
    'testeDry4_CnpjInvalido', 'testeDry5_Conferir', 'testeDry7_CorrecaoDeSegmento',
    'testeDry8_RepetirCorrecao', 'testeDry9_DepoisDa24h', 'testeDry10_ConferirReenvios']
    .forEach((name) => env.fn[name]());

  const log = env.calls.logs.join('\n');
  assert.ok(!log.includes('FALHOU'), log);
  assert.ok((log.match(/PASSOU/g) || []).length >= 35, log);
  assert.equal(env.calls.fetch.length, 0, 'nenhuma chamada à RD');
  assert.equal(env.calls.mail.length, 0, 'nenhum e-mail');

  // 3 envios aceitos do mesmo e-mail de teste
  assert.equal(env.parcerias().getLastRow(), 4);
  assert.equal(env.control().getLastRow(), 4);
  assert.deepEqual(
    Array.from(env.control().rows.slice(1).map((r) => r[14] + '/' + r[15])),
    ['não/', 'sim/segmento', 'sim/nenhum']
  );

  env.fn.testeDry6_Limpar();
  assert.equal(env.parcerias().getLastRow(), 1);
  assert.equal(env.control().getLastRow(), 1);
});

test('TesteDry7/8/9/10 recusam rodar sem AMBIENTE_TESTE=1 e RD_MODE=dry', () => {
  const semFlag = createEnv({ props: { RD_MODE: 'dry' }, extraFiles: [DRY] });
  const live = dryEnv({ RD_MODE: 'live' });
  ['testeDry7_CorrecaoDeSegmento', 'testeDry8_RepetirCorrecao', 'testeDry9_DepoisDa24h', 'testeDry10_ConferirReenvios']
    .forEach((name) => {
      assert.throws(() => semFlag.fn[name](), /Recusado/, name);
      assert.throws(() => live.fn[name](), /Recusado/, name);
    });
  assert.equal(live.parcerias().getLastRow(), 1);
});

test('TesteDry9 só envelhece linhas de e-mails @exemplo.invalid', () => {
  const env = dryEnv();
  env.fn.testeDry1_EnvioValido();
  const real = env.props.TESTE_ULTIMO;
  env.props.TESTE_ULTIMO = JSON.stringify({ email: 'cliente@empresa.com.br', submissionId: 'x' });
  assert.throws(() => env.fn.testeDry9_DepoisDa24h(), /@exemplo\.invalid/);
  env.props.TESTE_ULTIMO = real;
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('TesteLive: o teste real envia UMA conversão com o e-mail liberado (regra nova não atrapalha)', () => {
  const env = createEnv({ props: liveProps(), extraFiles: [LIVE], fetchHandler: ok });
  env.fn.testeLive1_UmEnvio();
  assert.equal(env.calls.fetch.length, 1);
  assert.equal(JSON.parse(env.calls.fetch[0].opts.payload).payload.conversion_identifier, 'partnershipForm_TESTE');
  env.fn.testeLive2_ConferirControle();
  assert.match(env.calls.logs.join('\n'), /rd_status: sent/);
  env.fn.testeLive3_Encerrar();
  assert.equal(env.props.RD_MODE, 'dry');
});

test('TesteLive repetido em 24 h com o mesmo e-mail: nada é enviado e a mensagem explica', () => {
  const env = createEnv({ props: liveProps(), extraFiles: [LIVE], fetchHandler: ok });
  env.fn.testeLive1_UmEnvio();
  env.fn.testeLive3_Encerrar();

  Object.assign(env.props, liveProps());
  env.fn.testeLive1_UmEnvio();
  assert.equal(env.calls.fetch.length, 1, 'continua sendo uma única chamada');
  assert.match(env.calls.logs.join('\n'), /NADA FOI ENVIADO/);
  assert.equal(env.props.TESTE_LIVE_ENVIADO, undefined, 'trava de envio único não fica presa');
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('TesteLive se recusa se houver envio "failed" do e-mail de teste (segura a ordem por e-mail)', () => {
  const env = createEnv({ props: liveProps(), extraFiles: [LIVE], fetchHandler: ok });
  env.post({
    nome: 'Teste Antigo', email: ALLOWED, telefone: '(11) 91234-5678', empresa: 'Empresa X',
    cnpj: '11.222.333/0001-81', segmento: 'Farmácia', submissionId: 'sub-antigo-0001'
  });
  env.control().rows[1][5] = 'failed';
  assert.throws(() => env.fn.testeLive1_UmEnvio(), /failed/);
  assert.equal(env.calls.fetch.length, 1, 'só a chamada do envio anterior; o teste novo não chamou nada');
});

test('TesteLive: failed de OUTRO e-mail não impede o teste', () => {
  const env = createEnv({ props: liveProps(), extraFiles: [LIVE], fetchHandler: ok });
  env.post({
    nome: 'Outra Pessoa', email: 'outra@empresa.com.br', telefone: '(11) 91234-5678', empresa: 'Empresa Y',
    cnpj: '11.222.333/0001-81', segmento: 'Farmácia', submissionId: 'sub-outro-0001'
  });
  env.control().rows[1][5] = 'failed';
  env.fn.testeLive1_UmEnvio();
  const sentToRd = env.calls.fetch.filter((c) => JSON.parse(c.opts.payload).payload.email === ALLOWED);
  assert.equal(sentToRd.length, 1);
});
