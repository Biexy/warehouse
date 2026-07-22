import fs from 'node:fs';
import assert from 'node:assert/strict';

const index = fs.readFileSync('Index.html', 'utf8');
const app = fs.readFileSync('App.html', 'utf8');

assert.equal(index.includes('إصدار 2.5 الفني'), false, 'version badge must stay removed');
assert.equal(index.includes('.overflow-x-auto > table { min-width: max-content; }'), false, 'global table overflow rule must stay removed');
assert.match(index, /Noto\+Kufi\+Arabic/);
assert.match(index, /class="login-shell"/);
assert.match(index, /إدارة دقيقة للمخزون وحركة المواد/);
assert.match(index, /سجل الأصناف والأرصدة/);
assert.match(index, /سجل الحركات والتدقيق/);
assert.match(index, /id="ownerSummaryList"/);
assert.match(app, /renderOwnerSummary\(dashboard\.ownerSummary \|\| \[\]\)/);
assert.match(app, /dashboard\.stockLevelSeries/, 'dashboard chart must use the server stock-level series');
assert.match(app, /SESSION_INVALIDATED[\s\S]*AUTH_REQUIRED[\s\S]*clearSession\(true\)/, 'all session failures must return the user to login');
assert.match(app, /function resetUserFormState[\s\S]*userNameInput'\)\.disabled = false/, 'editing a user must not leave account creation disabled');
assert.match(index, /id="itemEditModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(index, /id="editItemCode"[^>]*disabled/);
assert.match(index, /id="editItemOpening"[^>]*disabled/);
assert.match(index, /حفظ تعديلات الصنف/);

const editItemBody = app.match(/function editItem\(id\) \{([\s\S]*?)\n\s*\}\n\s*async function handleItemEditSubmit/);
assert.ok(editItemBody, 'editItem modal flow must exist');
assert.equal(editItemBody[1].includes('scrollIntoView'), false, 'item editing must never scroll the page');
assert.match(editItemBody[1], /itemEditModal/);
assert.match(app, /function closeItemEditModal\(\)/);
assert.match(app, /state\.itemEditReturnFocus/);

assert.match(index, /id="itemPageSizeSelect"/);
assert.match(index, /<option value="10" selected>10<\/option>/);
assert.match(index, /<option value="25">25<\/option>/);
assert.match(index, /<option value="50">50<\/option>/);
assert.match(app, /itemPageSize:\s*10/);
assert.match(app, /function changeItemPageSize\(value\)/);

assert.match(index, /id="movementCorrectionModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(index, /id="correctionReason"[^>]*required/);
assert.match(index, /id="movementCorrectionForm"[^>]*onsubmit="handleMovementCorrectionSubmit\(event\)"/);
const editMovementBody = app.match(/function editTrx\(id\) \{([\s\S]*?)\n\s*\}\n\s*async function handleMovementCorrectionSubmit/);
assert.ok(editMovementBody, 'movement correction modal flow must exist');
assert.equal(editMovementBody[1].includes('scrollIntoView'), false, 'movement correction must never scroll the page');
assert.match(editMovementBody[1], /movementCorrectionModal/);
assert.match(app, /rpc\('correctMovement'/);
assert.match(app, /function closeMovementCorrectionModal\(\)/);
assert.match(app, /state\.movementCorrectionReturnFocus/);

for (const phrase of ['عرض</span>', 'تعديل</span>', 'إيقاف</span>']) assert.ok(app.includes(phrase), `missing labelled action: ${phrase}`);
for (const phrase of ['التقرير الإداري والرقابي لجرد المخزون', 'نسخة معتمدة للاستعراض والتصدير', 'المراجعة والاعتماد الإداري', 'التوقيع والختم']) assert.ok(app.includes(phrase), `formal report missing: ${phrase}`);
assert.match(app, /conflictingCodes/);
assert.match(app, /reportItems\.reduce/);
assert.match(app, /catalogImportCompleted/);
assert.match(index, /responsive-card-table/);
assert.match(index, /@media \(max-width: 640px\)/);

console.log('quick patch UI invariants: ok');
