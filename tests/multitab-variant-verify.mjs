import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';

const variant = 'warehouse-multitab';
const indexPath = path.join(variant, 'Index.html');
const appPath = path.join(variant, 'App.html');

assert.ok(fs.existsSync(indexPath), `${indexPath} is missing`);
assert.ok(fs.existsSync(appPath), `${appPath} is missing`);

const index = fs.readFileSync(indexPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const ui = `${index}\n${app}`;

assert.match(index, /<\?!=\s*include_?\(\s*['"]App['"]\s*\)\s*;?\s*\?>/, 'Index.html does not load the multitab client');
const appScript = app.replace(/^\s*<script\b[^>]*>/i, '').replace(/<\/script>\s*$/i, '');
assert.doesNotThrow(() => new vm.Script(appScript, { filename: appPath }), 'multitab App.html contains invalid JavaScript');

function assertIncludes(source, text, message) {
  assert.ok(source.includes(text), message || `missing ${text}`);
}

function uniqueAttributeValues(source, attribute) {
  const expression = new RegExp(`${attribute}=["']([^"']+)["']`, 'g');
  return [...new Set([...source.matchAll(expression)].map((match) => match[1]))].sort();
}

// The multitab build deliberately has one navigation target and one panel for
// each workflow area. Keeping the values explicit catches accidental fallback
// to the original continuous one-page layout.
const expectedTabs = ['admin', 'dashboard', 'items', 'movements', 'reports'];
assert.deepEqual(
  uniqueAttributeValues(index, 'data-workspace-tab'),
  expectedTabs,
  'multitab navigation must expose exactly dashboard/items/movements/reports/admin'
);
assert.deepEqual(
  uniqueAttributeValues(index, 'data-workspace-panel'),
  expectedTabs,
  'each multitab navigation target must have one matching workspace panel'
);
assertIncludes(app, '[data-workspace-tab]', 'workspace tab controls are not wired in App.html');
assertIncludes(app, '[data-workspace-panel]', 'workspace panels are not wired in App.html');
assert.match(
  app,
  /(?:function\s+\w*(?:Workspace|Tab)\w*\s*\(|addEventListener\s*\(\s*['"]click['"])/,
  'workspace tabs do not have an activation/click handler'
);

// Large-table pagination uses the requested operational sizes. Both the HTML
// choices and the client-side allow-list/default must agree.
const pageSizeSelect = index.match(/<select\b[^>]*\bid=["']itemPageSizeSelect["'][^>]*>[\s\S]*?<\/select>/i);
assert.ok(pageSizeSelect, 'inventory page-size selector is missing');
const pageSizes = [...pageSizeSelect[0].matchAll(/<option\b[^>]*\bvalue=["'](\d+)["']/gi)].map((match) => Number(match[1]));
assert.deepEqual(pageSizes, [20, 50, 100], 'inventory page sizes must be exactly 20, 50, and 100');
assert.match(app, /itemPageSize\s*:\s*20\b/, 'inventory pagination must default to 20 rows');
assert.match(app, /\[\s*20\s*,\s*50\s*,\s*100\s*\][^\n]{0,120}(?:indexOf|includes)\s*\(/, 'client page-size validation must allow only 20/50/100');

// The administration tab itself must be permission-gated, in addition to its
// individual user-management and backup actions.
assertIncludes(app, 'state.permissions.canManageUsers', 'user-management permission gate is missing');
assertIncludes(app, 'state.permissions.canCreateBackups', 'backup permission gate is missing');
assert.match(
  app,
  /(?:canManageUsers[\s\S]{0,700}(?:workspaceTab|data-workspace-tab|admin)|(?:workspaceTab|data-workspace-tab|admin)[\s\S]{0,700}canManageUsers)/,
  'the admin workspace tab is not tied to an administrator permission check'
);
for (const role of ['ADMIN', 'STOREKEEPER', 'AUDITOR']) {
  assertIncludes(ui, role, `${role} role is missing from the multitab UI`);
}

// Unsafe data-wipe controls must not return in either the markup or client.
const destructiveResetPatterns = [
  /\bresetAllRPC\b/,
  /\bresetSystemData\b/,
  /\bfactoryReset\b/i,
  /\bclearAllWarehouseData\b/i,
  /تهيئة\s+وتطهير\s+النظام/u,
  /حذف\s+جميع\s+البيانات/u
];
for (const pattern of destructiveResetPatterns) {
  assert.doesNotMatch(ui, pattern, `destructive reset control found: ${pattern}`);
}

// Corrections and item editing stay modal, preserving scroll position and the
// audit-safe reversal/replacement workflow.
for (const modalId of ['itemEditModal', 'movementCorrectionModal']) {
  assertIncludes(index, `id="${modalId}"`, `${modalId} is missing`);
  assert.match(index, new RegExp(`id=["']${modalId}["'][^>]*[\\s\\S]{0,500}aria-modal=["']true["']`), `${modalId} must be an accessible modal`);
}
for (const hook of [
  'editItem(', 'closeItemEditModal(', 'handleItemEditSubmit(',
  'editTrx(', 'closeMovementCorrectionModal(', 'handleMovementCorrectionSubmit('
]) {
  assertIncludes(app, hook, `modal workflow hook ${hook} is missing`);
}
assertIncludes(app, "rpc('saveItem'", 'item edit modal is not wired to saveItem');
assertIncludes(app, "rpc('correctMovement'", 'movement correction must use the audited correctMovement RPC');

// Refresh must validate the same-tab session before reopening the warehouse;
// expired/revoked sessions and explicit logout must clear it.
for (const id of ['loginView', 'loginForm', 'startupState', 'warehouseApp', 'logoutButton']) {
  assertIncludes(index, `id="${id}"`, `${id} login/session element is missing`);
}
assert.match(app, /SESSION_KEY\s*=\s*['"][^'"]+['"]/, 'same-tab session key is missing');
assertIncludes(app, 'sessionStorage.getItem(SESSION_KEY)', 'refresh does not read the existing same-tab session');
assertIncludes(app, 'sessionStorage.setItem(SESSION_KEY', 'login does not persist the same-tab session');
assertIncludes(app, 'sessionStorage.removeItem(SESSION_KEY)', 'logout/session failure does not clear the same-tab session');
assertIncludes(app, "rpc('getBootstrap', state.token)", 'refresh does not validate the token with the backend');
assertIncludes(app, "rpc('logout', token)", 'logout is not wired to the backend');
assert.match(app, /DOMContentLoaded[\s\S]{0,5000}(?:validateOrLogin|resume\w*Session)\s*\(/, 'session validation is not invoked on page load');
for (const authFailure of ['SESSION_EXPIRED', 'INVALID_SESSION', 'SESSION_INVALIDATED', 'AUTH_REQUIRED']) {
  assertIncludes(app, authFailure, `${authFailure} does not force a return to login`);
}
assert.match(index, /login-help-button[^>]*onclick="[^"]*passwordHelpModal/, 'multitab reset-password link must have a direct modal fallback');
assert.match(app, /function openPasswordHelp\(\)\{var modal=el\('passwordHelpModal'\);if\(modal\.parentNode!==document\.body\)document\.body\.appendChild\(modal\)/, 'multitab password-help modal must escape the hidden warehouse app before opening');
assertIncludes(index, 'workspace-nav-heading', 'desktop side-navigation heading is missing');
assert.match(index, /\.workspace-tabs-shell\s*\{[^}]*position:\s*fixed[^}]*width:\s*15rem/s, 'desktop navigation must be a fixed side rail');
assertIncludes(index, 'class="app-footer', 'professional multitab footer is missing');
assert.match(index, /id="usersModal"[\s\S]{0,600}max-w-5xl/, 'user management must use the expanded responsive layout');
assertIncludes(app, 'copyTemporaryPassword', 'temporary-password copy action is missing');
assertIncludes(app, 'updateWorkspaceNavigationOrientation', 'responsive navigation orientation is not synchronized');

console.log('warehouse-multitab UI: five tabs, pagination, permissions, modals, and session flow verified');
