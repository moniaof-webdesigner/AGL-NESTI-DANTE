'use strict';

/**
 * Servidor estático local da cópia de teste (tests/.local-site).
 * Escuta APENAS em 127.0.0.1 (não acessível por outros computadores) e
 * repete a CSP como cabeçalho HTTP.
 *
 * Uso: node local-preview/serve.js [porta]   (padrão 8080)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '.local-site');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('Cópia de teste não encontrada. Rode antes: node local-preview/build.js "<URL de teste>"');
  process.exit(1);
}

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

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Servidor de TESTE em http://127.0.0.1:' + PORT + '/');
  console.log('Pressione Ctrl+C para encerrar.');
});
