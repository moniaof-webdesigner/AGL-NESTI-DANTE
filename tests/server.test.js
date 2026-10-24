'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, validParams, VALID_CNPJ } = require('./gas-harness');

const API_KEY = 'CHAVE-SECRETA-DE-TESTE-123';
const live = (extra = {}) => ({ RD_MODE: 'live', RD_API_KEY: API_KEY, ...extra });

const rdOk = () => ({ code: 200, body: JSON.stringify({ event_uuid: 'evt-1' }) });

function controlRow(env, i = 0) {
  const headers = env.control().rows[0];
  const row = env.control().rows[i + 1];
  const out = {};
  headers.forEach((h, idx) => (out[h] = row[idx]));
  return out;
}

/* ---------- CNPJ ---------- */

test('CNPJ: dígitos verificadores', () => {
  const env = createEnv();
  const ok = (d) => env.fn.isValidCnpj_(d);
  assert.equal(ok('11222333000181'), true);
  assert.equal(ok('00861458000135'), true, 'CNPJ do rodapé do site');
  assert.equal(ok('11222333000182'), false, 'dígito final errado');
  assert.equal(ok('11222333000191'), false, 'primeiro dígito errado');
  assert.equal(ok('11111111111111'), false, 'todos iguais');
  assert.equal(ok('00000000000000'), false);
  assert.equal(ok('1122233300018'), false, '13 dígitos');
  assert.equal(ok('abc'), false);
});

test('CNPJ incompleto e inválido são rejeitados sem gravar nem converter', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });

  const incompleto = env.post(validParams({ cnpj: '11.222.333/0001' }));
  assert.equal(incompleto.status, 'invalid');
  assert.match(incompleto.errors.cnpj, /14 dígitos/);

  const invalido = env.post(validParams({ cnpj: '11.222.333/0001-82' }));
  assert.equal(invalido.status, 'invalid');
  assert.ok(invalido.errors.cnpj);

  assert.equal(env.parcerias().getLastRow(), 1, 'só o cabeçalho');
  assert.equal(env.control(), undefined, 'nenhum controle criado');
  assert.equal(env.calls.fetch.length, 0);
});

test('Validação do servidor: demais campos obrigatórios', () => {
  const env = createEnv();
  const r = env.post(
    validParams({ nome: 'Al', email: 'sem-arroba', telefone: '123', empresa: 'X', segmento: '' })
  );
  assert.equal(r.status, 'invalid');
  assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'empresa', 'nome', 'segmento', 'telefone']);

  const outro = env.post(validParams({ segmento: 'Outro', segmento_outro: '' }));
  assert.ok(outro.errors.segmento_outro);
});

/* ---------- Envio válido / colunas A–R ---------- */

test('Envio válido (modo off): uma linha A–R idêntica à versão anterior e nenhuma chamada à RD', () => {
  const env = createEnv({ props: { RD_API_KEY: API_KEY } }); // sem RD_MODE = off
  const r = env.post(validParams());
  assert.equal(r.status, 'success');

  assert.equal(env.parcerias().getLastRow(), 2);
  const row = env.parcerias().rows[1];
  assert.equal(row.length, 18, 'exatamente 18 colunas (A–R)');
  assert.ok(row[0] instanceof Date, 'A = data/hora do servidor');
  assert.deepEqual(Array.from(row.slice(1)), [
    'Maria da Silva', 'maria@empresa.com.br', '(11) 91234-5678', 'Empresa Teste LTDA',
    VALID_CNPJ, 'Supermercado', '', 'Gerente', 'Sim', 'Indicação', 'www.aglbrasil.com.br',
    '2026-10-23T12:00:00.000Z', 'google', 'cpc', 'campanha-teste', 'anuncio-a', 'sabonete'
  ]);

  const c = controlRow(env);
  assert.equal(c.rd_status, 'off');
  assert.equal(c.submissionId, 'sub-test-0001');
  assert.equal(c.email_normalizado, 'maria@empresa.com.br');
  assert.equal(c.linha_parcerias, 2);
  assert.equal(env.calls.fetch.length, 0);
});

test('Cabeçalho da aba Parcerias nunca é alterado', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });
  const before = JSON.stringify(env.parcerias().rows[0]);
  env.post(validParams());
  assert.equal(JSON.stringify(env.parcerias().rows[0]), before);
  assert.equal(env.parcerias().rows[0].length, 18);
});

