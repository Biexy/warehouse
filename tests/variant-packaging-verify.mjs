import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const variants = ['warehouse-one-tab', 'warehouse-multitab'];
const backendFiles = [
  'appsscript.json', 'Code.gs', 'Auth.gs', 'Repository.gs', 'Inventory.gs',
  'BulkImport.gs', 'Export.gs'
];
const uiFiles = ['Index.html', 'App.html'];
const runtimeFiles = [...backendFiles, ...uiFiles];

for (const variant of variants) {
  assert.ok(fs.existsSync(variant), `${variant} package is missing`);

  for (const file of runtimeFiles) {
    assert.ok(fs.existsSync(path.join(variant, file)), `${variant}/${file} is missing`);
  }

  const claspIgnorePath = path.join(variant, '.claspignore');
  assert.ok(fs.existsSync(claspIgnorePath), `${variant}/.claspignore is missing`);
  const claspIgnore = fs.readFileSync(claspIgnorePath, 'utf8');
  for (const file of runtimeFiles) {
    assert.ok(claspIgnore.includes(`!${file}`), `${variant}/.claspignore does not allow ${file}`);
  }
  assert.ok(fs.existsSync(path.join(variant, 'README.md')), `${variant} setup guide is missing`);
}

for (const file of backendFiles) {
  const oneTabSource = fs.readFileSync(path.join('warehouse-one-tab', file));
  const multitabSource = fs.readFileSync(path.join('warehouse-multitab', file));
  assert.deepEqual(multitabSource, oneTabSource, `backend runtime drift: warehouse-multitab/${file} differs from warehouse-one-tab/${file}`);
}

console.log('warehouse variants: complete; one-tab synchronized; backend runtimes identical');
