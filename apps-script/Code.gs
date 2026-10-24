/**
 * AGL Brasil — Formulário de parceria (Apps Script v2)
 *
 * Recebe o POST do site, valida no servidor, grava a linha na aba
 * "Parcerias" (colunas A–R, inalteradas) e, SOMENTE depois da gravação
 * confirmada, registra a conversão "partnershipForm" na RD Station pela
 * API oficial de conversões (https://developers.rdstation.com/reference/conversao).
 *
 * Dados de controle (ID da submissão, status da RD, tentativas, erros) ficam
 * na aba separada "Controle_Envios". A aba "Parcerias" não recebe colunas novas.
 *
 * Script Properties (Configurações do projeto → Propriedades do script):
 *   RD_API_KEY   chave de API da RD (só aqui; nunca no código, em logs ou no site)
 *   RD_MODE      off | dry | live        (ausente ou inválido = off)
 *   ALERT_EMAIL  (opcional) destinatário dos alertas; padrão: dono do script
 *   Somente no projeto de TESTE (nunca em produção):
 *   AMBIENTE_TESTE=1             recusa enviar o identificador real "partnershipForm" e
 *                                só envia à RD o e-mail definido em TESTE_LIVE_EMAIL
 *                                (qualquer outro fica com rd_status = "blocked")
 *   RD_CONVERSION_IDENTIFIER     identificador alternativo (ex.: partnershipForm_TESTE)
 *
 * Modos (RD_MODE):
 *   off   grava a planilha; NÃO chama a RD. Guarda o payload em rd_payload
 *         (para uma eventual virada) e marca rd_status = "off".
 *   dry   grava a planilha; monta o payload da RD, guarda em rd_payload e NÃO
 *         envia. rd_status = "dry".
 *   live  grava a planilha e envia a conversão. rd_status = "sending" → "sent"
 *         (ou "pending" para nova tentativa, "failed" quando esgota).
 *
 * Linhas "off" e "dry" NUNCA são reenviadas automaticamente. Isso evita
 * duplicar conversões que a captura automática antiga da RD já registrou.
 * Para enviar as linhas "off" criadas depois que a captura automática foi
 * interrompida, use enfileirarOffDesde('AAAA-MM-DDTHH:MM:SSZ') uma única vez.
 *
 * Duplicidade (nunca por e-mail sozinho; uma pessoa pode preencher de novo):
 *   1. Mesmo submissionId  → idempotente, para sempre (não cria outra linha).
 *   2. Mesmo conteúdo de negócio (nome, e-mail, telefone, empresa, CNPJ, segmento,
 *      segmento "outro", cargo, premium, como conheceu) do mesmo e-mail dentro de
 *      DUP_IDENTICO_HORAS → "duplicate" (clique repetido, atualização de página).
 *   3. Qualquer campo de negócio diferente (ex.: segmento corrigido) ou envio
 *      idêntico fora da janela → novo envio legítimo: nova linha e nova conversão.
 *   UTMs, cookies da RD, data e submissionId NÃO entram na comparação.
 *
 * Ordem por e-mail: só a linha NÃO enviada mais antiga de cada e-mail é elegível.
 * Um envio novo espera um mais antigo (pending/sending/failed) do mesmo e-mail,
 * para que uma conversão antiga nunca sobrescreva dados mais recentes na RD.
 *
 * Alerta de mudança de segmento: só é enviado se ALERT_EMAIL estiver definido.
 *
 * Publicar como Web App (Implantar → Gerenciar implantações → editar → nova
 * versão): executar como "Eu"; acesso "Qualquer pessoa".
 */

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

var SHEET_NAME = 'Parcerias';
var CONTROL_SHEET_NAME = 'Controle_Envios';

var CONVERSION_IDENTIFIER = 'partnershipForm';
var RD_ENDPOINT = 'https://api.rd.services/platform/conversions';

// Campo da RD que recebe o WhatsApp. Confirmar com um lead real (ver docs).
var RD_PHONE_FIELD = 'personal_phone';
// O hostname do site (coluna L) só vai ao campo personalizado "Origem" se true.
// Desligado por padrão para não sobrescrever valores de outras integrações.
var RD_SEND_ORIGEM_HOST = false;

var MAX_ATTEMPTS = 8;
var BACKOFF_MINUTES = [5, 15, 60, 180, 360, 720, 1440, 1440];
var SENDING_STALE_MINUTES = 10;
var BATCH_LIMIT = 20;
var LOCK_WAIT_MS = 25000;
var ALERT_THROTTLE_MS = 60 * 60 * 1000;

var DUPLICATE_MESSAGE = 'Você já enviou seu formulário.';

// Janela em que um envio com conteúdo de negócio IDÊNTICO é tratado como repetição.
var DUP_IDENTICO_HORAS = 24;

// Campos de negócio comparados na deduplicação e coluna (1-based) na aba Parcerias.
var BUSINESS_FIELDS = [
  'nome', 'email', 'telefone', 'empresa', 'cnpj', 'segmento', 'segmento_outro',
  'cargo', 'premium', 'comoConheceuNestiDante'
];
var PARCERIAS_COL = {
  nome: 2, email: 3, telefone: 4, empresa: 5, cnpj: 6, segmento: 7, segmento_outro: 8,
  cargo: 9, premium: 10, comoConheceuNestiDante: 11
};

