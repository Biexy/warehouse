import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(testsDir);
const port = Number(process.env.PREVIEW_PORT || 4173);

function read(fileName) {
  return fs.readFileSync(path.join(projectDir, fileName), 'utf8');
}

function renderIndex(useMock) {
  return read('Index.html')
    .replace("<?!= include_('Styles'); ?>", read('Styles.html'))
    .replace("<?!= include_('App'); ?>", `${useMock ? '<script src="/mock-google.js"></script>' : ''}${read('App.html')}`);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/mock-google.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    response.end(fs.readFileSync(path.join(testsDir, 'mock-google.js'), 'utf8'));
    return;
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(renderIndex(url.searchParams.get('mock') === '1'));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Warehouse preview: http://127.0.0.1:${port}/?mock=1`);
});

