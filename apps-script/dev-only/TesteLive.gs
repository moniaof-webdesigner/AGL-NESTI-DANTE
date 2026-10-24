/**
 * SOMENTE PARA O PROJETO DE TESTE. NÃO copie este arquivo para produção.
 *
 * Teste REAL e ÚNICO da API oficial de conversões da RD Station, com o
 * identificador "partnershipForm_TESTE" (não é o identificador das automações).
 *
 * Só roda quando TODAS as propriedades abaixo estiverem definidas — e a última
 * (LIVE_TEST_OK) só deve ser criada no momento em que você autorizar o teste:
 *
 *   AMBIENTE_TESTE            = 1
 *   RD_MODE                   = live
 *   RD_CONVERSION_IDENTIFIER  = partnershipForm_TESTE
 *   TESTE_LIVE_EMAIL          = um e-mail SEU (caixa que você controla; nunca de cliente)
 *   TESTE_LIVE_PHONE          = o SEU WhatsApp (se algo disparar mensagem, ela chega a você)
 *   LIVE_TEST_OK              = 1   (interruptor final; remova ao terminar)
 *
 * Opcionais, para validar a ORIGEM do lead (use um e-mail NOVO na RD: a origem
 * é gravada na primeira conversão do contato):
 *   TESTE_LIVE_TRF   = valor do cookie __trf.src copiado do seu navegador
 *   TESTE_LIVE_CID   = valor do cookie _rdtrk (ou o "id" do rdtrk) do seu navegador
 *   Sem TESTE_LIVE_TRF, a origem é montada a partir dos UTMs do teste.
 *
 * Não execute instalarGatilhos() no projeto de teste: nada deve reenviar sozinho.
 * Mesmo assim, o teste se RECUSA a rodar se existir qualquer gatilho no projeto
 * ou qualquer linha pending/sending/off em Controle_Envios.
 */

function assertLiveTest_() {
  var p = PropertiesService.getScriptProperties();
  var problems = [];
  if (p.getProperty('AMBIENTE_TESTE') !== '1') problems.push('AMBIENTE_TESTE deve ser 1');
  if (p.getProperty('RD_MODE') !== 'live') problems.push('RD_MODE deve ser live');
  if (p.getProperty('RD_CONVERSION_IDENTIFIER') !== 'partnershipForm_TESTE') {
    problems.push('RD_CONVERSION_IDENTIFIER deve ser exatamente partnershipForm_TESTE');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.getProperty('TESTE_LIVE_EMAIL') || ''))) {
    problems.push('TESTE_LIVE_EMAIL ausente ou inválido');
  }
  if (String(p.getProperty('TESTE_LIVE_PHONE') || '').replace(/\D/g, '').length < 10) {
    problems.push('TESTE_LIVE_PHONE ausente ou inválido');
  }
  if (!p.getProperty('RD_API_KEY')) problems.push('RD_API_KEY ausente');
  if (p.getProperty('LIVE_TEST_OK') !== '1') problems.push('LIVE_TEST_OK deve ser 1 (autorização final)');
  if (p.getProperty('TESTE_LIVE_ENVIADO')) problems.push('o envio de teste já foi feito (execute testeLive3_Encerrar)');

  // Nada pode reenviar sozinho durante o teste real:
  // 1) nenhum gatilho automático no projeto;
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length) {
    problems.push('existem ' + triggers.length + ' gatilho(s) no projeto (remova-os no painel Gatilhos)');
  }
  // 2) nenhuma linha que o reenvio automático ou uma virada pudesse enviar.
  var control = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONTROL_SHEET_NAME);
  if (control && control.getLastRow() >= 2) {
    var blocked = { pending: 1, sending: 1, off: 1 };
    var statuses = control.getRange(2, C.STATUS, control.getLastRow() - 1, 1).getValues();
    var count = 0;
    statuses.forEach(function (row) {
      if (blocked[String(row[0]).trim().toLowerCase()]) count++;
    });
    if (count) {
      problems.push(count + ' linha(s) em ' + CONTROL_SHEET_NAME +
        ' com rd_status pending/sending/off (apague ou resolva antes do teste)');
    }
  }

  // 3) nenhum envio "failed" do e-mail de teste: pela regra de ordem por e-mail ele
  //    seguraria o novo e o teste não enviaria nada (resolva ou apague a linha antes).
  if (control && control.getLastRow() >= 2) {
    var testEmail = String(p.getProperty('TESTE_LIVE_EMAIL') || '').trim().toLowerCase();
    var cLast = control.getLastRow();
    var emails = control.getRange(2, C.EMAIL, cLast - 1, 1).getValues();
    var states = control.getRange(2, C.STATUS, cLast - 1, 1).getValues();
    for (var i = 0; i < emails.length; i++) {
      if (testEmail && String(emails[i][0]) === testEmail && String(states[i][0]).trim().toLowerCase() === 'failed') {
        problems.push('há envio "failed" anterior do e-mail de teste em ' + CONTROL_SHEET_NAME +
          ' (apague a linha de teste antes)');
        break;
      }
    }
  }

  if (problems.length) throw new Error('Recusado: ' + problems.join('; '));
}