var CONTROL_HEADERS = [
  'submissionId',        // 1
  'email_normalizado',   // 2
  'linha_parcerias',     // 3
  'criado_em',           // 4
  'modo_na_criacao',     // 5
  'rd_status',           // 6
  'rd_tentativas',       // 7
  'rd_proxima_tentativa',// 8
  'rd_ultima_tentativa', // 9
  'rd_event_uuid',       // 10
  'rd_ultimo_erro',      // 11
  'rd_payload',          // 12
  'enviando_desde',      // 13
  'impressao_digital',   // 14  hash do conteúdo de negócio (auditoria)
  'reenvio',             // 15  sim = o e-mail já tinha envio anterior
  'campos_alterados'     // 16  campos de negócio que mudaram vs. o envio anterior
];

var C = {
  ID: 1, EMAIL: 2, ROW: 3, CREATED: 4, MODE: 5, STATUS: 6, ATTEMPTS: 7,
  NEXT: 8, LAST: 9, UUID: 10, ERROR: 11, PAYLOAD: 12, SENDING: 13,
  FINGERPRINT: 14, RESEND: 15, CHANGED: 16
};

/* ------------------------------------------------------------------ */
/* Pontos de entrada                                                   */
/* ------------------------------------------------------------------ */

function doGet() {
  return jsonResponse_({ status: 'ok', message: 'AGL Brasil - Apps Script ativo.' });
}

function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    var data = readSubmission_(params);

    var errors = validateSubmission_(data);
    if (Object.keys(errors).length) {
      return jsonResponse_({
        status: 'invalid',
        message: 'Dados inválidos.',
        errors: errors
      });
    }

    var mode = getMode_();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) {
      return jsonResponse_({ status: 'error', message: 'Servidor ocupado. Tente novamente.' });
    }

    var control;
    var controlRow;
    var row = 0;
    var verdict = null;
    var rdPayload = null;
    var sendNow = false;

    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      if (!sheet) {
        return jsonResponse_({ status: 'error', message: 'Aba "' + SHEET_NAME + '" não encontrada.' });
      }
      control = getControlSheet_();

      // 1) Idempotência: o mesmo submissionId nunca gera uma segunda linha.
      if (data.submissionId && findControlRowById_(control, data.submissionId)) {
        return jsonResponse_({ status: 'success', submissionId: data.submissionId });
      }

      // 2) Repetição técnica: mesmo conteúdo de negócio, mesmo e-mail, dentro da janela.
      //    Conteúdo diferente (ex.: segmento corrigido) é um novo envio legítimo.
      verdict = classifySubmission_(sheet, data);
      if (verdict.identical) {
        return jsonResponse_({ status: 'duplicate', message: DUPLICATE_MESSAGE });
      }

      // 3) Gravação em Parcerias (A–R, mesma ordem de sempre) e confirmação.
      var submissionId = data.submissionId || Utilities.getUuid();
      row = appendParceriasRow_(sheet, data);
      SpreadsheetApp.flush();
      var written = String(sheet.getRange(row, 3).getValue() || '').trim().toLowerCase();
      if (written !== data.emailNorm) {
        // Não confirmou: não cria controle nem conversão; o cliente pode repetir.
        return jsonResponse_({ status: 'error', message: 'Não foi possível confirmar a gravação.' });
      }

      // 4) Registro de controle (+ payload da RD, conforme o modo).
      rdPayload = buildRdPayload_(data);
      var status = 'off';
      var sending = '';
      if (mode === 'dry') {
        status = 'dry';
      } else if (mode === 'live') {
        // Ordem por e-mail: se há um envio mais antigo deste e-mail ainda não
        // concluído, este espera na fila (processarPendentes respeita a ordem).
        if (isRdBlocked_() || hasUnsentForEmail_(control, data.emailNorm)) {
          status = 'pending';
        } else {
          status = 'sending';
          sending = new Date();
          sendNow = true;
        }
      }

      var resend = verdict.resend ? 'sim' : 'não';
      var changedText = verdict.resend ? (verdict.changed.join(',') || 'nenhum') : '';
      controlRow = appendControlRow_(control, [
        submissionId, data.emailNorm, row, new Date(), mode, status, 0, '', '', '', '',
        JSON.stringify(rdPayload),
        sending,
        fingerprintOf_(businessKey_(businessValues_(data))),
        resend,
        changedText
      ]);
      data.submissionId = submissionId;
    } finally {
      lock.releaseLock();
    }

    // Alerta de mudança de segmento (só com ALERT_EMAIL definido; nunca derruba o envio).
    if (verdict && verdict.resend &&
        (verdict.changed.indexOf('segmento') !== -1 || verdict.changed.indexOf('segmento_outro') !== -1)) {
      notifySegmentChange_(row, verdict.previousSegment, data.segmento);
    }

    // 5) Conversão na RD, fora do lock e somente após a gravação confirmada.
    if (sendNow) {
      try {
        attemptRd_(control, controlRow, rdPayload, 0);
      } catch (err) {
        // A linha já está gravada: a falha da RD nunca derruba o cadastro.
        markRetry_(control, controlRow, 1, 'Exceção: ' + scrub_(err && err.message));
      }
    }

    return jsonResponse_({ status: 'success', submissionId: data.submissionId });
  } catch (error) {
    return jsonResponse_({ status: 'error', message: 'Erro ao processar o envio.' });
  }
}

