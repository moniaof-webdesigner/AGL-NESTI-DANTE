'use strict';

/**
 * Regra de deduplicação (v2.1): idempotência permanente por submissionId,
 * bloqueio só de conteúdo de negócio idêntico em 24 h, reenvio com dados
 * alterados aceito, ordem das conversões por e-mail e alerta de segmento.
 * Tudo local: nenhuma chamada real à RD, ao Google ou à rede.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, validParams, VALID_CNPJ } = require('./gas-harness');
const { createPage, fetchToGas, settle } = require('./page-harness');

const API_KEY = 'CHAVE-SECRETA-DE-TESTE-123';
const HOUR = 3600000;
const live = (extra = {}) => ({ RD_MODE: 'live', RD_API_KEY: API_KEY, ...extra });
const ok = () => ({ code: 200, body: JSON.stringify({ event_uuid: 'evt-ok' }) });

let seq = 0;
const nextId = () => 'sub-dedupe-' + String(++seq).padStart(6, '0');
const send = (env, overrides = {}) => env.post(validParams({ submissionId: nextId(), ...overrides }));
const ctl = (env, i = 0) => {
  const h = env.control().rows[0];
  const r = env.control().rows[i + 1];
  return Object.fromEntries(h.map((k, idx) => [k, r[idx]]));
};
/** Envelhece a linha n (1 = primeira de dados) da aba Parcerias. */
const age = (env, n, hours) => {
  env.parcerias().rows[n][0] = new Date(Date.now() - hours * HOUR);
};
const segmentsSent = (env) => env.calls.fetch.map((c) => JSON.parse(c.opts.payload).payload.cf_qual_o_segmento_da_sua_empresa);

/* ---------- 1. Idempotência permanente ---------- */

test('submissionId repetido é idempotente para sempre, inclusive depois de 24 h e com conteúdo diferente', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  const id = nextId();
  assert.equal(env.post(validParams({ submissionId: id })).status, 'success');
  age(env, 1, 72);
  const again = env.post(validParams({ submissionId: id, segmento: 'Farmácia' }));
  assert.equal(again.status, 'success');
  assert.equal(env.parcerias().getLastRow(), 2, 'nenhuma linha nova');
  assert.equal(env.control().getLastRow(), 2);
  assert.equal(env.calls.fetch.length, 1, 'nenhuma conversão nova');
});

/* ---------- 2. Conteúdo idêntico em 24 h ---------- */

test('Conteúdo idêntico do mesmo e-mail em 24 h: duplicate, sem linha, sem controle, sem conversão', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  assert.equal(send(env).status, 'success');
  age(env, 1, 23);
  const r = send(env);
  assert.equal(r.status, 'duplicate');
  assert.equal(r.message, 'Você já enviou seu formulário.');
  assert.equal(env.parcerias().getLastRow(), 2);
  assert.equal(env.control().getLastRow(), 2);
  assert.equal(env.calls.fetch.length, 1);
});

test('Mesmo conteúdo depois de 24 h é um novo envio (reenvio = sim, campos_alterados = nenhum)', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  send(env);
  age(env, 1, 25);
  assert.equal(send(env).status, 'success');
  assert.equal(env.parcerias().getLastRow(), 3);
  assert.equal(ctl(env, 1).reenvio, 'sim');
  assert.equal(ctl(env, 1).campos_alterados, 'nenhum');
  assert.equal(env.calls.fetch.length, 2);
});

test('UTMs, cookies da RD, data e submissionId não contam: só eles mudando continua duplicate', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  send(env);
  const r = send(env, {
    utm_source: 'facebook', utm_medium: 'social', utm_campaign: 'outra', utm_content: 'x', utm_term: 'y',
    rd_cid: 'outro-cliente-123', rd_trf: 'direct', dataEnvio: '2026-10-24T09:00:00.000Z', origem: 'outro.host'
  });
  assert.equal(r.status, 'duplicate');
  assert.equal(env.parcerias().getLastRow(), 2);
});

test('Comparação normalizada: espaços, maiúsculas, máscara de telefone e de CNPJ não criam "novo" envio', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  send(env);
  const r = send(env, {
    nome: '  maria   da SILVA ',
    email: ' MARIA@Empresa.com.br',
    telefone: '11912345678',
    empresa: 'empresa teste ltda',
    cnpj: '11222333000181',
    cargo: 'GERENTE'
  });
  assert.equal(r.status, 'duplicate');
});

