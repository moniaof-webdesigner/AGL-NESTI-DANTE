/**
 * SOMENTE PARA O PROJETO DE TESTE. NÃO copie este arquivo para produção.
 *
 * Funções para testar o Code.gs v2 direto no editor do Apps Script, sem HTTP
 * e sem chamar a RD. Todas se recusam a rodar se as propriedades do script não
 * forem exatamente:
 *   AMBIENTE_TESTE = 1
 *   RD_MODE        = dry
 *
 * Os e-mails de teste usam o domínio "exemplo.invalid" (não existe), então
 * nunca colidem com contatos reais copiados para a planilha de teste.
 */

var TESTE_CNPJ_VALIDO = '11.222.333/0001-81';
var TESTE_DOMINIO = '@exemplo.invalid';

function assertAmbienteTeste_() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('AMBIENTE_TESTE') !== '1' || p.getProperty('RD_MODE') !== 'dry') {
    throw new Error('Recusado: use apenas no projeto de teste com AMBIENTE_TESTE=1 e RD_MODE=dry.');
  }
}

function paramsTeste_(email, overrides) {
  var base = {
    nome: 'Teste Dry Automatizado',
    email: email,
    telefone: '(11) 91234-5678',
    empresa: 'Empresa Teste LTDA',
    cnpj: TESTE_CNPJ_VALIDO,
    segmento: 'Supermercado',
    segmento_outro: '',
    cargo: 'Gerente',
    premium: 'Sim',
    comoConheceuNestiDante: 'Indicação',
    origem: 'teste.local',
    dataEnvio: new Date().toISOString(),
    utm_source: 'teste',
    utm_medium: 'dry',
    utm_campaign: 'validacao-v2',
    utm_content: 'a',
    utm_term: 'b',
    submissionId: 'teste-' + Utilities.getUuid(),
    rd_cid: 'cid-teste',
    rd_trf: 'teste'
  };
  Object.keys(overrides || {}).forEach(function (k) { base[k] = overrides[k]; });
  return base;
}

function postTeste_(params) {
  var out = doPost({ parameter: params });
  return JSON.parse(out.getContent());
}

function registrarTeste_(chave, valor) {
  PropertiesService.getScriptProperties().setProperty(chave, JSON.stringify(valor));
}

function lerTeste_(chave) {
  var v = PropertiesService.getScriptProperties().getProperty(chave);
  return v ? JSON.parse(v) : null;
}

/** 1) Envio válido: deve gravar 1 linha em Parcerias + 1 em Controle_Envios (dry). */
function testeDry1_EnvioValido() {
  assertAmbienteTeste_();
  var email = 'teste.dry.' + Date.now() + TESTE_DOMINIO;
  var params = paramsTeste_(email);
  var resposta = postTeste_(params);
  registrarTeste_('TESTE_ULTIMO', { email: email, submissionId: params.submissionId });
  Logger.log('Resposta: ' + JSON.stringify(resposta) + ' (esperado: success)');
  Logger.log('E-mail usado: ' + email);
}

/** 2) Mesmo e-mail, MESMO conteúdo, outro submissionId (clique repetido): "duplicate" e não grava. */
function testeDry2_EmailDuplicado() {
  assertAmbienteTeste_();
  var ultimo = lerTeste_('TESTE_ULTIMO');
  if (!ultimo) throw new Error('Rode antes testeDry1_EnvioValido().');
  var resposta = postTeste_(paramsTeste_(ultimo.email.toUpperCase(), { submissionId: 'teste-' + Utilities.getUuid() }));
  Logger.log('Resposta: ' + JSON.stringify(resposta) + ' (esperado: duplicate)');
}

/** 3) Mesmo submissionId: deve responder "success" sem criar outra linha. */
function testeDry3_MesmoSubmissionId() {
  assertAmbienteTeste_();
  var ultimo = lerTeste_('TESTE_ULTIMO');
  if (!ultimo) throw new Error('Rode antes testeDry1_EnvioValido().');
  var resposta = postTeste_(paramsTeste_(ultimo.email, { submissionId: ultimo.submissionId }));
  Logger.log('Resposta: ' + JSON.stringify(resposta) + ' (esperado: success, sem linha nova)');
}

