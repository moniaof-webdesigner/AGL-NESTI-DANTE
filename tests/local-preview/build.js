'use strict';

/**
 * Gera uma CÓPIA do site em tests/.local-site/ para testar o formulário
 * localmente contra o Apps Script de TESTE.
 *
 * Os arquivos definitivos do site NÃO são alterados. Na cópia:
 *   - a URL do Apps Script é trocada pela URL de teste;
 *   - o Google Tag Manager e o código de monitoramento da RD são REMOVIDOS;
 *   - uma CSP (Content-Security-Policy) bloqueia qualquer conexão que não seja
 *     o próprio servidor local ou o Apps Script do Google. Mesmo que algum script
 *     da RD voltasse a aparecer, o navegador recusaria a conexão.
 *
 * Uso:
 *   node local-preview/build.js "https://script.google.com/macros/s/XXXX/exec"
 *   (ou defina AGL_TEST_GAS_URL)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', '.local-site');

const PRODUCTION_ID_PREFIX = 'AKfycbx1J7'; // implantação de PRODUÇÃO (já pública no site)

function fail(message) {
  console.error('\nERRO: ' + message + '\n');
  process.exit(1);
}

const testUrl = (process.argv[2] || process.env.AGL_TEST_GAS_URL || '').trim();
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(testUrl)) {
  fail('Informe a URL da implantação de TESTE (https://script.google.com/macros/s/…/exec).');
}
if (testUrl.includes(PRODUCTION_ID_PREFIX)) {
  fail('Esta é a URL de PRODUÇÃO. Use a URL da implantação de teste. Nada foi gerado.');
}

const originalHandler = fs.readFileSync(path.join(ROOT, 'js', 'form-handler.js'), 'utf8');
const productionUrl = (originalHandler.match(
  /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/
) || [])[0];
if (!productionUrl) fail('URL de produção não encontrada em js/form-handler.js.');
if (productionUrl === testUrl) fail('A URL de teste é igual à de produção.');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

['css', 'js', 'assets'].forEach((dir) => {
  fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
});
['privacidade.html', 'termos.html', 'robots.txt'].forEach((file) => {
  fs.copyFileSync(path.join(ROOT, file), path.join(OUT, file));
});

/* ---------- form-handler.js: só a URL muda ---------- */
const handlerOut = originalHandler.split(productionUrl).join(testUrl);
fs.writeFileSync(path.join(OUT, 'js', 'form-handler.js'), handlerOut);

/* ---------- páginas HTML: sem GTM, sem RD, com CSP ---------- */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

function sanitizeHtml(html) {
  let out = html;

  // Google Tag Manager (pode carregar tags da RD)
  out = out.replace(/<!-- Google Tag Manager -->[\s\S]*?<!-- End Google Tag Manager -->\s*/g, '');
  out = out.replace(/<!-- Google Tag Manager \(noscript\) -->[\s\S]*?<!-- End Google Tag Manager \(noscript\) -->\s*/g, '');

  // Código de monitoramento da RD Station
  out = out.replace(/\s*<!-- RD Station[^>]*-->\s*/g, '\n');
  out = out.replace(/\s*<script[^>]*cloudfront\.net[^>]*><\/script>\s*/g, '\n');

  // CSP como primeira coisa dentro do <head>
  out = out.replace(
    /<head>/,
    '<head>\n  <meta http-equiv="Content-Security-Policy" content="' + CSP + '">'
  );

  // Identificação visual do ambiente de teste (não afeta o formulário)
  out = out.replace(/<title>/, '<title>[TESTE LOCAL] ');
  out = out.replace(
    /<\/body>/,
    '  <div style="position:fixed;left:8px;bottom:8px;z-index:2147483647;pointer-events:none;' +
      'background:#b00020;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:6px 9px;' +
      'border-radius:4px;opacity:.9">TESTE LOCAL · Apps Script de TESTE · sem RD</div>\n</body>'
  );
  return out;
}

['index.html', 'privacidade.html', 'termos.html'].forEach((file) => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  fs.writeFileSync(path.join(OUT, file), sanitizeHtml(source));
});

/* ---------- Verificações (o build falha se alguma não passar) ---------- */
const checks = [];
function check(name, ok) {
  checks.push({ name, ok });
}

const forbidden = /cloudfront\.net|rdstation|googletagmanager|GTM-[A-Z0-9]+|rd-js-integration|rdtracker/i;
['index.html', 'privacidade.html', 'termos.html'].forEach((file) => {
  const html = fs.readFileSync(path.join(OUT, file), 'utf8');
  check(`${file}: sem GTM/RD`, !forbidden.test(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')));
  check(`${file}: CSP presente`, html.includes('Content-Security-Policy'));
});
const builtHandler = fs.readFileSync(path.join(OUT, 'js', 'form-handler.js'), 'utf8');
check('form-handler (cópia): usa a URL de teste', builtHandler.includes(testUrl));
check('form-handler (cópia): sem a URL de produção', !builtHandler.includes(productionUrl));
check('form-handler (original): intacto', fs.readFileSync(path.join(ROOT, 'js', 'form-handler.js'), 'utf8') === originalHandler);
check('index.html (original): ainda tem o código da RD (não foi tocado)',
  fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('cloudfront.net/js/loader-scripts'));

const jsFiles = fs.readdirSync(path.join(OUT, 'js'));
const rdInJs = jsFiles.filter((f) => /rdstation|event-api\.rdstation|form_integrations/i.test(
  fs.readFileSync(path.join(OUT, 'js', f), 'utf8')));
check('JS da cópia: sem referência a endpoints da RD', rdInJs.length === 0);

let failed = 0;
checks.forEach((c) => {
  console.log((c.ok ? 'OK     ' : 'FALHOU ') + c.name);
  if (!c.ok) failed++;
});
if (failed) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fail(`${failed} verificação(ões) falharam. A cópia foi apagada.`);
}

console.log('\nCópia de teste gerada em: ' + OUT);
console.log('Apps Script de teste: ' + testUrl.replace(/\/s\/([A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/, '/s/$1…'));
console.log('Próximo passo: node local-preview/serve.js');
