'use strict';

/**
 * Garantias do modo dry / ambiente de teste: nenhuma chamada à RD,
 * nenhum e-mail de alerta indevido e nenhum identificador real em teste.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createEnv, validParams } = require('./gas-harness');

const API_KEY = 'CHAVE-SECRETA-DE-TESTE-123';
const DEV_FILE = path.join(__dirname, '..', 'apps-script', 'dev-only', 'TesteDry.gs');
const testEnv = (extra = {}) =>
  createEnv({
    props: { RD_MODE: 'dry', RD_API_KEY: API_KEY, AMBIENTE_TESTE: '1', ...extra },
    extraFiles: [DEV_FILE]
  });

test('dry com chave cadastrada: nenhuma chamada à RD em nenhum caminho', () => {
  const env = createEnv({ props: { RD_MODE: 'dry', RD_API_KEY: API_KEY } });
  assert.equal(env.post(validParams()).status, 'success');

  // Mesmo forçando a linha para a fila e chamando os rotinas de reenvio
  env.control().rows[1][5] = 'pending';
  env.control().rows[1][7] = new Date(Date.now() - 1000);
  assert.equal(env.fn.processarPendentes(), 0);
  assert.equal(env.fn.enfileirarOffDesde('2020-01-01T00:00:00Z'), 0);
  env.fn.resumoDiario();

  // E chamando a função de envio diretamente
  const direct = env.fn.sendToRd_({ payload: { conversion_identifier: 'x' } });
  assert.equal(direct.kind, 'blocked');

  assert.equal(env.calls.fetch.length, 0);
  assert.equal(env.calls.mail.length, 0);
});

test('Modo off e valor inválido em RD_MODE também nunca chamam a RD', () => {
  for (const mode of [undefined, 'off', 'LIVE ', 'qualquer', '']) {
    const props = { RD_API_KEY: API_KEY };
    if (mode !== undefined) props.RD_MODE = mode;
    const env = createEnv({ props });
    const r = env.fn.sendToRd_({ payload: { conversion_identifier: 'x' } });
    // 'LIVE ' (com espaço/maiúsculas) é normalizado para live; os demais bloqueiam
    if (String(mode).trim().toLowerCase() === 'live') {
      assert.equal(env.calls.fetch.length, 1);
    } else {
      assert.equal(r.kind, 'blocked');
      assert.equal(env.calls.fetch.length, 0);
    }
  }
});

test('AMBIENTE_TESTE=1 em live com o identificador real: bloqueado, nada enviado', () => {
  const env = testEnv({ RD_MODE: 'live' });
  assert.equal(env.post(validParams()).status, 'success');
  assert.equal(env.calls.fetch.length, 0);
  const headers = env.control().rows[0];
  const row = env.control().rows[1];
  assert.equal(row[headers.indexOf('rd_status')], 'pending');
  assert.match(row[headers.indexOf('rd_ultimo_erro')], /RD_CONVERSION_IDENTIFIER/);
});

test('AMBIENTE_TESTE=1 em live com identificador de teste: envia com o nome de teste', () => {
  const env = testEnv({
    RD_MODE: 'live',
    RD_CONVERSION_IDENTIFIER: 'partnershipForm_TESTE',
    TESTE_LIVE_EMAIL: 'maria@empresa.com.br' // e-mail liberado pela trava de teste
  });
  env.fetchHandler = () => ({ code: 200, body: JSON.stringify({ event_uuid: 'evt-t' }) });
  assert.equal(env.post(validParams()).status, 'success');
  assert.equal(env.calls.fetch.length, 1);
  const payload = JSON.parse(env.calls.fetch[0].opts.payload).payload;
  assert.equal(payload.conversion_identifier, 'partnershipForm_TESTE');
});

test('Produção (sem AMBIENTE_TESTE) usa partnershipForm; identificador inválido é ignorado', () => {
  const a = createEnv({ props: { RD_MODE: 'dry', RD_API_KEY: API_KEY } });
  a.post(validParams());
  assert.equal(JSON.parse(a.control().rows[1][11]).payload.conversion_identifier, 'partnershipForm');

  const b = createEnv({
    props: { RD_MODE: 'dry', RD_API_KEY: API_KEY, RD_CONVERSION_IDENTIFIER: 'x"; DROP' }
  });
  b.post(validParams());
  assert.equal(JSON.parse(b.control().rows[1][11]).payload.conversion_identifier, 'partnershipForm');
});

test('Funções de teste (dev-only): fluxo completo passa e limpa', () => {
  const env = testEnv();
  env.fn.testeDry1_EnvioValido();
  env.fn.testeDry2_EmailDuplicado();
  env.fn.testeDry3_MesmoSubmissionId();
  env.fn.testeDry4_CnpjInvalido();
  env.fn.testeDry5_Conferir();

  const log = env.calls.logs.join('\n');
  assert.match(log, /success\)/);
  assert.match(log, /"status":"duplicate".*esperado: duplicate/);
  assert.match(log, /Incompleto: .*"status":"invalid"/);
  assert.match(log, /Dígito errado: .*"status":"invalid"/);
  assert.ok(!log.includes('FALHOU'), log);
  assert.ok((log.match(/PASSOU/g) || []).length >= 8, log);
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(env.parcerias().getLastRow(), 2);

  env.fn.testeDry6_Limpar();
  assert.equal(env.parcerias().getLastRow(), 1);
  assert.equal(env.control().getLastRow(), 1);
});

test('Funções de teste recusam rodar sem AMBIENTE_TESTE=1 ou fora do dry', () => {
  const semFlag = createEnv({ props: { RD_MODE: 'dry' }, extraFiles: [DEV_FILE] });
  assert.throws(() => semFlag.fn.testeDry1_EnvioValido(), /Recusado/);

  const live = testEnv({ RD_MODE: 'live' });
  assert.throws(() => live.fn.testeDry1_EnvioValido(), /Recusado/);
  assert.throws(() => live.fn.testeDry6_Limpar(), /Recusado/);
  assert.equal(live.parcerias().getLastRow(), 1);
});