/** 4) CNPJ incompleto e CNPJ com dígito errado: devem responder "invalid". */
function testeDry4_CnpjInvalido() {
  assertAmbienteTeste_();
  var a = postTeste_(paramsTeste_('cnpj.curto.' + Date.now() + TESTE_DOMINIO, { cnpj: '11.222.333/0001' }));
  var b = postTeste_(paramsTeste_('cnpj.errado.' + Date.now() + TESTE_DOMINIO, { cnpj: '11.222.333/0001-82' }));
  Logger.log('Incompleto: ' + JSON.stringify(a) + ' (esperado: invalid)');
  Logger.log('Dígito errado: ' + JSON.stringify(b) + ' (esperado: invalid)');
}

/** 5) Confere o resultado nas planilhas e registra PASSOU/FALHOU. */
function testeDry5_Conferir() {
  assertAmbienteTeste_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var parcerias = ss.getSheetByName(SHEET_NAME);
  var controle = ss.getSheetByName(CONTROL_SHEET_NAME);
  var ultimo = lerTeste_('TESTE_ULTIMO');
  var resultados = [];

  function checa(nome, ok) { resultados.push((ok ? 'PASSOU  ' : 'FALHOU  ') + nome); }

  checa('Aba Controle_Envios existe', !!controle);
  if (!controle || !ultimo) { Logger.log(resultados.join('\n')); return; }

  var pLast = parcerias.getLastRow();
  var emails = pLast >= 2 ? parcerias.getRange(2, 3, pLast - 1, 1).getValues() : [];
  var cont = emails.filter(function (r) { return String(r[0]).toLowerCase() === ultimo.email; }).length;
  checa('Exatamente 1 linha em Parcerias para o e-mail de teste (achou ' + cont + ')', cont === 1);

  var linha = emails.map(function (r, i) { return String(r[0]).toLowerCase() === ultimo.email ? i + 2 : 0; })
    .filter(Boolean)[0];
  if (linha) {
    var v = parcerias.getRange(linha, 1, 1, 18).getValues()[0];
    checa('Linha com 18 colunas A–R preenchidas como esperado',
      v[1] === 'Teste Dry Automatizado' && v[5] === TESTE_CNPJ_VALIDO && v[6] === 'Supermercado' &&
      v[13] === 'teste' && v[14] === 'dry' && v[15] === 'validacao-v2');
    checa('Parcerias não ganhou colunas além da R', parcerias.getLastColumn() <= 18);
  }

  var cLast = controle.getLastRow();
  var cRows = cLast >= 2 ? controle.getRange(2, 1, cLast - 1, 13).getValues() : [];
  var mine = cRows.filter(function (r) { return r[0] === ultimo.submissionId; });
  checa('Exatamente 1 linha de controle para o submissionId (achou ' + mine.length + ')', mine.length === 1);
  if (mine.length === 1) {
    var r = mine[0];
    checa('rd_status = dry (nada enviado à RD)', r[5] === 'dry');
    checa('rd_tentativas = 0', Number(r[6]) === 0);
    checa('rd_event_uuid vazio', String(r[9]) === '');
    var body = JSON.parse(r[11]);
    checa('Payload simulado com conversion_identifier "' + getConversionIdentifier_() + '"',
      body.payload.conversion_identifier === getConversionIdentifier_());
    checa('Payload com cf_cnpj e UTMs', body.payload.cf_cnpj === TESTE_CNPJ_VALIDO &&
      body.payload.cf_utm_source === 'teste' && body.payload.cf_utm_campain === 'validacao-v2');
    var key = PropertiesService.getScriptProperties().getProperty('RD_API_KEY');
    checa('Chave da RD não aparece na linha de controle', !key || JSON.stringify(r).indexOf(key) === -1);
  }
  Logger.log(resultados.join('\n'));
}

/* ------------------------------------------------------------------ */
/* Regra de reenvio (v2.1): conteúdo alterado é aceito; idêntico é barrado */
/* Ordem: 1, 2, 3, 4, 5 (conferir) e só depois 7, 8, 9, 10; por fim 6.    */
/* ------------------------------------------------------------------ */

function linhasDoEmail_(email) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var parcerias = ss.getSheetByName(SHEET_NAME);
  var controle = ss.getSheetByName(CONTROL_SHEET_NAME);
  var alvo = String(email).trim().toLowerCase();
  var p = [];
  var c = [];
  var pLast = parcerias.getLastRow();
  if (pLast >= 2) {
    parcerias.getRange(2, 1, pLast - 1, 18).getValues().forEach(function (v, i) {
      if (String(v[2]).trim().toLowerCase() === alvo) p.push({ row: i + 2, values: v });
    });
  }
  var cLast = controle ? controle.getLastRow() : 0;
  if (cLast >= 2) {
    controle.getRange(2, 1, cLast - 1, CONTROL_HEADERS.length).getValues().forEach(function (v, i) {
      if (String(v[C.EMAIL - 1]) === alvo) c.push({ row: i + 2, values: v });
    });
  }
  return { parcerias: p, controle: c };
}

