import fs from 'node:fs';
import vm from 'node:vm';

const storage = new Map();
const windowObject = {
  location: { search: '?catalogRegression=1&role=ADMIN' },
  sessionStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, String(value)); } },
  setTimeout(callback) { callback(); }
};
const context = vm.createContext({ window: windowObject, URLSearchParams, console, Intl, Date, Math, Object, Array, String, Number, Boolean, Map, Set, Error });
vm.runInContext(fs.readFileSync('tests/mock-google.js', 'utf8'), context);
const { handle, items, movements } = windowObject.__warehouseMock;
const call = (method, payload = {}) => handle(method, ['token', payload]);

if (items.length !== 0) throw new Error('Regression fixture must start without supplied catalog rows.');
const firstImport = call('importProvidedCatalog');
if (firstImport.catalogTotal !== 76 || firstImport.created !== 76 || firstImport.skipped !== 0) throw new Error('First import must create all 76 catalog rows.');
if (new Set(items.map((item) => item.code)).size !== 76) throw new Error('Imported catalog contains duplicate codes.');

const pageOne = call('listItems', { query: '', owner: '', status: 'ALL', page: 1, pageSize: 20 });
if (pageOne.total !== 76 || pageOne.items.length !== 20 || pageOne.items[0].code !== 'ITEM001') throw new Error('Normalized page 1 did not expose imported rows and full total.');

const item001 = call('listItems', { query: 'ITEM001', status: 'ACTIVE', page: 1, pageSize: 50 }).items[0];
const item076 = call('listItems', { query: 'ITEM076', status: 'ACTIVE', page: 1, pageSize: 50 }).items[0];
if (!item001 || !item076) throw new Error('Server-backed search did not retrieve ITEM001 and ITEM076 beyond the bootstrap cap.');

const item001Before = item001.currentQuantity;
call('saveMovement', { clientRequestId: 'REG-IN-001', itemId: item001.id, type: 'IN', quantity: 3, party: 'اختبار', documentDate: '2026-07-22', reference: 'REG-IN', notes: '' });
if (item001.currentQuantity !== item001Before + 3) throw new Error('Valid incoming movement was not persisted for ITEM001.');

const item076Before = item076.currentQuantity;
call('saveMovement', { clientRequestId: 'REG-OUT-076', itemId: item076.id, type: 'OUT', quantity: 1, party: 'اختبار', documentDate: '2026-07-22', reference: 'REG-OUT', notes: '' });
if (item076.currentQuantity !== item076Before - 1) throw new Error('Valid outgoing movement was not persisted for ITEM076.');

const refreshed076 = call('listItems', { query: 'ITEM076', status: 'ACTIVE', page: 1, pageSize: 50 }).items[0];
const refreshedMovements = call('listMovements', { page: 1, pageSize: 25 });
if (refreshed076.currentQuantity !== item076Before - 1 || refreshedMovements.total !== 2 || movements.length !== 2) throw new Error('Refresh did not retain imported rows and movements.');

const balancesBeforeReimport = new Map(items.map((item) => [item.code, item.currentQuantity]));
const secondImport = call('importProvidedCatalog');
if (secondImport.created !== 0 || secondImport.skipped !== 76 || items.length !== 76) throw new Error('Second import must be idempotent.');
for (const item of items) if (balancesBeforeReimport.get(item.code) !== item.currentQuantity) throw new Error(`Re-import changed balance for ${item.code}.`);

const app = fs.readFileSync('App.html', 'utf8');
const importBlock = app.match(/async function importCatalog\(\)\s*\{([\s\S]*?)\n\s*\}\n\s*async function openItemDetailModal/);
if (!importBlock) throw new Error('Import UI workflow was not found.');
for (const required of ["state.itemPage = 1", "el('itemSearchInput').value = ''", "el('itemOwnerFilter').value = ''", "el('itemStatusFilter').value = 'ALL'", 'await loadItems()', 'await searchCatalog()']) {
  if (!importBlock[1].includes(required)) throw new Error(`Post-import UI refresh step missing: ${required}`);
}

console.log('catalog UI regression: 76 rows imported, page 1 visible, total 76');
console.log('catalog UI regression: ITEM001/ITEM076 server search and IN/OUT posting passed');
console.log('catalog UI regression: refresh persistence and idempotent re-import passed');