test('Texto iniciado por = + - @ não vira fórmula', () => {
  const env = createEnv();
  env.post(validParams({ nome: '=HYPERLINK("http://x")', empresa: '+cmd', cargo: '@x' }));
  const row = env.parcerias().rows[1];
  assert.equal(row[1], "'=HYPERLINK(\"http://x\")");
  assert.equal(row[4], "'+cmd");
  assert.equal(row[8], "'@x");
});

/* ---------- Duplicidade / idempotência / lock ---------- */

test('E-mail já cadastrado (normalizado) retorna duplicate, sem linha nova e sem conversão', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });
  assert.equal(env.post(validParams()).status, 'success');

  const r = env.post(
    validParams({ email: '  MARIA@Empresa.com.br ', submissionId: 'sub-test-0002' })
  );
  assert.equal(r.status, 'duplicate');
  assert.equal(r.message, 'Você já enviou seu formulário.');
  assert.equal(env.parcerias().getLastRow(), 2);
  assert.equal(env.control().getLastRow(), 2);
  assert.equal(env.calls.fetch.length, 1);
});

test('Linha antiga (anterior ao v2, sem controle) com o MESMO conteúdo, dentro de 24 h, é duplicate', () => {
  const env = createEnv();
  const legacy = [
    new Date(), 'Maria da Silva', 'Maria@Empresa.com.br', '(11) 91234-5678', 'Empresa Teste LTDA',
    VALID_CNPJ, 'Supermercado', '', 'Gerente', 'Sim', 'Indicação'
  ];
  while (legacy.length < 18) legacy.push('');
  env.parcerias().appendRow(legacy);
  assert.equal(env.post(validParams()).status, 'duplicate');
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('Mesmo submissionId repetido: uma única linha e uma única conversão', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });
  const a = env.post(validParams());
  const b = env.post(validParams());
  assert.equal(a.status, 'success');
  assert.equal(b.status, 'success');
  assert.equal(env.parcerias().getLastRow(), 2);
  assert.equal(env.control().getLastRow(), 2);
  assert.equal(env.calls.fetch.length, 1);
});

test('LockService: adquirido e liberado em cada envio; ocupado devolve erro sem gravar', () => {
  const env = createEnv();
  env.post(validParams());
  assert.equal(env.calls.locks.acquired, env.calls.locks.released);

  env.lockAvailable = false;
  const busy = env.post(validParams({ email: 'outra@empresa.com.br', submissionId: 'sub-test-0009' }));
  assert.equal(busy.status, 'error');
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('Falha na gravação: erro, sem controle e sem conversão, lock liberado', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });
  env.parcerias().failNextAppend = true;
  const r = env.post(validParams());
  assert.equal(r.status, 'error');
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(env.calls.locks.acquired, env.calls.locks.released);
  // O cliente pode repetir com o mesmo submissionId
  assert.equal(env.post(validParams()).status, 'success');
  assert.equal(env.parcerias().getLastRow(), 2);
});

/* ---------- Modos ---------- */

test('Modo dry: monta e guarda o payload, não chama a RD', () => {
  const env = createEnv({ props: { RD_MODE: 'dry', RD_API_KEY: API_KEY } });
  assert.equal(env.post(validParams()).status, 'success');
  const c = controlRow(env);
  assert.equal(c.rd_status, 'dry');
  assert.equal(env.calls.fetch.length, 0);
  const body = JSON.parse(c.rd_payload);
  assert.equal(body.payload.conversion_identifier, 'partnershipForm');
});

