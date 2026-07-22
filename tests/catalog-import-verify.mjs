import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let uuidCounter = 0;
const context = vm.createContext({
  console,
  Utilities: {
    getUuid() { uuidCounter += 1; return `test-${uuidCounter}`; }
  }
});

const backend = ['Code.gs', 'Repository.gs', 'Inventory.gs', 'CatalogImport.gs']
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
vm.runInContext(backend, context, { filename: 'catalog-import-backend.gs' });

const catalog = context.validateProvidedCatalog_();
assert.equal(catalog.length, 76);
assert.equal(new Set(catalog.map((row) => row.code)).size, 76);
assert.equal(new Set(catalog.map((row) => row.name.trim().replace(/\s+/g, ' ').toLowerCase())).size, 76);
assert.deepEqual(
  Array.from(catalog, (row) => row.code),
  Array.from({ length: 76 }, (_unused, index) => `ITEM${String(index + 1).padStart(3, '0')}`)
);
assert.deepEqual([...new Set(catalog.map((row) => row.owner))].sort(), ['سلطة المياه', 'مصلحة المياه'].sort());
assert.ok(catalog.every((row) => Number.isFinite(row.openingQuantity) && row.openingQuantity >= 0));

const existingItem = {
  id: 'ITM-EXISTING',
  code: 'ITEM010',
  name: 'Existing protected item',
  owner: 'مالك سابق',
  unit: 'صندوق',
  openingQuantity: 999,
  reorderLevel: 12,
  active: true
};
const existingNameUnderLegacyCode = {
  id: 'ITM-LEGACY-NAME',
  code: 'LEGACY-008',
  name: catalog[7].name,
  owner: catalog[7].owner,
  unit: 'قطعة',
  openingQuantity: catalog[7].openingQuantity,
  reorderLevel: 0,
  active: true
};
const stored = [existingItem, existingNameUnderLegacyCode];
const audits = [];

context.requireSession_ = (_token, roles) => {
  assert.deepEqual(Array.from(roles || []), ['ADMIN']);
  return { user: { id: 'USR-1', username: 'admin', displayName: 'مدير النظام', role: 'ADMIN' } };
};
context.ensureRepositorySchemaCurrent_ = () => false;
context.withScriptLock_ = (callable) => callable();
context.schemaMetadata_ = () => ({});
context.preflightAuthAudit_ = () => {};
context.allItemRecords_ = () => stored;
context.appendItemRecords_ = (records) => {
  records.forEach((record) => stored.push(record));
  return records;
};
context.appendCommittedInventoryAudit_ = (entry) => { audits.push(entry); return ''; };

const first = context.importProvidedCatalog('token');
assert.equal(first.ok, true);
assert.equal(first.data.catalogTotal, 76);
assert.equal(first.data.created, 74);
assert.equal(first.data.skipped, 2);
assert.deepEqual(Array.from(first.data.skippedCodes), ['ITEM008', 'ITEM010']);
assert.deepEqual(Array.from(first.data.conflictingCodes), ['ITEM008', 'ITEM010']);
assert.equal(stored.length, 76);
assert.equal(existingItem.name, 'Existing protected item');
assert.equal(existingItem.owner, 'مالك سابق');
assert.equal(existingItem.openingQuantity, 999);
assert.equal(stored.filter((row) => row.name === catalog[7].name).length, 1, 'same normalized name must not be duplicated under a new code');
assert.equal(audits.length, 1);
assert.ok(stored.filter((row) => row.code !== 'ITEM010').every((row) => row.unit === 'قطعة' && row.reorderLevel === 0));

const second = context.importProvidedCatalog('token');
assert.equal(second.ok, true);
assert.equal(second.data.created, 0);
assert.equal(second.data.skipped, 76);
assert.equal(stored.length, 76);
assert.equal(audits.length, 1, 'No empty import audit should be appended');

context.requireSession_ = () => { throw new context.WarehouseError_('FORBIDDEN', 'ممنوع'); };
const forbidden = context.importProvidedCatalog('token');
assert.equal(forbidden.ok, false);
assert.equal(forbidden.error.code, 'FORBIDDEN');

console.log('provided catalog: 76 unique sequential codes and 76 unique names');
console.log('catalog import: idempotent and preserves existing item rows');
console.log('catalog import authorization: admin-only');