test('"Segmento (Outro)" só conta quando o segmento é "Outro"', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  send(env, { segmento: 'Supermercado', segmento_outro: '' });
  assert.equal(send(env, { segmento: 'Supermercado', segmento_outro: 'texto residual' }).status, 'duplicate');

  const env2 = createEnv({ props: live(), fetchHandler: ok });
  send(env2, { segmento: 'Outro', segmento_outro: 'Hotelaria' });
  assert.equal(send(env2, { segmento: 'Outro', segmento_outro: 'hotelaria ' }).status, 'duplicate');
  const novo = send(env2, { segmento: 'Outro', segmento_outro: 'Turismo' });
  assert.equal(novo.status, 'success');
  assert.equal(ctl(env2, 1).campos_alterados, 'segmento_outro');
});

/* ---------- 3. Qualquer informação de negócio alterada ---------- */

test('Cada campo de negócio alterado (exceto e-mail) permite novo envio e é registrado em campos_alterados', () => {
  const changes = {
    nome: 'Maria S. Oliveira',
    telefone: '(21) 98888-7777',
    empresa: 'Outra Empresa LTDA',
    cnpj: '00.861.458/0001-35',
    segmento: 'Farmácia',
    cargo: 'Diretora',
    premium: 'Não',
    comoConheceuNestiDante: 'Instagram'
  };
  Object.entries(changes).forEach(([field, value]) => {
    const env = createEnv({ props: live(), fetchHandler: ok });
    send(env);
    const r = send(env, { [field]: value });
    assert.equal(r.status, 'success', field);
    assert.equal(env.parcerias().getLastRow(), 3, field);
    assert.equal(ctl(env, 1).reenvio, 'sim', field);
    assert.equal(ctl(env, 1).campos_alterados, field, field);
    assert.equal(env.calls.fetch.length, 2, field);
  });
});

test('Caso real: Representante Comercial corrigido para Loja de Cosméticos no dia seguinte', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  send(env, { segmento: 'Representante Comercial' });
  age(env, 1, 26);
  const r = send(env, { segmento: 'Perfumaria / Loja de Cosméticos' });
  assert.equal(r.status, 'success');
  assert.equal(env.parcerias().getLastRow(), 3, 'as duas linhas ficam na planilha');
  assert.equal(env.parcerias().rows[1][6], 'Representante Comercial');
  assert.equal(env.parcerias().rows[2][6], 'Perfumaria / Loja de Cosméticos');
  assert.deepEqual(segmentsSent(env), ['Representante Comercial', 'Perfumaria / Loja de Cosméticos']);
  assert.equal(ctl(env, 1).campos_alterados, 'segmento');
});

test('Correção dentro das 24 h também é aceita (o bloqueio é só para conteúdo idêntico)', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  send(env, { segmento: 'Representante Comercial' });
  const corrigido = send(env, { segmento: 'Farmácia' });
  assert.equal(corrigido.status, 'success');
  // e repetir a correção agora é duplicate
  assert.equal(send(env, { segmento: 'Farmácia' }).status, 'duplicate');
  // voltar ao valor antigo é, de novo, uma alteração em relação ao último
  assert.equal(send(env, { segmento: 'Representante Comercial' }).status, 'duplicate');
});

test('Linhas anteriores ao v2 (sem controle) entram na comparação', () => {
  const env = createEnv();
  const legacy = [
    new Date(Date.now() - 48 * HOUR), 'Maria da Silva', 'maria@empresa.com.br', '(11) 91234-5678',
    'Empresa Teste LTDA', VALID_CNPJ, 'Representante Comercial', '', 'Gerente', 'Sim', 'Indicação'
  ];
  while (legacy.length < 18) legacy.push('');
  env.parcerias().appendRow(legacy);
  const r = send(env, { segmento: 'Farmácia' });
  assert.equal(r.status, 'success');
  assert.equal(ctl(env).reenvio, 'sim');
  assert.equal(ctl(env).campos_alterados, 'segmento');
});

