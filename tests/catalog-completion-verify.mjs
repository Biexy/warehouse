import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const propertyStore = new Map();
const context = vm.createContext({
  console,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) { return propertyStore.has(key) ? propertyStore.get(key) : null; },
        setProperty(key, value) { propertyStore.set(key, String(value)); }
      };
    }
  },
  Utilities: { getUuid() { return 'catalog-completion-test'; } }
});

const backend = ['Code.gs', 'Repository.gs', 'Inventory.gs', 'CatalogImport.gs']
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
vm.runInContext(backend, context, { filename: 'catalog-completion-backend.gs' });

const catalog = context.validateProvidedCatalog_();
const matchingItems = catalog.map((entry, index) => ({
  id: `ITM-${index + 1}`,
  code: entry.code,
  name: entry.name,
  owner: entry.owner,
  unit: 'قطعة',
  openingQuantity: entry.openingQuantity,
  reorderLevel: 0,
  active: true
}));

context.allItemRecords_ = () => matchingItems;
context.getSettingValue_ = () => null;

assert.equal(context.catalogImportCompleted_(), true, 'legacy matching catalog must be detected without a marker');
assert.equal(propertyStore.size, 0, 'read-time legacy detection must not mutate Script Properties');
assert.equal(context.publicSettings_().catalogImportCompleted, true, 'bootstrap settings must expose completion');

context.allItemRecords_ = () => matchingItems.slice(0, 75);
assert.equal(context.catalogImportCompleted_(), false, 'partial catalogs must remain incomplete');

const conflictingItems = matchingItems.map((item) => ({ ...item }));
conflictingItems[10].owner = 'مالك مختلف';
context.allItemRecords_ = () => conflictingItems;
assert.equal(context.catalogImportCompleted_(), false, 'conflicting catalogs must remain incomplete');

propertyStore.set(context.PROVIDED_CATALOG_COMPLETED_PROPERTY_, 'true');
context.allItemRecords_ = () => [];
assert.equal(context.catalogImportCompleted_(), true, 'a completed import marker must be durable');

propertyStore.clear();
const stored = [];
context.requireSession_ = () => ({ user: { id: 'USR-1', username: 'admin', displayName: 'مدير', role: 'ADMIN' } });
context.ensureRepositorySchemaCurrent_ = () => false;
context.withScriptLock_ = (callable) => callable();
context.schemaMetadata_ = () => ({});
context.preflightAuthAudit_ = () => {};
context.allItemRecords_ = () => stored;
context.appendItemRecords_ = (records) => { stored.push(...records); return records; };
context.appendCommittedInventoryAudit_ = () => '';

const imported = context.importProvidedCatalog('token');
assert.equal(imported.ok, true);
assert.equal(imported.data.completed, true, 'a conflict-free import must return completed true');
assert.equal(propertyStore.get(context.PROVIDED_CATALOG_COMPLETED_PROPERTY_), 'true', 'successful import must persist completion');

const repeated = context.importProvidedCatalog('token');
assert.equal(repeated.ok, true);
assert.equal(repeated.data.created, 0);
assert.equal(repeated.data.completed, true, 'idempotent re-import must remain completed');

console.log('catalog completion: legacy detection, partial/conflict handling, persistence, and public settings passed');