test('Modo live: grava ANTES de chamar a RD, endpoint e payload oficiais', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });
  assert.equal(env.post(validParams()).status, 'success');

  assert.equal(env.calls.fetch.length, 1);
  const call = env.calls.fetch[0];
  assert.equal(call.sheetRowsAtCall, 2, 'a linha já estava gravada quando a RD foi chamada');
  assert.ok(call.url.startsWith('https://api.rd.services/platform/conversions?api_key='));
  assert.equal(call.opts.method, 'post');
  assert.equal(call.opts.contentType, 'application/json');

  const body = JSON.parse(call.opts.payload);
  assert.equal(body.event_type, 'CONVERSION');
  assert.equal(body.event_family, 'CDP');
  const p = body.payload;
  assert.equal(p.conversion_identifier, 'partnershipForm');
  assert.equal(p.email, 'maria@empresa.com.br');
  assert.equal(p.name, 'Maria da Silva');
  assert.equal(p.personal_phone, '(11) 91234-5678');
  assert.equal(p.company_name, 'Empresa Teste LTDA');
  assert.equal(p.job_title, 'Gerente');
  assert.equal(p.cf_cnpj, VALID_CNPJ);
  assert.equal(p.cf_qual_o_segmento_da_sua_empresa, 'Supermercado');
  assert.equal(p.cf_sua_empresa_ja_trabalha_com_produtos_premium_ou_importad_0, 'Sim');
  assert.equal(p.cf_como_conheceram_a_nesti_dante, 'Indicação');
  assert.equal(p.cf_utm_source, 'google');
  assert.equal(p.cf_utm_medium, 'cpc');
  assert.equal(p.cf_utm_campain, 'campanha-teste', 'grafia real do campo na RD');
  assert.equal(p.cf_utm_content, 'anuncio-a');
  assert.equal(p.cf_utm_term, 'sabonete');
  assert.equal(p.client_tracking_id, 'client-abc');
  assert.equal(p.traffic_source, 'google');
  assert.equal('cf_segmento_outro' in p, false, 'vazio é omitido');
  assert.equal('cf_origem' in p, false, 'hostname não sobrescreve "Origem" por padrão');

  const c = controlRow(env);
  assert.equal(c.rd_status, 'sent');
  assert.equal(c.rd_event_uuid, 'evt-1');
  assert.equal(c.rd_tentativas, 1);
});

test('Segmento "Outro" envia cf_segmento_outro', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });
  env.post(validParams({ segmento: 'Outro', segmento_outro: 'Hotelaria' }));
  const p = JSON.parse(env.calls.fetch[0].opts.payload).payload;
  assert.equal(p.cf_qual_o_segmento_da_sua_empresa, 'Outro');
  assert.equal(p.cf_segmento_outro, 'Hotelaria');
});

test('Sem RD_API_KEY em live: lead gravado, fila e alerta; nada vaza', () => {
  const env = createEnv({ props: { RD_MODE: 'live' } });
  assert.equal(env.post(validParams()).status, 'success');
  assert.equal(controlRow(env).rd_status, 'pending');
  assert.equal(env.props.RD_AUTH_BLOCKED, '1');
});

/* ---------- Falhas da RD e recuperação ---------- */

test('Falha temporária da RD (503): linha mantida, usuário vê sucesso, fila com backoff', () => {
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 503, body: 'x' }) });
  const r = env.post(validParams());
  assert.equal(r.status, 'success');
  assert.equal(env.parcerias().getLastRow(), 2);
  const c = controlRow(env);
  assert.equal(c.rd_status, 'pending');
  assert.equal(c.rd_tentativas, 1);
  assert.ok(c.rd_proxima_tentativa instanceof Date);
  assert.match(c.rd_ultimo_erro, /503/);
});

test('Falha de rede da RD (exceção): fila, e a chave não aparece em nenhum registro', () => {
  const env = createEnv({
    props: live(),
    fetchHandler: () => new Error('falha ao acessar https://api.rd.services/platform/conversions?api_key=' + API_KEY)
  });
  assert.equal(env.post(validParams()).status, 'success');
  const c = controlRow(env);
  assert.equal(c.rd_status, 'pending');
  assert.ok(!JSON.stringify(env.control().rows).includes(API_KEY));
  assert.ok(!JSON.stringify(env.parcerias().rows).includes(API_KEY));
  assert.ok(!env.calls.logs.join('\n').includes(API_KEY));
});

test('Recuperação: processarPendentes reenvia uma vez e não duplica', () => {
  let rdUp = false;
  const env = createEnv({
    props: live(),
    fetchHandler: () => (rdUp ? rdOk() : { code: 503, body: '' })
  });
  env.post(validParams());
  assert.equal(controlRow(env).rd_status, 'pending');

  // Ainda não venceu
  assert.equal(env.fn.processarPendentes(), 0);

  // Vence a próxima tentativa
  env.control().rows[1][7] = new Date(Date.now() - 1000);
  rdUp = true;
  assert.equal(env.fn.processarPendentes(), 1);
  assert.equal(controlRow(env).rd_status, 'sent');
  assert.equal(controlRow(env).rd_tentativas, 2);

  // Segunda execução não reenvia
  const fetchCount = env.calls.fetch.length;
  assert.equal(env.fn.processarPendentes(), 0);
  assert.equal(env.calls.fetch.length, fetchCount);
});