test('Primeiro envio de um e-mail: reenvio = não e campos_alterados vazio', () => {
  const env = createEnv();
  send(env);
  assert.equal(ctl(env).reenvio, 'não');
  assert.equal(ctl(env).campos_alterados, '');
});

/* ---------- Impressão digital e aba de controle ---------- */

test('Controle_Envios: 16 colunas; impressão digital é hash estável e muda com o conteúdo', () => {
  const env = createEnv();
  send(env);
  send(env, { segmento: 'Farmácia' });
  send(env, { email: 'outra@empresa.com.br' });
  assert.equal(env.control().rows[0].length, 16);
  assert.deepEqual(Array.from(env.control().rows[0].slice(13)), ['impressao_digital', 'reenvio', 'campos_alterados']);
  const a = ctl(env, 0).impressao_digital;
  const b = ctl(env, 1).impressao_digital;
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);

  const env2 = createEnv();
  send(env2);
  assert.equal(ctl(env2).impressao_digital, a, 'mesmo conteúdo, mesmo hash');
  assert.ok(!ctl(env2).impressao_digital.includes('maria'));
});

test('Aba de controle criada pela versão anterior (13 colunas) recebe as 3 colunas novas', () => {
  const env = createEnv();
  const legacyHeaders = [
    'submissionId', 'email_normalizado', 'linha_parcerias', 'criado_em', 'modo_na_criacao',
    'rd_status', 'rd_tentativas', 'rd_proxima_tentativa', 'rd_ultima_tentativa', 'rd_event_uuid',
    'rd_ultimo_erro', 'rd_payload', 'enviando_desde'
  ];
  env.sheets.Controle_Envios = new (env.sheets.Parcerias.constructor)('Controle_Envios');
  env.sheets.Controle_Envios.appendRow(legacyHeaders);
  assert.equal(send(env).status, 'success');
  assert.equal(env.control().rows[0].length, 16);
  assert.equal(env.control().rows[0][13], 'impressao_digital');
  assert.equal(ctl(env).reenvio, 'não');
});

/* ---------- 4. Ordem das conversões por e-mail ---------- */

test('Envio novo espera um mais antigo pendente do mesmo e-mail; ao liberar, saem na ordem', () => {
  let up = false;
  const env = createEnv({ props: live(), fetchHandler: () => (up ? ok() : { code: 503, body: '' }) });

  send(env, { segmento: 'Representante Comercial' }); // RD fora do ar → pending
  assert.equal(ctl(env, 0).rd_status, 'pending');
  assert.equal(env.calls.fetch.length, 1);

  up = true; // a RD volta, mas a mais antiga ainda está em espera (backoff)
  send(env, { segmento: 'Perfumaria / Loja de Cosméticos' });
  assert.equal(ctl(env, 1).rd_status, 'pending', 'o mais novo espera na fila');
  assert.equal(env.calls.fetch.length, 1, 'nenhuma chamada à RD enquanto houver um mais antigo pendente');

  // Vence só a espera da mais antiga: apenas ela é reivindicada
  env.control().rows[1][7] = new Date(Date.now() - 1000);
  assert.equal(env.fn.processarPendentes(), 1);
  assert.equal(ctl(env, 0).rd_status, 'sent');
  assert.equal(ctl(env, 1).rd_status, 'pending');

  assert.equal(env.fn.processarPendentes(), 1);
  assert.equal(ctl(env, 1).rd_status, 'sent');
  assert.deepEqual(segmentsSent(env), [
    'Representante Comercial', // 1ª tentativa (503)
    'Representante Comercial', // reenvio da mais antiga
    'Perfumaria / Loja de Cosméticos' // só depois, a mais nova
  ]);
});

test('Mais nova vencida antes da mais antiga: a mais antiga é a única elegível', () => {
  const env = createEnv({ props: live(), fetchHandler: () => ({ code: 503, body: '' }) });
  send(env, { segmento: 'Representante Comercial' });
  send(env, { segmento: 'Farmácia' });
  // a mais antiga ainda dentro da espera; a mais nova com espera vencida (vazia)
  env.control().rows[1][7] = new Date(Date.now() + 10 * 60000);
  env.control().rows[2][7] = new Date(Date.now() - 1000);
  const before = env.calls.fetch.length;
  assert.equal(env.fn.processarPendentes(), 0);
  assert.equal(env.calls.fetch.length, before, 'o envio antigo pendente não é ultrapassado');
});