/* ------------------------------------------------------------------ */
/* Leitura e validação                                                 */
/* ------------------------------------------------------------------ */

function readSubmission_(params) {
  var data = {
    submissionId: cleanId_(params.submissionId),
    nome: str_(params.nome, 200),
    email: str_(params.email, 254),
    telefone: str_(params.telefone, 30),
    empresa: str_(params.empresa, 200),
    cnpj: str_(params.cnpj, 30),
    segmento: str_(params.segmento, 100),
    segmento_outro: str_(params.segmento_outro, 200),
    cargo: str_(params.cargo, 100),
    premium: str_(params.premium, 100),
    comoConheceuNestiDante: str_(params.comoConheceuNestiDante, 100),
    origem: str_(params.origem, 200),
    dataEnvio: str_(params.dataEnvio, 40),
    utm_source: str_(params.utm_source, 200),
    utm_medium: str_(params.utm_medium, 200),
    utm_campaign: str_(params.utm_campaign, 200),
    utm_content: str_(params.utm_content, 200),
    utm_term: str_(params.utm_term, 200),
    rd_cid: cleanRdClientId_(params.rd_cid),
    rd_trf: cleanRdTrafficCookie_(params.rd_trf)
  };
  data.emailNorm = normalizeEmail_(data.email);
  return data;
}

function validateSubmission_(d) {
  var errors = {};

  if (d.nome.length < 3) errors.nome = 'Informe seu nome completo.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.email = 'Informe um e-mail válido.';

  var phoneDigits = digitsOnly_(d.telefone);
  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    errors.telefone = 'Informe um WhatsApp válido com DDD.';
  }

  if (d.empresa.length < 2) errors.empresa = 'Informe o nome da empresa.';

  var cnpjDigits = digitsOnly_(d.cnpj);
  if (cnpjDigits.length !== 14) {
    errors.cnpj = 'Informe um CNPJ válido (14 dígitos).';
  } else if (!isValidCnpj_(cnpjDigits)) {
    errors.cnpj = 'Informe um CNPJ válido.';
  }

  if (!d.segmento) errors.segmento = 'Selecione o segmento da sua empresa.';
  if (d.segmento === 'Outro' && !d.segmento_outro) {
    errors.segmento_outro = 'Digite o segmento da sua empresa.';
  }

  return errors;
}

