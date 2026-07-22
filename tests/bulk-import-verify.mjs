import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class WarehouseError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

const stored = [{
  id:'ITM-1', code:'EXISTING-001', name:'Existing item', owner:'سلطة المياه',
  unit:'قطعة', openingQuantity:5, reorderLevel:1, active:true
}];
let id = 1;
const context = vm.createContext({
  console,
  MAX_QUANTITY_: 1000000000,
  WarehouseError_: WarehouseError,
  apiResult_(callback) {
    try { return {ok:true, data:callback()}; }
    catch (error) { return {ok:false, error:{code:error.code || 'INTERNAL_ERROR', message:error.message, details:error.details}}; }
  },
  requireSession_(token, roles) {
    if (token !== 'admin' || !roles.includes('ADMIN')) throw new WarehouseError('FORBIDDEN', 'ممنوع');
    return {user:{username:'admin', displayName:'مدير النظام', role:'ADMIN'}};
  },
  ensureRepositorySchemaCurrent_() {},
  withScriptLock_(callback) { return callback(); },
  preflightInventoryMutation_() {},
  allItemRecords_() { return stored.map((row) => ({...row})); },
  appendItemRecords_(rows) { stored.push(...rows.map((row) => ({...row}))); },
  appendCommittedInventoryAudit_() { return ''; },
  newId_() { id += 1; return `ITM-${id}`; },
  normalizeItemCode_(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!code) throw new WarehouseError('VALIDATION_ERROR', 'كود الصنف مطلوب.');
    return code;
  },
  requireObject_(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WarehouseError('VALIDATION_ERROR', 'الصف غير صالح.');
    return value;
  },
  requireText_(value, label, max) {
    const text = String(value || '').trim();
    if (!text) throw new WarehouseError('VALIDATION_ERROR', `${label} مطلوب.`);
    if (text.length > max) throw new WarehouseError('VALIDATION_ERROR', `${label} طويل.`);
    return text;
  },
  requireFiniteNumber_(value, label, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw new WarehouseError('VALIDATION_ERROR', `${label} غير صالح.`);
    return number;
  },
  roundQuantity_(value) { return Math.round(Number(value) * 1e6) / 1e6; }
});
vm.runInContext(fs.readFileSync('warehouse-one-tab/BulkImport.gs', 'utf8'), context);

const row = (overrides = {}) => ({
  code:'NEW-001', name:'New item', owner:'مصلحة المياه', unit:'قطعة',
  openingQuantity:12, reorderLevel:3, ...overrides
});
const ok = (result) => { assert.equal(result.ok, true, result.error?.message); return result.data; };

const beforePreview = stored.length;
const preview = ok(context.previewItemFileImport('admin', [row()]));
assert.equal(stored.length, beforePreview, 'preview must not write to Items');
assert.equal(preview.newItems, 1);
assert.equal(preview.canCommit, true);

const committed = ok(context.commitItemFileImport('admin', [row()]));
assert.equal(committed.created, 1);
assert.equal(stored.at(-1).code, 'NEW-001');

const existing = ok(context.previewItemFileImport('admin', [row()]));
assert.equal(existing.existing, 1);
assert.equal(existing.canCommit, false);

const conflict = ok(context.previewItemFileImport('admin', [row({name:'Changed name'})]));
assert.equal(conflict.conflicts, 1);
assert.equal(conflict.canCommit, false);
assert.equal(context.commitItemFileImport('admin', [row({name:'Changed name'})]).error.code, 'ITEM_IMPORT_NOT_READY');

const duplicate = ok(context.previewItemFileImport('admin', [row({code:'DUP-1',name:'Duplicate A'}), row({code:'DUP-1',name:'Duplicate B'})]));
assert.equal(duplicate.invalid, 1);
assert.equal(duplicate.canCommit, false);

const negative = ok(context.previewItemFileImport('admin', [row({code:'NEG-1',openingQuantity:-1})]));
assert.equal(negative.invalid, 1);
assert.equal(context.previewItemFileImport('auditor', [row()]).error.code, 'FORBIDDEN');
assert.equal(context.previewItemFileImport('admin', Array.from({length:501}, (_, index) => row({code:`MAX-${index}`,name:`Item ${index}`}))).error.code, 'ITEM_IMPORT_TOO_LARGE');

function parseCsv(source) {
  const rows=[]; let row=[]; let cell=''; let quoted=false;
  for (let index=0; index<source.length; index+=1) {
    const char=source[index], next=source[index+1];
    if (char==='"' && quoted && next==='"') { cell+='"'; index+=1; }
    else if (char==='"') quoted=!quoted;
    else if (char===',' && !quoted) { row.push(cell); cell=''; }
    else if ((char==='\n' || char==='\r') && !quoted) {
      if (char==='\r' && next==='\n') index+=1;
      row.push(cell); rows.push(row); row=[]; cell='';
    } else cell+=char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csv = parseCsv(fs.readFileSync('sample-data/catalog-76.csv', 'utf8').replace(/^\uFEFF/, ''));
assert.deepEqual(csv[0], ['الكود','الاسم','المالك','وحدة القياس','الرصيد الافتتاحي','حد إعادة الطلب']);
assert.equal(csv.length, 77, 'sample CSV must contain one header plus 76 items');
assert.equal(csv[1][0], 'ITEM001');
assert.equal(csv[76][0], 'ITEM076');
assert.match(csv[1][1], /14" dia/);
assert.match(csv[62][1], /"item 61"/);

console.log('bulk item import: preview, validation, authorization, commit, limits, and 76-row CSV passed');