function checaTeste_(resultados, nome, ok) {
  resultados.push((ok ? 'PASSOU  ' : 'FALHOU  ') + nome);
}

/** 7) Mesma pessoa corrige o segmento: deve ser ACEITA (nova linha, reenvio = sim). */
function testeDry7_CorrecaoDeSegmento() {
  assertAmbienteTeste_();
  var ultimo = lerTeste_('TESTE_ULTIMO');
  if (!ultimo) throw new Error('Rode antes testeDry1_EnvioValido().');
  var antes = linhasDoEmail_(ultimo.email);
  var resposta = postTeste_(paramsTeste_(ultimo.email, { segmento: 'Farmácia' }));
  var depois = linhasDoEmail_(ultimo.email);
  var r = [];

  checaTeste_(r, 'Resposta success (veio: ' + resposta.status + ')', resposta.status === 'success');
  checaTeste_(r, 'Uma linha nova em Parcerias (' + antes.parcerias.length + ' -> ' + depois.parcerias.length + ')',
    depois.parcerias.length === antes.parcerias.length + 1);
  checaTeste_(r, 'Uma linha nova em Controle_Envios (' + antes.controle.length + ' -> ' + depois.controle.length + ')',
    depois.controle.length === antes.controle.length + 1);
  if (depois.parcerias.length >= 2 && depois.controle.length >= 2) {
    var velha = depois.parcerias[0].values;
    var nova = depois.parcerias[depois.parcerias.length - 1].values;
    var c = depois.controle[depois.controle.length - 1].values;
    checaTeste_(r, 'A linha antiga foi preservada (Supermercado)', velha[6] === 'Supermercado');
    checaTeste_(r, 'A linha nova tem o segmento corrigido (Farmácia)', nova[6] === 'Farmácia');
    checaTeste_(r, 'Nova linha com 18 colunas A–R', nova.length === 18);
    checaTeste_(r, 'reenvio = sim', c[C.RESEND - 1] === 'sim');
    checaTeste_(r, 'campos_alterados = segmento', c[C.CHANGED - 1] === 'segmento');
    checaTeste_(r, 'rd_status = dry (nada enviado à RD)', c[C.STATUS - 1] === 'dry');
    checaTeste_(r, 'impressao_digital preenchida (hash)', /^[0-9a-f]{64}$/.test(String(c[C.FINGERPRINT - 1])));
  }
  Logger.log(r.join('\n'));
}

/** 8) Repete a correção idêntica (mesmo conteúdo, até 24 h): deve responder "duplicate". */
function testeDry8_RepetirCorrecao() {
  assertAmbienteTeste_();
  var ultimo = lerTeste_('TESTE_ULTIMO');
  if (!ultimo) throw new Error('Rode antes testeDry1_EnvioValido().');
  var antes = linhasDoEmail_(ultimo.email);
  var resposta = postTeste_(paramsTeste_(ultimo.email.toUpperCase(), { segmento: 'Farmácia' }));
  var depois = linhasDoEmail_(ultimo.email);
  var r = [];
  checaTeste_(r, 'Resposta duplicate (veio: ' + resposta.status + ')', resposta.status === 'duplicate');
  checaTeste_(r, 'Mensagem "Você já enviou seu formulário."', resposta.message === 'Você já enviou seu formulário.');
  checaTeste_(r, 'Nenhuma linha nova em Parcerias', depois.parcerias.length === antes.parcerias.length);
  checaTeste_(r, 'Nenhuma linha nova em Controle_Envios', depois.controle.length === antes.controle.length);
  Logger.log(r.join('\n'));
}

/**
 * 9) Simula a passagem de 25 h (só nas linhas de teste @exemplo.invalid) e reenvia o MESMO
 * conteúdo: depois da janela vale como novo envio (reenvio = sim, campos_alterados = nenhum).
 */
