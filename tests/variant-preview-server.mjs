import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(testsDir);
const variants = [
  { name: 'One Tab', folder: 'warehouse-one-tab', port: Number(process.env.ONE_TAB_PORT || 4174) },
  { name: 'Multitab', folder: 'warehouse-multitab', port: Number(process.env.MULTITAB_PORT || 4175) }
];

function read(folder, fileName) {
  return fs.readFileSync(path.join(projectDir, folder, fileName), 'utf8');
}

function renderIndex(folder, useMock) {
  return read(folder, 'Index.html')
    .replace("<?!= include_('App'); ?>", `${useMock ? '<script src="/mock-google.js"></script>' : ''}${read(folder, 'App.html')}`);
}

function createVariantServer(variant) {
  return http.createServer((request, response) => {
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
    response.end(renderIndex(variant.folder, url.searchParams.get('mock') === '1'));
  }).listen(variant.port, '127.0.0.1', () => {
    console.log(`${variant.name}: http://127.0.0.1:${variant.port}/?mock=1`);
  });
}

variants.forEach(createVariantServer);
