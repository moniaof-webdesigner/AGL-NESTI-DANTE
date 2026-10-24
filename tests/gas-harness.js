/**
 * Ambiente simulado do Google Apps Script para testar apps-script/Code.gs
 * localmente. Nenhuma chamada real: Sheets, Lock, Properties, UrlFetch e
 * MailApp são simulados em memória.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE_PATH = process.env.CODE_PATH || path.join(__dirname, '..', 'apps-script', 'Code.gs');

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = this.sheet.rows[this.row - 1 + r] || [];
      const cells = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = line[this.col - 1 + c];
        cells.push(v === undefined ? '' : v);
      }
      out.push(cells);
    }
    return out;
  }
  getValue() {
    return this.getValues()[0][0];
  }
  setValue(value) {
    return this.setValues([[value]]);
  }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const idx = this.row - 1 + r;
      if (!this.sheet.rows[idx]) this.sheet.rows[idx] = [];
      for (let c = 0; c < values[r].length; c++) {
        this.sheet.rows[idx][this.col - 1 + c] = values[r][c];
      }
    }
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  appendRow(values) {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error('appendRow falhou');
    }
    this.rows.push(values.slice());
  }
  getLastRow() {
    return this.rows.length;
  }
  getLastColumn() {
    return this.rows.reduce((m, r) => Math.max(m, r.length), 0);
  }
  deleteRow(n) {
    this.rows.splice(n - 1, 1);
  }
  getRange(row, col, numRows, numCols) {
    return new FakeRange(this, row, col, numRows || 1, numCols || 1);
  }
}

function createEnv(options = {}) {
  const props = Object.assign({}, options.props || {});
  const sheets = {};
  const calls = { fetch: [], mail: [], logs: [], locks: { acquired: 0, released: 0 } };
  const triggers = [];

  const addSheet = (name) => {
    sheets[name] = new FakeSheet(name);
    return sheets[name];
  };
  addSheet('Parcerias').appendRow([
    'Data/Hora', 'Nome', 'E-mail', 'WhatsApp', 'Empresa', 'CNPJ', 'Segmento',
    'Segmento (Outro)', 'Cargo', 'Premium/Importados', 'Como conheceu', 'Origem',
    'Data Envio (ISO)', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term'
  ]);

  const env = {
    sheets,
    props,
    calls,
    triggers,
    lockAvailable: true,
    fetchHandler:
      options.fetchHandler ||
      (() => ({ code: 200, body: JSON.stringify({ event_uuid: 'uuid-' + calls.fetch.length }) }))
  };

  const sandbox = {
    console,
    JSON,
    Date,
    Math,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Error,
    encodeURIComponent,
    isNaN,
    parseInt,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => addSheet(n)
      }),
      flush: () => {}
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (!env.lockAvailable) return false;
          calls.locks.acquired++;
          return true;
        },
        waitLock: () => {
          calls.locks.acquired++;
        },
        releaseLock: () => {
          calls.locks.released++;
        }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => {
          props[k] = String(v);
        },
        deleteProperty: (k) => {
          delete props[k];
        }
      })
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        calls.fetch.push({ url, opts, sheetRowsAtCall: sheets.Parcerias.getLastRow() });
        const r = env.fetchHandler(url, opts);
        if (r instanceof Error) throw r;
        return { getResponseCode: () => r.code, getContentText: () => r.body || '' };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        text,
        setMimeType() {
          return this;
        },
        getContent() {
          return text;
        }
      })
    },
    Utilities: {
      getUuid: () => 'uuid-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0'),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      // Como o Apps Script: devolve bytes com sinal
      computeDigest: (algorithm, value) =>
        Array.from(require('crypto').createHash('sha256').update(String(value), 'utf8').digest()).map((b) =>
          b > 127 ? b - 256 : b
        )
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'dono@example.com' }) },
    MailApp: { sendEmail: (to, subject, body) => calls.mail.push({ to, subject, body }) },
    Logger: { log: (m) => calls.logs.push(String(m)) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => {
        triggers.splice(triggers.indexOf(t), 1);
      },
      newTrigger: (fn) => {
        const t = { fn, getHandlerFunction: () => fn };
        const chain = {
          timeBased: () => chain,
          everyMinutes: () => chain,
          everyDays: () => chain,
          atHour: () => chain,
          create: () => {
            triggers.push(t);
            return t;
          }
        };
        return chain;
      }
    }
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), context, { filename: 'Code.gs' });
  (options.extraFiles || []).forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: path.basename(f) }));
  env.fn = context;

  env.post = (params) => {
    const out = context.doPost({ parameter: params });
    return JSON.parse(out.getContent());
  };
  env.get = () => JSON.parse(context.doGet().getContent());
  env.control = () => sheets.Controle_Envios;
  env.parcerias = () => sheets.Parcerias;
  return env;
}

/** CNPJ válido (dígitos verificadores corretos) usado nos testes. */
const VALID_CNPJ = '11.222.333/0001-81';

function validParams(overrides = {}) {
  return Object.assign(
    {
      nome: 'Maria da Silva',
      email: 'maria@empresa.com.br',
      telefone: '(11) 91234-5678',
      empresa: 'Empresa Teste LTDA',
      cnpj: VALID_CNPJ,
      segmento: 'Supermercado',
      segmento_outro: '',
      cargo: 'Gerente',
      premium: 'Sim',
      comoConheceuNestiDante: 'Indicação',
      origem: 'www.aglbrasil.com.br',
      dataEnvio: '2026-10-23T12:00:00.000Z',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'campanha-teste',
      utm_content: 'anuncio-a',
      utm_term: 'sabonete',
      submissionId: 'sub-test-0001',
      rd_cid: 'client-abc',
      rd_trf: 'google'
    },
    overrides
  );
}

module.exports = { createEnv, validParams, VALID_CNPJ };