function testeDry9_DepoisDa24h() {
  assertAmbienteTeste_();
  var ultimo = lerTeste_('TESTE_ULTIMO');
  if (!ultimo) throw new Error('Rode antes testeDry1_EnvioValido().');
  if (String(ultimo.email).indexOf(TESTE_DOMINIO) === -1) throw new Error('Recusado: só e-mails @exemplo.invalid.');

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var antes = linhasDoEmail_(ultimo.email);
  var envelhecida = new Date(Date.now() - 25 * 3600000);
  antes.parcerias.forEach(function (item) { sheet.getRange(item.row, 1).setValue(envelhecida); });

  var resposta = postTeste_(paramsTeste_(ultimo.email, { segmento: 'Farmácia' }));
  var depois = linhasDoEmail_(ultimo.email);
  var r = [];
  checaTeste_(r, 'Resposta success (veio: ' + resposta.status + ')', resposta.status === 'success');
  checaTeste_(r, 'Uma linha nova em Parcerias', depois.parcerias.length === antes.parcerias.length + 1);
  var c = depois.controle[depois.controle.length - 1].values;
  checaTeste_(r, 'reenvio = sim', c[C.RESEND - 1] === 'sim');
  checaTeste_(r, 'campos_alterados = nenhum', c[C.CHANGED - 1] === 'nenhum');
  checaTeste_(r, 'rd_status = dry', c[C.STATUS - 1] === 'dry');
  Logger.log(r.join('\n'));
}

/** 10) Conferência final dos reenvios: 3 linhas por e-mail, tudo em dry, sem nada enviado. */
function testeDry10_ConferirReenvios() {
  assertAmbienteTeste_();
  var ultimo = lerTeste_('TESTE_ULTIMO');
  if (!ultimo) throw new Error('Rode antes testeDry1_EnvioValido().');
  var x = linhasDoEmail_(ultimo.email);
  var r = [];
  checaTeste_(r, 'Parcerias: 3 linhas para o e-mail de teste (achou ' + x.parcerias.length + ')', x.parcerias.length === 3);
  checaTeste_(r, 'Controle_Envios: 3 linhas (achou ' + x.controle.length + ')', x.controle.length === 3);
  if (x.controle.length === 3) {
    var statuses = x.controle.map(function (i) { return i.values[C.STATUS - 1]; });
    var changed = x.controle.map(function (i) { return String(i.values[C.CHANGED - 1]); });
    checaTeste_(r, 'Todos rd_status = dry (' + statuses.join(',') + ')', statuses.every(function (s) { return s === 'dry'; }));
    checaTeste_(r, 'campos_alterados = ["", segmento, nenhum] (veio: ' + JSON.stringify(changed) + ')',
      changed[0] === '' && changed[1] === 'segmento' && changed[2] === 'nenhum');
    checaTeste_(r, 'Nenhuma tentativa na RD (rd_tentativas = 0 e sem event_uuid)',
      x.controle.every(function (i) { return Number(i.values[C.ATTEMPTS - 1]) === 0 && String(i.values[C.UUID - 1]) === ''; }));
    checaTeste_(r, 'Impressões digitais: a 1ª difere da 2ª; a 2ª e a 3ª são iguais (mesmo conteúdo)',
      x.controle[0].values[C.FINGERPRINT - 1] !== x.controle[1].values[C.FINGERPRINT - 1] &&
      x.controle[1].values[C.FINGERPRINT - 1] === x.controle[2].values[C.FINGERPRINT - 1]);
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cab = ss.getSheetByName(CONTROL_SHEET_NAME).getRange(1, 1, 1, CONTROL_HEADERS.length).getValues()[0];
  checaTeste_(r, 'Controle_Envios com os 16 cabeçalhos', cab.join('|') === CONTROL_HEADERS.join('|'));
  checaTeste_(r, 'Parcerias sem colunas além da R', ss.getSheetByName(SHEET_NAME).getLastColumn() <= 18);
  Logger.log(r.join('\n'));
}

/** 6) Apaga as linhas de teste (@exemplo.invalid) de Parcerias e Controle_Envios. */
function testeDry6_Limpar() {
  assertAmbienteTeste_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var removidas = 0;
  [[SHEET_NAME, 3], [CONTROL_SHEET_NAME, 2]].forEach(function (par) {
    var sheet = ss.getSheetByName(par[0]);
    if (!sheet) return;
    for (var row = sheet.getLastRow(); row >= 2; row--) {
      var valor = String(sheet.getRange(row, par[1]).getValue()).toLowerCase();
      if (valor.indexOf(TESTE_DOMINIO) !== -1) { sheet.deleteRow(row); removidas++; }
    }
  });
  PropertiesService.getScriptProperties().deleteProperty('TESTE_ULTIMO');
  Logger.log('Linhas de teste removidas: ' + removidas);
}
