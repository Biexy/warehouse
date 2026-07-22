import fs from 'node:fs';

function WarehouseError_(code, message, details) {
  this.name = 'WarehouseError';
  this.code = code;
  this.message = message;
  this.details = details;
}

const repositorySource = fs.readFileSync('warehouse-one-tab/Repository.gs', 'utf8');
const api = new Function('WarehouseError_', `${repositorySource}\nreturn { schema: REPOSITORY_SCHEMA_, migrate: migrateSchemaSheetNames_, assertNoConflicts: assertNoSchemaSheetNameConflicts_ };`)(WarehouseError_);

function workbook(names) {
  const sheets = new Map();
  for (const name of names) {
    const sheet = {
      currentName: name,
      getName() { return this.currentName; },
      setName(next) {
        if (sheets.has(next)) throw new Error(`duplicate sheet: ${next}`);
        sheets.delete(this.currentName);
        this.currentName = next;
        sheets.set(next, this);
      }
    };
    sheets.set(name, sheet);
  }
  return { getSheetByName(name) { return sheets.get(name) || null; }, names() { return [...sheets.keys()].sort(); } };
}

const canonical = workbook(['Users', 'Items', 'Logs']);
api.migrate(canonical);
if (canonical.names().join('|') !== 'Items|Logs|Users') throw new Error('Canonical sheet names changed unexpectedly.');

const legacy = workbook(['المستخدمون', 'الأصناف', 'الحركات']);
api.migrate(legacy);
if (legacy.names().join('|') !== 'Items|Logs|Users') throw new Error('Legacy Arabic sheets were not migrated atomically to the supplied contract names.');

const conflict = workbook(['Users', 'المستخدمون', 'Items', 'Logs']);
let conflictCode = '';
try { api.migrate(conflict); } catch (error) { conflictCode = error.code; }
if (conflictCode !== 'SCHEMA_SHEET_NAME_CONFLICT') throw new Error('Canonical/legacy split datasets must fail closed.');
if (!conflict.names().includes('Users') || !conflict.names().includes('المستخدمون')) throw new Error('Conflict detection mutated sheets before failing.');

console.log('schema sheet names: canonical names preserved');
console.log('schema sheet names: Arabic legacy set migrates to Users/Items/Logs');
console.log('schema sheet names: mixed naming sets fail closed before mutation');