test('Mais antiga em "failed" também segura as mais novas; reenviarFalhas devolve a ordem', () => {
  let up = false;
  const env = createEnv({ props: live(), fetchHandler: () => (up ? ok() : { code: 422, body: '' }) });
  send(env, { segmento: 'Representante Comercial' });
  assert.equal(ctl(env, 0).rd_status, 'failed');

  up = true;
  send(env, { segmento: 'Farmácia' });
  assert.equal(ctl(env, 1).rd_status, 'pending');
  assert.equal(env.fn.processarPendentes(), 0, 'segura enquanto a mais antiga estiver failed');

  assert.equal(env.fn.reenviarFalhas(), 1);
  assert.equal(env.fn.processarPendentes(), 1);
  assert.equal(env.fn.processarPendentes(), 1);
  assert.equal(ctl(env, 0).rd_status, 'sent');
  assert.equal(ctl(env, 1).rd_status, 'sent');
  assert.deepEqual(segmentsSent(env).slice(-2), ['Representante Comercial', 'Farmácia']);
});

test('E-mails diferentes não esperam um pelo outro', () => {
  let first = true;
  const env = createEnv({
    props: live(),
    fetchHandler: () => {
      if (first) { first = false; return { code: 503, body: '' }; }
      return ok();
    }
  });
  send(env, { email: 'a@empresa.com.br' });
  send(env, { email: 'b@empresa.com.br' });
  assert.equal(ctl(env, 0).rd_status, 'pending');
  assert.equal(ctl(env, 1).rd_status, 'sent');
});

test('Sem pendências do e-mail, o envio novo sai na hora (sem esperar o gatilho)', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  send(env);
  send(env, { segmento: 'Farmácia' });
  assert.equal(ctl(env, 0).rd_status, 'sent');
  assert.equal(ctl(env, 1).rd_status, 'sent');
  assert.equal(env.calls.fetch.length, 2);
});

test('Linhas off/dry/blocked de um e-mail não seguram as conversões novas', () => {
  const env = createEnv({ props: { RD_MODE: 'off', RD_API_KEY: API_KEY }, fetchHandler: ok });
  send(env, { segmento: 'Representante Comercial' }); // off
  env.props.RD_MODE = 'live';
  send(env, { segmento: 'Farmácia' });
  assert.equal(ctl(env, 0).rd_status, 'off');
  assert.equal(ctl(env, 1).rd_status, 'sent');
});

/* ---------- 6. Alerta de mudança de segmento ---------- */

test('Alerta de segmento NÃO é enviado sem ALERT_EMAIL (nem para o dono do script)', () => {
  const env = createEnv({ props: live(), fetchHandler: ok });
  send(env, { segmento: 'Representante Comercial' });
  send(env, { segmento: 'Farmácia' });
  assert.equal(env.calls.mail.length, 0);
  assert.equal(ctl(env, 1).campos_alterados, 'segmento', 'a mudança fica registrada no controle');
});

test('Com ALERT_EMAIL: um aviso por mudança de segmento, só com linha e segmentos (sem dados pessoais)', () => {
  const env = createEnv({ props: live({ ALERT_EMAIL: 'equipe@exemplo.invalid' }), fetchHandler: ok });
  send(env, { segmento: 'Representante Comercial' });
  assert.equal(env.calls.mail.length, 0, 'primeiro envio não alerta');
  send(env, { segmento: 'Perfumaria / Loja de Cosméticos' });
  assert.equal(env.calls.mail.length, 1);
  const mail = env.calls.mail[0];
  assert.equal(mail.to, 'equipe@exemplo.invalid');
  assert.match(mail.body, /Linha 3/);
  assert.match(mail.body, /Representante Comercial/);
  assert.match(mail.body, /Perfumaria \/ Loja de Cosméticos/);
  const dump = JSON.stringify(mail);
  ['maria@', 'Maria da Silva', 'empresa.com.br', '11.222.333', '91234', 'Empresa Teste', API_KEY].forEach((s) =>
    assert.ok(!dump.includes(s), 'não deve conter ' + s)
  );
});

