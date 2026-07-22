import fs from 'node:fs';

const backendFiles = ['Code.gs', 'Auth.gs', 'Repository.gs', 'Inventory.gs', 'CatalogImport.gs', 'Export.gs'];
const backend = backendFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const index = fs.readFileSync('Index.html', 'utf8');
const app = fs.readFileSync('App.html', 'utf8');

new Function(backend);
JSON.parse(fs.readFileSync('appsscript.json', 'utf8'));
const scriptMatch = app.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('App.html script block is missing.');
new Function(scriptMatch[1]);

const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, position) => ids.indexOf(id) !== position))];
if (duplicateIds.length) throw new Error(`Duplicate HTML IDs: ${duplicateIds.join(', ')}`);

const backendFunctions = new Set([...backend.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].map((match) => match[1]));
const rpcNames = [...new Set([...scriptMatch[1].matchAll(/rpc\('([^']+)'/g)].map((match) => match[1]))];
const missingRpcFunctions = rpcNames.filter((name) => !backendFunctions.has(name));
if (missingRpcFunctions.length) throw new Error(`Missing backend RPC functions: ${missingRpcFunctions.join(', ')}`);

const orderedWorkflow = [
  'loginView', 'warehouseApp', 'kpiTotalItems', 'stockLevelChart', 'ownerSummaryList',
  'inventoryTableBody', 'trxForm', 'newItemForm', 'auditLogsTableBody', 'itemDetailModal',
  'itemEditModal', 'movementCorrectionModal', 'usersModal', 'reportPreviewModal'
];
let lastPosition = -1;
for (const id of orderedWorkflow) {
  const position = index.indexOf(`id="${id}"`);
  if (position < 0) throw new Error(`Missing supplied-workflow element: ${id}`);
  if (position <= lastPosition) throw new Error(`Supplied workflow ordering changed near: ${id}`);
  lastPosition = position;
}

const professionalWorkflowPhrases = [
  'نظام إدارة المخزون',
  'سجل الأصناف والأرصدة',
  'تسجيل حركة مخزنية',
  'إضافة صنف جديد',
  'سجل الحركات والتدقيق',
  'معاينة التقرير الإداري'
];
for (const phrase of professionalWorkflowPhrases) if (!index.includes(phrase)) throw new Error(`Professional workflow wording missing: ${phrase}`);

const requiredAdditions = [
  'loginForm', 'logoutButton', 'trxCurrentBalance', 'trxProjectedBalance', 'newOwner',
  'itemOwnerFilter', 'itemsPagination', 'movementsPagination', 'catalogImportButton',
  'backupModal', 'temporaryPasswordBox', 'itemEditForm', 'editItemCode', 'itemEditSubmitButton',
  'itemPageSizeSelect', 'movementCorrectionForm', 'correctionReason', 'movementCorrectionSubmitButton'
];
for (const id of requiredAdditions) if (!ids.includes(id)) throw new Error(`Compatibility addition missing: ${id}`);

if (/resetSystemData|resetAllRPC|تهيئة وتطهير النظام/.test(index + app + backend)) {
  throw new Error('Destructive full-reset UI/API must not exist.');
}
if (/defaultItems|defaultUsers|password:\s*["']123/.test(index + app)) throw new Error('Automatic demo data or plaintext demo passwords returned.');
if (/ACTIVE_USER/.test(backend + app)) throw new Error('A global ACTIVE_USER property must never identify a session.');
if (index.includes('إصدار 2.5 الفني')) throw new Error('The removed version badge returned.');
if (!app.includes('dashboard.ownerSummary') || !app.includes('renderOwnerSummary')) throw new Error('Owner summary panel wiring is missing.');
if (!app.includes('catalogImportCompleted') || !backend.includes('catalogImportCompleted')) throw new Error('Persistent catalog-completion state is missing.');
for (const phrase of ['التقرير الإداري والرقابي لجرد المخزون', 'نسخة معتمدة للاستعراض والتصدير', 'التوقيع والختم']) {
  if (!app.includes(phrase)) throw new Error(`Formal report content missing: ${phrase}`);
}
if (!/sessionStorage\.setItem\(SESSION_KEY/.test(app) || /localStorage/.test(app)) throw new Error('Same-tab session persistence is not enforced.');
if (!/PASSWORD_MIN_LENGTH:\s*6/.test(backend)) throw new Error('Password minimum must remain six characters.');
if (!backendFunctions.has('correctMovement') || !backendFunctions.has('reverseMovement')) throw new Error('Audited correction/reversal APIs are missing.');
for (const fn of ['getInventoryReport', 'getMovementExport', 'createBackup', 'importProvidedCatalog']) {
  if (!backendFunctions.has(fn)) throw new Error(`Required backend capability missing: ${fn}`);
}
for (const role of ['ADMIN', 'STOREKEEPER', 'AUDITOR']) if (!backend.includes(`'${role}'`)) throw new Error(`Required role is missing: ${role}`);

const csvCellMatch = scriptMatch[1].match(/function csvCell\(value\)\s*\{([\s\S]*?)\n\s*\}/);
if (!csvCellMatch) throw new Error('csvCell() was not found.');
const csvCell = new Function(`return function csvCell(value) {${csvCellMatch[1]}\n}`)();
if (csvCell(-5) !== '"-5"') throw new Error('Negative numeric CSV values must remain numeric.');
if (csvCell('=SUM(A1:A2)') !== '"\'=SUM(A1:A2)"') throw new Error('CSV formula-injection protection is missing.');

console.log(`backend syntax: ok (${backendFunctions.size} functions)`);
console.log(`frontend syntax and IDs: ok (${ids.length} unique IDs)`);
console.log(`secure RPC mappings: ok (${rpcNames.length})`);
console.log('supplied workflow order and professional Arabic wording: preserved');
console.log('auth, roles, owner, pagination, reports, and no-reset invariants: ok');