test('Esgotadas as tentativas: status failed e resumo diário avisa', () => {
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 500, body: '' }) });
  env.post(validParams());
  for (let i = 0; i < 10; i++) {
    const st = controlRow(env).rd_status;
    if (st !== 'pending') break;
    env.control().rows[1][7] = new Date(Date.now() - 1000);
    env.fn.processarPendentes();
  }
  const c = controlRow(env);
  assert.equal(c.rd_status, 'failed');
  assert.equal(c.rd_tentativas, 8);

  env.fn.resumoDiario();
  assert.equal(env.calls.mail.length, 1);
  assert.ok(!env.calls.mail[0].body.includes(API_KEY));

  // reenviarFalhas recoloca na fila
  assert.equal(env.fn.reenviarFalhas(), 1);
  assert.equal(controlRow(env).rd_status, 'pending');
});

test('400 com campo personalizado inválido: reenvia sem o campo e o lead entra', () => {
  const responses = [
    {
      code: 400,
      body: JSON.stringify({
        errors: [
          {
            error_type: 'INVALID_OPTION',
            path: '$.payload.cf_como_conheceram_a_nesti_dante',
            error_message: 'invalid'
          }
        ]
      })
    },
    rdOk()
  ];
  const env = createEnv({ props: live(), fetchHandler: () => responses.shift() });
  assert.equal(env.post(validParams()).status, 'success');
  assert.equal(env.calls.fetch.length, 2);
  const second = JSON.parse(env.calls.fetch[1].opts.payload).payload;
  assert.equal('cf_como_conheceram_a_nesti_dante' in second, false);
  assert.equal(second.conversion_identifier, 'partnershipForm');
  assert.equal(second.email, 'maria@empresa.com.br');
  const c = controlRow(env);
  assert.equal(c.rd_status, 'sent');
  assert.match(c.rd_ultimo_erro, /omitidos/);
});

test('400 que não é recuperável vira failed (sem loop)', () => {
  const env = createEnv({
    props: live(),
    fetchHandler: () => ({
      code: 400,
      body: JSON.stringify({ errors: [{ error_type: 'INVALID', path: '$.payload.email' }] })
    })
  });
  env.post(validParams());
  assert.equal(controlRow(env).rd_status, 'failed');
  assert.equal(env.calls.fetch.length, 1);
});

test('401/403: fila congelada, alerta, nada é enviado até retomarRD()', () => {
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 401, body: '' }) });
  env.post(validParams());
  assert.equal(controlRow(env).rd_status, 'pending');
  assert.equal(env.props.RD_AUTH_BLOCKED, '1');
  assert.equal(env.calls.mail.length, 1);

  // Novo envio com a chave bloqueada: grava e enfileira sem tentar a RD
  const before = env.calls.fetch.length;
  env.post(validParams({ email: 'joao@empresa.com.br', submissionId: 'sub-test-0003' }));
  assert.equal(env.calls.fetch.length, before);
  assert.equal(controlRow(env, 1).rd_status, 'pending');

  env.control().rows[1][7] = new Date(Date.now() - 1000);
  assert.equal(env.fn.processarPendentes(), 0, 'bloqueado');

  env.fn.retomarRD();
  env.fetchHandler = rdOk;
  env.control().rows[1][7] = new Date(Date.now() - 1000);
  env.control().rows[2][7] = new Date(Date.now() - 1000);
  assert.equal(env.fn.processarPendentes(), 2);
  assert.equal(controlRow(env, 0).rd_status, 'sent');
  assert.equal(controlRow(env, 1).rd_status, 'sent');
});

