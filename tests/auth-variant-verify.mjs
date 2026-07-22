import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const variants = ['warehouse-one-tab', 'warehouse-multitab'];
const authRuntimeFiles = ['Code.gs', 'Repository.gs', 'Auth.gs', 'Inventory.gs', 'BulkImport.gs'];
const referenceVariant = variants[0];

function read(variant, file) {
  return fs.readFileSync(path.join(variant, file), 'utf8');
}

function requireText(source, text, message) {
  assert.ok(source.includes(text), message || `missing ${text}`);
}

for (const file of authRuntimeFiles) {
  const reference = fs.readFileSync(path.join(referenceVariant, file));
  for (const variant of variants.slice(1)) {
    assert.deepEqual(
      fs.readFileSync(path.join(variant, file)),
      reference,
      `${variant}/${file} does not inherit the backend authentication runtime exercised by auth-verify.mjs`
    );
  }
}

for (const variant of variants) {
  const index = read(variant, 'Index.html');
  const app = read(variant, 'App.html');
  const script = app.replace(/^\s*<script\b[^>]*>/i, '').replace(/<\/script>\s*$/i, '');
  assert.doesNotThrow(() => new vm.Script(script, { filename: `${variant}/App.html` }), `${variant} client contains invalid JavaScript`);

  for (const id of [
    'loginView', 'loginForm', 'loginUsername', 'loginPassword', 'loginSubmit',
    'startupState', 'warehouseApp', 'logoutButton', 'loginAuthModal',
    'passwordChangeForm', 'authPasswordInput', 'newPasswordInput',
    'confirmPasswordInput', 'passwordChangeSubmit', 'usersModal',
    'temporaryPasswordBox', 'passwordHelpModal'
  ]) {
    assert.match(index, new RegExp(`\\bid=["']${id}["']`), `${variant} is missing auth UI element ${id}`);
  }

  for (const rpc of ['authenticate', 'getBootstrap', 'changeMyPassword', 'logout', 'resetUserPassword']) {
    requireText(app, `rpc('${rpc}'`, `${variant} is not wired to ${rpc}`);
  }

  assert.match(app, /SESSION_KEY\s*=\s*['"][^'"]+['"]/, `${variant} has no isolated session key`);
  requireText(app, 'sessionStorage.getItem(SESSION_KEY)', `${variant} refresh does not read the same-tab session`);
  requireText(app, 'sessionStorage.setItem(SESSION_KEY', `${variant} login does not retain the same-tab session`);
  requireText(app, 'sessionStorage.removeItem(SESSION_KEY)', `${variant} cannot clear the same-tab session`);
  assert.doesNotMatch(app, /localStorage\b/, `${variant} must not persist authentication across tabs`);
  assert.doesNotMatch(app, /ACTIVE_USER/, `${variant} must not use a global active-user identity`);

  assert.match(
    app,
    /SESSION_ERROR_CODES_\s*=\s*\['SESSION_EXPIRED',\s*'INVALID_SESSION',\s*'SESSION_INVALIDATED',\s*'AUTH_REQUIRED'\]/,
    `${variant} does not return expired/revoked sessions to login`
  );
  assert.match(app, /if \(isSessionError_\(error\) && state\.token\) clearSession\(true, error\)/, `${variant} does not clear an invalid server session`);
  assert.match(app, /function validateOrLogin\([\s\S]{0,500}sessionStorage\.getItem\(SESSION_KEY\)[\s\S]{0,500}runBootstrap_\(\)/, `${variant} does not validate a restored session`);
  assert.match(app, /function bootstrap\([\s\S]{0,300}rpc\('getBootstrap',\s*state\.token\)/, `${variant} bootstrap does not validate the token server-side`);
  assert.match(app, /passwordChangeRequired[\s\S]{0,180}showPasswordChangeModal_\(true\)/, `${variant} does not enforce the mandatory first-login password change`);
  assert.match(app, /rpc\('changeMyPassword'[\s\S]{0,500}clearSession\(true\)/, `${variant} does not require relogin after a password change`);
  assert.match(app, /function handleLogout\([\s\S]{0,220}clearSession\(true\)[\s\S]{0,220}rpc\('logout'/, `${variant} logout is not locally and remotely invalidated`);
  assert.match(app, /function resetUserAccess\([\s\S]{0,500}rpc\('resetUserPassword'/, `${variant} administrator cannot reset a target user`);
  requireText(app, 'function showBootstrapFailure_', `${variant} has no post-login bootstrap failure state`);
  requireText(app, 'function retryBootstrap()', `${variant} has no recoverable bootstrap retry action`);
}

console.log('auth variants: identical tested backend plus complete login/password/session/reset UI hooks');
