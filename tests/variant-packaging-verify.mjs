import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const variant = 'warehouse-one-tab';
const runtimeFiles = [
  'appsscript.json', 'Code.gs', 'Auth.gs', 'Repository.gs', 'Inventory.gs',
  'CatalogImport.gs', 'Export.gs', 'Index.html', 'App.html'
];

for (const file of runtimeFiles) {
  const rootSource = fs.readFileSync(file);
  const packagedSource = fs.readFileSync(path.join(variant, file));
  assert.deepEqual(packagedSource, rootSource, `${variant}/${file} is not synchronized with the verified source`);
}

const claspIgnore = fs.readFileSync(path.join(variant, '.claspignore'), 'utf8');
for (const file of runtimeFiles) assert.ok(claspIgnore.includes(`!${file}`), `.claspignore does not allow ${file}`);
assert.ok(fs.existsSync(path.join(variant, 'README.md')), 'variant setup guide is missing');

console.log('warehouse-one-tab package: synchronized and complete');