/** 1) UM único envio real à API da RD, com o identificador de teste. */
function testeLive1_UmEnvio() {
  assertLiveTest_();
  var p = PropertiesService.getScriptProperties();
  var email = String(p.getProperty('TESTE_LIVE_EMAIL')).trim().toLowerCase();
  var submissionId = 'teste-live-' + Utilities.getUuid();

  var params = {
    nome: 'TESTE API RD - NAO CONTATAR',
    email: email,
    telefone: p.getProperty('TESTE_LIVE_PHONE'),
    empresa: 'TESTE API RD LTDA',
    cnpj: '11.222.333/0001-81',
    segmento: 'Supermercado',
    segmento_outro: '',
    cargo: 'Gerente',
    premium: 'Sim',
    comoConheceuNestiDante: 'Indicação',
    origem: 'teste.live',
    dataEnvio: new Date().toISOString(),
    utm_source: 'teste', utm_medium: 'live', utm_campaign: 'validacao-api',
    utm_content: 'a', utm_term: 'b',
    submissionId: submissionId,
    // Opcionais, para validar a ORIGEM do lead (copie do seu navegador, em
    // F12 → Aplicativo → Cookies). Se ficarem vazios, a origem vem dos UTMs.
    rd_cid: String(p.getProperty('TESTE_LIVE_CID') || ''),
    rd_trf: String(p.getProperty('TESTE_LIVE_TRF') || '')
  };
  var origemModo = params.rd_trf ? 'cookie __trf.src' : 'UTMs (sem cookie)';

  p.setProperty('TESTE_LIVE_ENVIADO', submissionId); // trava de envio único
  var resposta = JSON.parse(doPost({ parameter: params }).getContent());
  if (resposta.status === 'duplicate') {
    // Mesmo conteúdo do mesmo e-mail nas últimas 24 h: o servidor não gravou nem enviou nada.
    p.deleteProperty('TESTE_LIVE_ENVIADO');
    Logger.log('NADA FOI ENVIADO: o mesmo conteúdo deste e-mail já foi registrado nas últimas ' +
      DUP_IDENTICO_HORAS + ' h. Apague a linha de teste antiga (Parcerias e ' + CONTROL_SHEET_NAME +
      ') ou aguarde a janela passar, e rode de novo. Depois execute testeLive3_Encerrar().');
    return;
  }
  Logger.log('Origem enviada via: ' + origemModo + (params.rd_cid ? ' + client_tracking_id' : ' (sem client_tracking_id)'));
  Logger.log('Resposta do servidor: ' + JSON.stringify(resposta));
  Logger.log('Agora execute testeLive2_ConferirControle().');
}

/** 2) Mostra o resultado da chamada à RD (sem expor chave nem dados pessoais). */
function testeLive2_ConferirControle() {
  var id = PropertiesService.getScriptProperties().getProperty('TESTE_LIVE_ENVIADO');
  if (!id) throw new Error('Nenhum envio de teste registrado.');
  var control = getControlSheet_();
  var row = findControlRowById_(control, id);
  if (!row) throw new Error('Linha de controle não encontrada.');
  var r = readControlRow_(control, row);
  var body = JSON.parse(String(r[C.PAYLOAD - 1]) || '{}');
  Logger.log('rd_status: ' + r[C.STATUS - 1] + ' (esperado: sent)');
  Logger.log('rd_tentativas: ' + r[C.ATTEMPTS - 1]);
  Logger.log('rd_event_uuid: ' + (r[C.UUID - 1] ? 'presente' : 'AUSENTE'));
  Logger.log('rd_ultimo_erro: ' + (r[C.ERROR - 1] || '(vazio)'));
  Logger.log('conversion_identifier enviado: ' + (body.payload && body.payload.conversion_identifier));
  Logger.log('Campos enviados: ' + Object.keys(body.payload || {}).join(', '));
}

/** 3) Encerra: volta para dry, remove o interruptor final. Execute sempre ao terminar. */
function testeLive3_Encerrar() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('RD_MODE', 'dry');
  p.deleteProperty('LIVE_TEST_OK');
  p.deleteProperty('TESTE_LIVE_ENVIADO');
  Logger.log('RD_MODE = dry; LIVE_TEST_OK removido. Teste real encerrado.');
}