test('Alerta só para segmento: mudança de outro campo, repetição idêntica ou e-mail novo não alertam', () => {
  const env = createEnv({ props: live({ ALERT_EMAIL: 'equipe@exemplo.invalid' }), fetchHandler: ok });
  send(env);
  send(env, { cargo: 'Diretora' });
  send(env, { cargo: 'Diretora' }); // duplicate
  send(env, { email: 'nova@empresa.com.br', segmento: 'Farmácia' });
  assert.equal(env.calls.mail.length, 0);
});

test('Falha no envio do alerta nunca derruba o cadastro', () => {
  const env = createEnv({ props: live({ ALERT_EMAIL: 'equipe@exemplo.invalid' }), fetchHandler: ok });
  env.fn.MailApp.sendEmail = () => { throw new Error('cota de e-mail esgotada'); };
  send(env, { segmento: 'Representante Comercial' });
  const r = send(env, { segmento: 'Farmácia' });
  assert.equal(r.status, 'success');
  assert.equal(env.parcerias().getLastRow(), 3);
  assert.equal(ctl(env, 1).rd_status, 'sent');
});

/* ---------- Colunas A–R e campos ---------- */

test('Cada envio aceito grava exatamente as 18 colunas A–R na mesma ordem de sempre', () => {
  const env = createEnv();
  send(env);
  send(env, { segmento: 'Farmácia', utm_source: 'bing' });
  [1, 2].forEach((i) => assert.equal(env.parcerias().rows[i].length, 18));
  assert.deepEqual(Array.from(env.parcerias().rows[2].slice(1)), [
    'Maria da Silva', 'maria@empresa.com.br', '(11) 91234-5678', 'Empresa Teste LTDA',
    VALID_CNPJ, 'Farmácia', '', 'Gerente', 'Sim', 'Indicação', 'www.aglbrasil.com.br',
    '2026-10-23T12:00:00.000Z', 'bing', 'cpc', 'campanha-teste', 'anuncio-a', 'sabonete'
  ]);
  assert.equal(env.parcerias().rows[0].length, 18, 'cabeçalho intacto');
});

/* ---------- Ponta a ponta: site → servidor simulado ---------- */

test('E2E: correção de segmento pelo site; repetição idêntica depois é barrada com a mensagem', async () => {
  const env = createEnv({ props: { RD_MODE: 'dry', RD_API_KEY: API_KEY } });

  const first = createPage({ fetchImpl: fetchToGas(env) });
  first.fill({ segmento: 'Representante Comercial' });
  first.submit();
  await settle();
  assert.equal(first.successStep.hidden, false);

  // mesma pessoa, em outro momento, outro carregamento da página: corrige o segmento
  const second = createPage({ fetchImpl: fetchToGas(env) });
  second.fill({ segmento: 'Perfumaria / Loja de Cosméticos' });
  second.submit();
  await settle();
  assert.equal(second.successStep.hidden, false, 'correção aceita');
  assert.equal(env.parcerias().getLastRow(), 3);

  // atualiza a página e envia exatamente o mesmo de novo
  const third = createPage({ fetchImpl: fetchToGas(env) });
  third.fill({ segmento: 'Perfumaria / Loja de Cosméticos' });
  third.submit();
  await settle();
  assert.equal(third.calls.length, 1, 'foi ao servidor, que decidiu');
  assert.equal(third.feedback.textContent, 'Você já enviou seu formulário.');
  assert.ok(third.successStep.hidden);
  assert.equal(env.parcerias().getLastRow(), 3);
});

test('E2E: mesma sessão, corrige o segmento logo após o sucesso: segundo envio com outro submissionId', async () => {
  const env = createEnv({ props: { RD_MODE: 'dry', RD_API_KEY: API_KEY } });
  const page = createPage({ fetchImpl: fetchToGas(env) });
  page.fill({ segmento: 'Representante Comercial' });
  page.submit();
  await settle();

  page.reopenForm();
  page.fill({ segmento: 'Farmácia' });
  page.submit();
  await settle();
  assert.equal(page.calls.length, 2);
  assert.equal(env.parcerias().getLastRow(), 3);
  const ids = env.control().rows.slice(1).map((r) => r[0]);
  assert.equal(new Set(ids).size, 2);
});