/** Valida CNPJ pelos dígitos verificadores (14 dígitos, sem máscara). */
function isValidCnpj_(digits) {
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  function check(base, weights) {
    var sum = 0;
    for (var i = 0; i < weights.length; i++) sum += Number(base.charAt(i)) * weights[i];
    var rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  }

  var d1 = check(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  var d2 = check(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digits.charAt(12)) && d2 === Number(digits.charAt(13));
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function digitsOnly_(value) {
  return String(value || '').replace(/\D/g, '');
}

function str_(value, max) {
  var s = String(value === undefined || value === null ? '' : value).trim();
  return s.length > max ? s.substring(0, max) : s;
}

/** Identificador do visitante (UUID da RD). Valor fora do padrão é descartado. */
function cleanRdClientId_(value) {
  var s = String(value === undefined || value === null ? '' : value).trim();
  return /^[A-Za-z0-9._-]{8,100}$/.test(s) ? s : '';
}

/**
 * Valor bruto do cookie __trf.src ("encoded_" + base64). NUNCA truncado:
 * um base64 cortado ficaria ilegível para a RD. Acima do limite é descartado
 * (e a origem cai nos UTMs).
 */
function cleanRdTrafficCookie_(value) {
  var s = String(value === undefined || value === null ? '' : value).trim();
  if (!s || s.length > 4000) return '';
  return /[\u0000-\u001f]/.test(s) ? '' : s;
}

function cleanId_(value) {
  var s = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : '';
}

/** Impede que o Sheets interprete o texto como fórmula. */
function cell_(value) {
  var s = String(value === undefined || value === null ? '' : value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* ------------------------------------------------------------------ */
/* Planilhas                                                           */
/* ------------------------------------------------------------------ */

function appendParceriasRow_(sheet, d) {
  // Colunas A–R: mesma ordem e conteúdo da versão anterior.
  sheet.appendRow([
    new Date(),                          // A - Data/Hora (servidor)
    cell_(d.nome),                       // B - Nome
    cell_(d.email),                      // C - E-mail
    cell_(d.telefone),                   // D - WhatsApp
    cell_(d.empresa),                    // E - Empresa
    cell_(d.cnpj),                       // F - CNPJ
    cell_(d.segmento),                   // G - Segmento
    cell_(d.segmento_outro),             // H - Segmento (Outro)
    cell_(d.cargo),                      // I - Cargo
    cell_(d.premium),                    // J - Premium/Importados
    cell_(d.comoConheceuNestiDante),     // K - Como conheceu a Nesti Dante
    cell_(d.origem),                     // L - Origem
    cell_(d.dataEnvio),                  // M - Data Envio (ISO)
    cell_(d.utm_source),                 // N - UTM Source
    cell_(d.utm_medium),                 // O - UTM Medium
    cell_(d.utm_campaign),               // P - UTM Campaign
    cell_(d.utm_content),                // Q - UTM Content
    cell_(d.utm_term)                    // R - UTM Term
  ]);
  return sheet.getLastRow();
}

function getControlSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONTROL_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONTROL_SHEET_NAME);
    sheet.appendRow(CONTROL_HEADERS);
  } else if (sheet.getLastColumn() < CONTROL_HEADERS.length) {
    // Aba criada por uma versão anterior (menos colunas): completa o cabeçalho.
    sheet.getRange(1, 1, 1, CONTROL_HEADERS.length).setValues([CONTROL_HEADERS]);
  }
  return sheet;
}

function appendControlRow_(control, values) {
  control.appendRow(values);
  return control.getLastRow();
}

function findControlRowById_(control, id) {
  var last = control.getLastRow();
  if (last < 2) return 0;
  var ids = control.getRange(2, C.ID, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Deduplicação por conteúdo de negócio                                */
/* ------------------------------------------------------------------ */

/** Valor de um campo de negócio, normalizado só para comparar (nunca gravado). */
function normalizeBusinessValue_(field, value) {
  var s = String(value === undefined || value === null ? '' : value)
    .replace(/^'(?=[=+\-@])/, '') // apóstrofo de proteção contra fórmula (cell_)
    .trim();
  if (field === 'telefone' || field === 'cnpj') return digitsOnly_(s);
  return s.replace(/\s+/g, ' ').toLowerCase();
}

/** Campos de negócio normalizados. "Segmento (Outro)" só conta quando o segmento é "Outro". */
function businessValues_(source) {
  var out = {};
  BUSINESS_FIELDS.forEach(function (field) {
    out[field] = normalizeBusinessValue_(field, source[field]);
  });
  if (out.segmento !== 'outro') out.segmento_outro = '';
  return out;
}

function businessKey_(values) {
  return BUSINESS_FIELDS.map(function (field) { return values[field]; }).join('\u001f');
}

/** Hash do conteúdo de negócio (vai à aba de controle; não expõe os dados). */
function fingerprintOf_(key) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** Linha da aba Parcerias (colunas A–K) como objeto de campos de negócio. */
function businessSourceFromRow_(rowValues) {
  var source = {};
  BUSINESS_FIELDS.forEach(function (field) {
    source[field] = rowValues[PARCERIAS_COL[field] - 1];
  });
  return source;
}

/** Números das linhas de Parcerias com este e-mail (ordem crescente). */
function findEmailRows_(sheet, emailNorm) {
  var found = [];
  var last = sheet.getLastRow();
  if (last < 2) return found;
  var emails = sheet.getRange(2, PARCERIAS_COL.email, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    if (normalizeEmail_(emails[i][0]) === emailNorm) found.push(i + 2);
  }
  return found;
}

/**
 * Compara o envio com os anteriores do mesmo e-mail (a aba Parcerias é a fonte:
 * vale também para as linhas anteriores ao v2). Retorna:
 *   identical        mesmo conteúdo de negócio dentro de DUP_IDENTICO_HORAS
 *   resend           o e-mail já tinha algum envio
 *   changed          campos de negócio diferentes do envio anterior mais recente
 *   previousSegment  segmento (texto original) do envio anterior mais recente
 */
function classifySubmission_(sheet, data) {
  var values = businessValues_(data);
  var key = businessKey_(values);
  var rows = findEmailRows_(sheet, data.emailNorm);
  var cutoff = Date.now() - DUP_IDENTICO_HORAS * 3600000;
  var latest = null;
  var previousSegment = '';

  for (var i = rows.length - 1; i >= 0; i--) {
    var rowValues = sheet.getRange(rows[i], 1, 1, PARCERIAS_COL.comoConheceuNestiDante).getValues()[0];
    var previous = businessValues_(businessSourceFromRow_(rowValues));
    if (latest === null) {
      latest = previous;
      previousSegment = String(rowValues[PARCERIAS_COL.segmento - 1] || '');
    }
    if (toTime_(rowValues[0]) < cutoff) break; // as demais são ainda mais antigas
    if (businessKey_(previous) === key) {
      return { identical: true, resend: true, changed: [], previousSegment: previousSegment };
    }
  }

  var changed = [];
  if (latest) {
    BUSINESS_FIELDS.forEach(function (field) {
      if (latest[field] !== values[field]) changed.push(field);
    });
  }
  return { identical: false, resend: rows.length > 0, changed: changed, previousSegment: previousSegment };
}

function isUnsentStatus_(status) {
  var s = String(status);
  return s === 'pending' || s === 'sending' || s === 'failed';
}

/** Há um envio mais antigo deste e-mail ainda sem conclusão na RD? */
function hasUnsentForEmail_(control, emailNorm) {
  var last = control.getLastRow();
  if (last < 2) return false;
  var emails = control.getRange(2, C.EMAIL, last - 1, 1).getValues();
  var statuses = control.getRange(2, C.STATUS, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    if (String(emails[i][0]) === emailNorm && isUnsentStatus_(statuses[i][0])) return true;
  }
  return false;
}

/**
 * Aviso de mudança de segmento. SÓ é enviado se ALERT_EMAIL estiver definido
 * (não usa o dono do script como padrão). Leva apenas a linha e os segmentos,
 * sem dados pessoais. Falha de e-mail nunca interrompe o envio.
 */
function notifySegmentChange_(row, before, after) {
  try {
    var to = String(PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL') || '').trim();
    if (!to) return;
    MailApp.sendEmail(
      to,
      '[AGL Parceria] Segmento alterado em novo envio',
      'Linha ' + row + ' da aba "' + SHEET_NAME + '": segmento alterado de "' + before +
        '" para "' + after + '". Confira as negociações no CRM.'
    );
  } catch (ignore) {
    // Alerta é opcional.
  }
}

function readControlRow_(control, row) {
  return control.getRange(row, 1, 1, CONTROL_HEADERS.length).getValues()[0];
}

function updateControl_(control, row, changes) {
  var values = readControlRow_(control, row);
  Object.keys(changes).forEach(function (col) {
    values[Number(col) - 1] = changes[col];
  });
  control.getRange(row, 1, 1, CONTROL_HEADERS.length).setValues([values]);
}

function toTime_(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  var t = Date.parse(value);
  return isNaN(t) ? 0 : t;
}

/* ------------------------------------------------------------------ */
/* RD Station — payload e envio                                        */
/* ------------------------------------------------------------------ */

/**
 * Campos de ORIGEM do lead na API oficial de conversões da RD.
 * (Os UTMs continuam indo também aos campos personalizados cf_utm_*.)
 *
 *  - Com o cookie __trf.src: traffic_source recebe o valor do cookie e
 *    traffic_medium / traffic_campaign / traffic_value ficam VAZIOS
 *    (exigência da documentação da RD).
 *  - Sem o cookie, mas com utm_source: usa os UTMs
 *    (traffic_source = utm_source, traffic_medium = utm_medium,
 *     traffic_campaign = utm_campaign, traffic_value = utm_term).
 *  - Sem cookie e sem UTM: não envia nada (a RD mantém "Desconhecido";
 *    não inventamos origem).
 *
 * client_tracking_id (cookie _rdtrk / rdtrk) liga as visitas anteriores ao lead.
 */
function rdAttribution_(d) {
  var out = {};
  if (d.rd_cid) out.client_tracking_id = d.rd_cid;

  if (d.rd_trf) {
    out.traffic_source = d.rd_trf;
  } else if (d.utm_source) {
    out.traffic_source = d.utm_source;
    if (d.utm_medium) out.traffic_medium = d.utm_medium;
    if (d.utm_campaign) out.traffic_campaign = d.utm_campaign;
    if (d.utm_term) out.traffic_value = d.utm_term;
  }
  return out;
}

function buildRdPayload_(d) {
  var p = {
    conversion_identifier: getConversionIdentifier_(),
    email: d.email,
    name: d.nome,
    phone: d.telefone,
    company_name: d.empresa,
    job_title: d.cargo,
    cf_cnpj: d.cnpj,
    cf_qual_o_segmento_da_sua_empresa: d.segmento,
    cf_segmento_outro: d.segmento === 'Outro' ? d.segmento_outro : '',
    cf_sua_empresa_ja_trabalha_com_produtos_premium_ou_importad_0: d.premium,
    cf_como_conheceram_a_nesti_dante: d.comoConheceuNestiDante,
    cf_utm_source: d.utm_source,
    cf_utm_medium: d.utm_medium,
    cf_utm_campain: d.utm_campaign, // grafia real do campo na conta da RD
    cf_utm_content: d.utm_content,
    cf_utm_term: d.utm_term
  };
  var attribution = rdAttribution_(d);
  Object.keys(attribution).forEach(function (key) { p[key] = attribution[key]; });
  p[RD_PHONE_FIELD] = d.telefone;
  if (RD_SEND_ORIGEM_HOST) p.cf_origem = d.origem;

  Object.keys(p).forEach(function (key) {
    if (p[key] === '' || p[key] === undefined || p[key] === null) delete p[key];
  });

  return {
    event_type: 'CONVERSION',
    event_family: 'CDP',
    payload: p
  };
}

/**
 * Envia uma conversão. Retorna { kind, code, uuid, errors, message }.
 * kind: ok | badrequest | auth | retry | permanent
 */
function sendToRd_(body) {
  var props = PropertiesService.getScriptProperties();

  // Trava 1: nenhuma chamada à RD fora do modo live, qualquer que seja o caminho.
  if (getMode_() !== 'live') {
    return { kind: 'blocked', code: 0, message: 'RD_MODE não é "live"; nada foi enviado.' };
  }
  // Trava 2: projeto de teste (AMBIENTE_TESTE=1) nunca envia o identificador real,
  // para não acionar as automações do CRM/Chatuba.
  if (props.getProperty('AMBIENTE_TESTE') === '1' &&
      body && body.payload && body.payload.conversion_identifier === CONVERSION_IDENTIFIER) {
    return {
      kind: 'blocked', code: 0,
      message: 'Ambiente de teste: defina RD_CONVERSION_IDENTIFIER diferente de "' + CONVERSION_IDENTIFIER + '".'
    };
  }

  // Trava 3: em projeto de teste, SOMENTE o e-mail de TESTE_LIVE_EMAIL pode ir à RD.
  // Vale para todos os caminhos (envio imediato, segunda tentativa após erro 400,
  // processarPendentes e qualquer outra chamada), porque todos passam por aqui.
  if (props.getProperty('AMBIENTE_TESTE') === '1') {
    var allowedEmail = normalizeEmail_(props.getProperty('TESTE_LIVE_EMAIL'));
    var targetEmail = normalizeEmail_(body && body.payload && body.payload.email);
    if (!allowedEmail || !targetEmail || allowedEmail !== targetEmail) {
      return {
        kind: 'blocked_email', code: 0,
        message: 'Ambiente de teste: e-mail diferente de TESTE_LIVE_EMAIL; nada foi enviado.'
      };
    }
  }

  var key = props.getProperty('RD_API_KEY');
  if (!key) return { kind: 'auth', code: 0, message: 'RD_API_KEY não configurada.' };

  var response;
  try {
    response = UrlFetchApp.fetch(RD_ENDPOINT + '?api_key=' + encodeURIComponent(key), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { kind: 'retry', code: 0, message: 'Falha de rede: ' + scrub_(err && err.message) };
  }

  var code = response.getResponseCode();
  var text = String(response.getContentText() || '');
  var json = null;
  try { json = JSON.parse(text); } catch (ignore) { json = null; }

  if (code >= 200 && code < 300) {
    return { kind: 'ok', code: code, uuid: (json && json.event_uuid) || '' };
  }
  if (code === 400) {
    return { kind: 'badrequest', code: code, errors: (json && json.errors) || [], message: 'HTTP 400' };
  }
  if (code === 401 || code === 403) {
    return { kind: 'auth', code: code, message: 'HTTP ' + code + ' (chave recusada).' };
  }
  if (code === 408 || code === 429 || code >= 500) {
    return { kind: 'retry', code: code, message: 'HTTP ' + code };
  }
  return { kind: 'permanent', code: code, message: 'HTTP ' + code };
}

/** Campos removíveis (cf_*, etc.) citados nos erros 400 da RD. */
function removableFieldsFromErrors_(errors, payload) {
  var protectedKeys = { conversion_identifier: 1, email: 1 };
  var found = [];
  (errors || []).forEach(function (item) {
    var path = String((item && item.path) || '');
    var match = path.match(/payload\.([A-Za-z0-9_]+)/);
    if (match && payload.hasOwnProperty(match[1]) && !protectedKeys[match[1]]) {
      if (found.indexOf(match[1]) === -1) found.push(match[1]);
    }
  });
  return found;
}

/**
 * Tenta enviar a conversão da linha de controle. A linha precisa estar em
 * "sending" (reivindicada). Atualiza o status conforme o resultado.
 */
function attemptRd_(control, row, rdBody, attemptsBefore) {
  var attempts = attemptsBefore + 1;
  var result = sendToRd_(rdBody);
  var note = '';

  if (result.kind === 'badrequest') {
    var removable = removableFieldsFromErrors_(result.errors, rdBody.payload);
    if (removable.length) {
      removable.forEach(function (field) { delete rdBody.payload[field]; });
      note = 'Campos omitidos pela RD: ' + removable.join(', ') + '. ';
      result = sendToRd_(rdBody);
    }
  }

  var now = new Date();
  if (result.kind === 'ok') {
    updateControl_(control, row, (function () {
      var c = {};
      c[C.STATUS] = 'sent';
      c[C.ATTEMPTS] = attempts;
      c[C.NEXT] = '';
      c[C.LAST] = now;
      c[C.UUID] = result.uuid;
      c[C.ERROR] = note.trim();
      c[C.PAYLOAD] = JSON.stringify(rdBody);
      c[C.SENDING] = '';
      return c;
    })());
    return 'sent';
  }

  if (result.kind === 'auth') {
    PropertiesService.getScriptProperties().setProperty('RD_AUTH_BLOCKED', '1');
    markRetry_(control, row, attempts, note + result.message);
    sendAlert_('auth', 'A API da RD recusou a chave', 'As conversões ficam na fila (rd_status = pending). ' +
      'Corrija a chave em RD_API_KEY e execute retomarRD().');
    return 'pending';
  }

  if (result.kind === 'blocked_email') {
    // Decisão final (não entra na fila nem é reenviada): e-mail fora da lista de teste.
    var blockedChanges = {};
    blockedChanges[C.STATUS] = 'blocked';
    blockedChanges[C.ATTEMPTS] = attempts;
    blockedChanges[C.NEXT] = '';
    blockedChanges[C.LAST] = now;
    blockedChanges[C.ERROR] = result.message;
    blockedChanges[C.SENDING] = '';
    updateControl_(control, row, blockedChanges);
    return 'blocked';
  }

  if (result.kind === 'retry' || result.kind === 'blocked') {
    return markRetry_(control, row, attempts, note + result.message);
  }

  // badrequest sem solução ou erro permanente
  var failed = {};
  failed[C.STATUS] = 'failed';
  failed[C.ATTEMPTS] = attempts;
  failed[C.NEXT] = '';
  failed[C.LAST] = now;
  failed[C.ERROR] = (note + (result.message || 'Erro') + ' ' + summarizeErrors_(result.errors)).trim();
  failed[C.SENDING] = '';
  updateControl_(control, row, failed);
  return 'failed';
}

function summarizeErrors_(errors) {
  return (errors || []).slice(0, 5).map(function (e) {
    return (e && e.error_type ? e.error_type : '') + ' ' + (e && e.path ? e.path : '');
  }).join('; ');
}

/** Agenda a próxima tentativa (ou marca "failed" ao esgotar). */
function markRetry_(control, row, attempts, message) {
  var changes = {};
  changes[C.ATTEMPTS] = attempts;
  changes[C.LAST] = new Date();
  changes[C.ERROR] = String(message || '').substring(0, 500);
  changes[C.SENDING] = '';

  if (attempts >= MAX_ATTEMPTS) {
    changes[C.STATUS] = 'failed';
    changes[C.NEXT] = '';
    updateControl_(control, row, changes);
    return 'failed';
  }

  var wait = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] || 1440;
  changes[C.STATUS] = 'pending';
  changes[C.NEXT] = new Date(Date.now() + wait * 60000);
  updateControl_(control, row, changes);
  return 'pending';
}

/* ------------------------------------------------------------------ */
/* Recuperação e operação                                              */
/* ------------------------------------------------------------------ */

/** Gatilho (a cada 5 min): reenvia pendentes vencidas. Só atua em "live". */
function processarPendentes() {
  if (getMode_() !== 'live' || isRdBlocked_()) return 0;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return 0;

  var claimed = [];
  var control;
  try {
    control = getControlSheet_();
    var last = control.getLastRow();
    if (last >= 2) {
      var rows = control.getRange(2, 1, last - 1, CONTROL_HEADERS.length).getValues();
      var now = Date.now();
      // Ordem por e-mail: só a linha não enviada MAIS ANTIGA de cada e-mail é elegível.
      // As mais novas esperam (ainda que a mais antiga esteja em espera ou "failed").
      var heldEmails = {};
      for (var i = 0; i < rows.length && claimed.length < BATCH_LIMIT; i++) {
        var r = rows[i];
        var status = String(r[C.STATUS - 1]);
        if (!isUnsentStatus_(status)) continue;
        var emailKey = String(r[C.EMAIL - 1]);
        if (heldEmails[emailKey]) continue;
        heldEmails[emailKey] = true;
        if (status === 'failed') continue;
        var due = false;
        if (status === 'pending') {
          due = toTime_(r[C.NEXT - 1]) <= now;
        } else if (status === 'sending') {
          due = now - toTime_(r[C.SENDING - 1]) > SENDING_STALE_MINUTES * 60000;
        }
        if (!due) continue;

        var payloadText = String(r[C.PAYLOAD - 1] || '');
        if (!payloadText) continue;

        var rowNumber = i + 2;
        var claim = {};
        claim[C.STATUS] = 'sending';
        claim[C.SENDING] = new Date();
        updateControl_(control, rowNumber, claim);
        claimed.push({
          row: rowNumber,
          attempts: Number(r[C.ATTEMPTS - 1]) || 0,
          body: JSON.parse(payloadText)
        });
      }
    }
  } finally {
    lock.releaseLock();
  }

  claimed.forEach(function (item) {
    try {
      attemptRd_(control, item.row, item.body, item.attempts);
    } catch (err) {
      markRetry_(control, item.row, item.attempts + 1, 'Exceção: ' + scrub_(err && err.message));
    }
  });
  return claimed.length;
}

/**
 * Use UMA vez na virada: marca como "pending" as linhas "off" criadas a partir
 * do instante em que a captura automática da RD foi interrompida.
 * Ex.: enfileirarOffDesde('2026-11-03T14:30:00-03:00')
 */
function enfileirarOffDesde(isoDate) {
  var since = Date.parse(isoDate);
  if (isNaN(since)) throw new Error('Data inválida. Use o formato ISO 8601.');

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    var control = getControlSheet_();
    var last = control.getLastRow();
    var count = 0;
    if (last >= 2) {
      var rows = control.getRange(2, 1, last - 1, CONTROL_HEADERS.length).getValues();
      rows.forEach(function (r, i) {
        if (String(r[C.STATUS - 1]) === 'off' && toTime_(r[C.CREATED - 1]) >= since) {
          var changes = {};
          changes[C.STATUS] = 'pending';
          changes[C.ATTEMPTS] = 0;
          changes[C.NEXT] = '';
          if (!String(r[C.PAYLOAD - 1])) {
            changes[C.PAYLOAD] = JSON.stringify(buildRdPayloadFromSheetRow_(r[C.ROW - 1]));
          }
          updateControl_(control, i + 2, changes);
          count++;
        }
      });
    }
    Logger.log('Linhas enfileiradas: ' + count);
    return count;
  } finally {
    lock.releaseLock();
  }
}

/** Reconstrói o payload a partir da linha de Parcerias (linhas criadas em "off"). */
function buildRdPayloadFromSheetRow_(rowNumber) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var v = sheet.getRange(rowNumber, 1, 1, 18).getValues()[0];
  return buildRdPayload_({
    nome: String(v[1]), email: String(v[2]), telefone: String(v[3]), empresa: String(v[4]),
    cnpj: String(v[5]), segmento: String(v[6]), segmento_outro: String(v[7]),
    cargo: String(v[8]), premium: String(v[9]), comoConheceuNestiDante: String(v[10]),
    origem: String(v[11]),
    utm_source: String(v[13]), utm_medium: String(v[14]), utm_campaign: String(v[15]),
    utm_content: String(v[16]), utm_term: String(v[17]),
    rd_cid: '', rd_trf: ''
  });
}

/** Recoloca "failed" na fila, depois de corrigir a causa. */
function reenviarFalhas() {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    var control = getControlSheet_();
    var last = control.getLastRow();
    var count = 0;
    if (last >= 2) {
      var rows = control.getRange(2, 1, last - 1, CONTROL_HEADERS.length).getValues();
      rows.forEach(function (r, i) {
        if (String(r[C.STATUS - 1]) === 'failed' && String(r[C.PAYLOAD - 1])) {
          var changes = {};
          changes[C.STATUS] = 'pending';
          changes[C.ATTEMPTS] = 0;
          changes[C.NEXT] = '';
          updateControl_(control, i + 2, changes);
          count++;
        }
      });
    }
    Logger.log('Falhas recolocadas na fila: ' + count);
    return count;
  } finally {
    lock.releaseLock();
  }
}

/** Libera o envio após corrigir uma chave recusada pela RD. */
function retomarRD() {
  PropertiesService.getScriptProperties().deleteProperty('RD_AUTH_BLOCKED');
}

/** Contagem por status (apenas registro, sem dados pessoais). */
function statusResumo() {
  var control = getControlSheet_();
  var last = control.getLastRow();
  var counts = {};
  if (last >= 2) {
    control.getRange(2, C.STATUS, last - 1, 1).getValues().forEach(function (r) {
      var s = String(r[0]);
      counts[s] = (counts[s] || 0) + 1;
    });
  }
  Logger.log(JSON.stringify(counts));
  return counts;
}

/** Gatilho diário: avisa por e-mail se houver falhas ou pendências antigas. */
function resumoDiario() {
  if (getMode_() !== 'live') return;
  var counts = statusResumo();
  if (counts.failed || counts.pending) {
    sendAlert_('daily', 'Resumo diário: conversões da RD pendentes/falhas',
      'pending: ' + (counts.pending || 0) + ' | failed: ' + (counts.failed || 0) +
      '. Veja a aba "' + CONTROL_SHEET_NAME + '". Para recolocar falhas na fila: reenviarFalhas().');
  }
}

/** Execute uma vez: cria os gatilhos (reexecutar não duplica). */
function instalarGatilhos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'processarPendentes' || fn === 'resumoDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processarPendentes').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('resumoDiario').timeBased().everyDays(1).atHour(8).create();
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function getMode_() {
  var mode = String(PropertiesService.getScriptProperties().getProperty('RD_MODE') || '')
    .trim().toLowerCase();
  return mode === 'live' || mode === 'dry' ? mode : 'off';
}

/** Identificador da conversão. Só mude RD_CONVERSION_IDENTIFIER em projeto de teste. */
function getConversionIdentifier_() {
  var custom = String(PropertiesService.getScriptProperties()
    .getProperty('RD_CONVERSION_IDENTIFIER') || '').trim();
  return /^[A-Za-z0-9_ -]{1,60}$/.test(custom) ? custom : CONVERSION_IDENTIFIER;
}

function isRdBlocked_() {
  return PropertiesService.getScriptProperties().getProperty('RD_AUTH_BLOCKED') === '1';
}

/** Remove a chave de qualquer texto antes de gravar/registrar. */
function scrub_(text) {
  var s = String(text === undefined || text === null ? '' : text);
  var key = PropertiesService.getScriptProperties().getProperty('RD_API_KEY');
  if (key) s = s.split(key).join('***').split(encodeURIComponent(key)).join('***');
  return s.replace(/api_key=[^&\s"']+/g, 'api_key=***').substring(0, 500);
}

function sendAlert_(type, subject, body) {
  try {
    var props = PropertiesService.getScriptProperties();
    var stamp = 'LAST_ALERT_' + type;
    var last = Number(props.getProperty(stamp) || 0);
    if (Date.now() - last < ALERT_THROTTLE_MS) return;

    var to = props.getProperty('ALERT_EMAIL') || Session.getEffectiveUser().getEmail();
    if (!to) return;
    MailApp.sendEmail(to, '[AGL Parceria] ' + subject, body);
    props.setProperty(stamp, String(Date.now()));
  } catch (ignore) {
    // Alerta é opcional; nunca interrompe o fluxo.
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