test('Linha "sending" travada (execução interrompida) é retomada após o prazo', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });
  env.post(validParams());
  // simula execução que morreu antes de concluir
  env.control().rows[1][5] = 'sending';
  env.control().rows[1][12] = new Date(Date.now() - 11 * 60000);
  env.fetchHandler = rdOk;
  assert.equal(env.fn.processarPendentes(), 1);
  assert.equal(controlRow(env).rd_status, 'sent');

  // "sending" recente não é tocada (outra execução ainda pode estar enviando)
  env.control().rows[1][5] = 'sending';
  env.control().rows[1][12] = new Date();
  assert.equal(env.fn.processarPendentes(), 0);
});

/* ---------- Mudança de modo sem reenvios duplicados ---------- */

test('off → live: linhas "off" e "dry" NUNCA são reenviadas automaticamente', () => {
  const env = createEnv({ props: { RD_API_KEY: API_KEY, RD_MODE: 'off' }, fetchHandler: rdOk });
  env.post(validParams());
  env.props.RD_MODE = 'dry';
  env.post(validParams({ email: 'dry@empresa.com.br', submissionId: 'sub-test-dry' }));
  env.props.RD_MODE = 'live';

  assert.equal(env.fn.processarPendentes(), 0);
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(controlRow(env, 0).rd_status, 'off');
  assert.equal(controlRow(env, 1).rd_status, 'dry');
});

test('enfileirarOffDesde: só as linhas "off" criadas após a interrupção da captura', () => {
  const env = createEnv({ props: { RD_API_KEY: API_KEY, RD_MODE: 'off' }, fetchHandler: rdOk });
  env.post(validParams({ email: 'antes@empresa.com.br', submissionId: 'sub-antes' }));
  env.post(validParams({ email: 'depois@empresa.com.br', submissionId: 'sub-depois' }));
  // a primeira foi criada ANTES da interrupção da captura
  env.control().rows[1][3] = new Date('2026-11-03T10:00:00-03:00');
  env.control().rows[2][3] = new Date('2026-11-03T15:00:00-03:00');

  env.props.RD_MODE = 'live';
  assert.equal(env.fn.enfileirarOffDesde('2026-11-03T14:30:00-03:00'), 1);
  assert.equal(controlRow(env, 0).rd_status, 'off');
  assert.equal(controlRow(env, 1).rd_status, 'pending');

  env.control().rows[2][7] = new Date(Date.now() - 1000);
  assert.equal(env.fn.processarPendentes(), 1);
  assert.equal(env.calls.fetch.length, 1);
  assert.equal(JSON.parse(env.calls.fetch[0].opts.payload).payload.email, 'depois@empresa.com.br');
  assert.equal(controlRow(env, 0).rd_status, 'off', 'não foi tocada');
});

test('processarPendentes não faz nada fora do modo live', () => {
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 503, body: '' }) });
  env.post(validParams());
  env.control().rows[1][7] = new Date(Date.now() - 1000);
  env.props.RD_MODE = 'off';
  env.fetchHandler = rdOk;
  assert.equal(env.fn.processarPendentes(), 0);
  assert.equal(controlRow(env).rd_status, 'pending');
});

/* ---------- Segurança ---------- */

test('Respostas do servidor nunca contêm chave nem detalhes internos', () => {
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 401, body: API_KEY }) });
  const raw = env.fn.doPost({ parameter: validParams() }).getContent();
  assert.ok(!raw.includes(API_KEY));
  assert.ok(!raw.includes('rd_'));
});

test('doGet continua sendo o health-check de sempre', () => {
  const env = createEnv();
  assert.deepEqual(env.get(), { status: 'ok', message: 'AGL Brasil - Apps Script ativo.' });
});

test('instalarGatilhos é idempotente', () => {
  const env = createEnv();
  env.fn.instalarGatilhos();
  env.fn.instalarGatilhos();
  assert.equal(env.triggers.length, 2);
});

test('Uma linha por submissão com 5 envios distintos e 5 repetidos', () => {
  const env = createEnv({ props: live(), fetchHandler: rdOk });
  for (let i = 0; i < 5; i++) {
    const p = validParams({ email: `u${i}@empresa.com.br`, submissionId: `sub-multi-${i}0000` });
    assert.equal(env.post(p).status, 'success');
    assert.equal(env.post(p).status, 'success');
  }
  assert.equal(env.parcerias().getLastRow(), 6);
  assert.equal(env.control().getLastRow(), 6);
  assert.equal(env.calls.fetch.length, 5);
});
