import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../warehouse-one-tab/', import.meta.url);
const BACKEND_FILES = ['Code.gs', 'Repository.gs', 'Auth.gs', 'Inventory.gs', 'BulkImport.gs'];

function dateKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function signedBytes(buffer) {
  return [...buffer].map((value) => (value > 127 ? value - 256 : value));
}

function bytesBuffer(value) {
  if (Array.isArray(value)) {
    return Buffer.from(value.map((byte) => (byte < 0 ? byte + 256 : byte)));
  }
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value), 'utf8');
}

class MemoryCache {
  constructor() {
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(String(key));
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(String(key));
      return null;
    }
    return entry.value;
  }

  put(key, value, ttlSeconds) {
    this.entries.set(String(key), {
      value: String(value),
      expiresAt: Date.now() + Math.max(1, Number(ttlSeconds) || 1) * 1000
    });
  }

  remove(key) {
    this.entries.delete(String(key));
  }
}

class ScriptProperties {
  constructor() {
    this.values = new Map();
  }

  getProperty(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setProperty(key, value) {
    this.values.set(String(key), String(value));
    return this;
  }

  deleteProperty(key) {
    this.values.delete(String(key));
    return this;
  }
}

function displayValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

class MemoryRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.valueAt(this.row + rowOffset, this.column + columnOffset)
      )
    );
  }

  getDisplayValues() {
    return this.getValues().map((row) => row.map(displayValue));
  }

  setValues(values) {
    assert.equal(values.length, this.rowCount, 'setValues row count');
    values.forEach((row, rowOffset) => {
      assert.equal(row.length, this.columnCount, 'setValues column count');
      row.forEach((value, columnOffset) => {
        this.sheet.setValueAt(this.row + rowOffset, this.column + columnOffset, value);
      });
    });
    return this;
  }

  setValue(value) {
    assert.equal(this.rowCount, 1, 'setValue row count');
    assert.equal(this.columnCount, 1, 'setValue column count');
    this.sheet.setValueAt(this.row, this.column, value);
    return this;
  }

  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setWrap() { return this; }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
}

class MemorySheet {
  constructor(name) {
    this.name = name;
    this.maxRows = 100;
    this.maxColumns = 26;
    this.cells = new Map();
  }

  cellKey(row, column) {
    return `${row}:${column}`;
  }

  valueAt(row, column) {
    return this.cells.get(this.cellKey(row, column)) ?? '';
  }

  setValueAt(row, column, value) {
    this.maxRows = Math.max(this.maxRows, row);
    this.maxColumns = Math.max(this.maxColumns, column);
    const key = this.cellKey(row, column);
    if (value === '' || value === null || value === undefined) this.cells.delete(key);
    else this.cells.set(key, value);
  }

  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }

  getLastRow() {
    let last = 0;
    for (const key of this.cells.keys()) last = Math.max(last, Number(key.split(':')[0]));
    return last;
  }

  getLastColumn() {
    let last = 0;
    for (const key of this.cells.keys()) last = Math.max(last, Number(key.split(':')[1]));
    return last;
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new MemoryRange(this, row, column, rowCount, columnCount);
  }

  insertColumnsAfter(afterPosition, count) {
    this.maxColumns = Math.max(this.maxColumns, Number(afterPosition) + Number(count));
  }

  insertColumnAfter(afterPosition) {
    this.insertColumnsAfter(afterPosition, 1);
  }

  insertRowAfter(afterPosition) {
    this.maxRows = Math.max(this.maxRows, Number(afterPosition) + 1);
  }

  setRightToLeft() { return this; }
  setFrozenRows() { return this; }
  setRowHeight() { return this; }
  setColumnWidth() { return this; }
  hideColumns() { return this; }

  serializedCells() {
    return [...this.cells.values()].map((value) => displayValue(value)).join('\n');
  }
}

class MemorySpreadsheet {
  constructor(id = 'spreadsheet-auth-test') {
    this.id = id;
    this.sheets = new Map();
    this.timeZone = null;
  }

  getId() { return this.id; }
  setSpreadsheetTimeZone(value) { this.timeZone = value; }
  getSheetByName(name) { return this.sheets.get(String(name)) || null; }

  insertSheet(name) {
    const sheet = new MemorySheet(String(name));
    this.sheets.set(String(name), sheet);
    return sheet;
  }

  serializedCells() {
    return [...this.sheets.values()].map((sheet) => sheet.serializedCells()).join('\n');
  }
}

function createHarness() {
  const cache = new MemoryCache();
  const properties = new ScriptProperties();
  const spreadsheet = new MemorySpreadsheet();
  const spreadsheets = new Map([[spreadsheet.getId(), spreadsheet]]);
  const lockControl = { failNext: false, waits: 0, releases: 0 };
  const identity = {
    effectiveEmail: 'warehouse-owner@example.com',
    ownerEmail: 'warehouse-owner@example.com'
  };
  const ui = {
    Button: { YES: 'YES' },
    ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
    alerts: [],
    alert(...args) {
      this.alerts.push(args);
      return this.Button.YES;
    },
    createMenu() {
      return {
        addItem() { return this; },
        addSeparator() { return this; },
        addToUi() { return this; }
      };
    }
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    getUuid: () => crypto.randomUUID(),
    computeDigest(_algorithm, value) {
      return signedBytes(crypto.createHash('sha256').update(bytesBuffer(value)).digest());
    },
    computeHmacSha256Signature(value, key) {
      return signedBytes(crypto.createHmac('sha256', bytesBuffer(key)).update(bytesBuffer(value)).digest());
    },
    base64EncodeWebSafe(value) {
      return bytesBuffer(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    },
    formatDate(value, timeZone, pattern) {
      assert.equal(pattern, 'yyyy-MM-dd', `Unsupported test date pattern: ${pattern}`);
      return dateKey(value, timeZone);
    }
  };

  const context = vm.createContext({
    CacheService: { getScriptCache: () => cache },
    DriveApp: {
      getFileById: (id) => {
        if (!spreadsheets.has(String(id))) throw new Error(`Unknown Drive file: ${id}`);
        return { getOwner: () => ({ getEmail: () => identity.ownerEmail }) };
      }
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          lockControl.waits += 1;
          if (lockControl.failNext) {
            lockControl.failNext = false;
            throw new Error('simulated concurrent lock holder');
          }
        },
        releaseLock() { lockControl.releases += 1; }
      })
    },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => properties },
    Session: { getEffectiveUser: () => ({ getEmail: () => identity.effectiveEmail }) },
    SpreadsheetApp: {
      flush() {},
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ui,
      openById: (id) => {
        const found = spreadsheets.get(String(id));
        if (!found) throw new Error(`Unknown spreadsheet: ${id}`);
        return found;
      },
      newDataValidation: () => ({
        requireCheckbox() { return this; },
        requireValueInList() { return this; },
        setAllowInvalid() { return this; },
        build() { return {}; }
      })
    },
    Utilities,
    console: { error() {}, log() {} },
    Date,
    Error,
    JSON,
    Math,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Array,
    isFinite,
    isNaN
  });

  for (const file of BACKEND_FILES) {
    const source = fs.readFileSync(new URL(file, ROOT), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }

  return { cache, context, identity, lockControl, properties, spreadsheet, ui };
}

function initialize(harness) {
  const result = harness.context.initializeWarehouseFromSheet();
  assert.equal(result.created, true);
  assert.equal(result.username, 'admin');
  assert.equal(result.temporaryPassword, harness.context.INITIAL_ADMIN_PASSWORD_);
  assert.equal(result.forcePasswordChange, true);
  return result;
}

function assertOk(result, message = 'RPC should succeed') {
  assert.equal(result.ok, true, `${message}: ${result.error?.code || ''} ${result.error?.message || ''}`);
  return result.data;
}

function assertRpcError(result, code) {
  assert.equal(result.ok, false, `Expected ${code}, but RPC succeeded`);
  assert.equal(result.error.code, code);
  return result.error;
}

function assertWarehouseError(callable, code) {
  assert.throws(callable, (error) => error && error.name === 'WarehouseError' && error.code === code);
}

function assertRpcSafeValue(value, path = 'data', seen = new Set()) {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} contains a non-finite number that cannot cross google.script.run safely`);
    return;
  }
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  assert.notEqual(Object.prototype.toString.call(value), '[object Date]', `${path} contains a Date instead of an RPC-safe string`);
  if (typeof value !== 'object') assert.fail(`${path} contains unsupported RPC value ${typeof value}`);
  if (seen.has(value)) assert.fail(`${path} contains a circular reference`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertRpcSafeValue(entry, `${path}[${index}]`, seen));
  } else {
    Object.entries(value).forEach(([key, entry]) => assertRpcSafeValue(entry, `${path}.${key}`, seen));
  }
  seen.delete(value);
}

function installAndSetPassword(password = 'N3w!Secure#Warehouse') {
  const harness = createHarness();
  initialize(harness);
  const firstLogin = assertOk(harness.context.authenticate({
    username: 'admin',
    password: harness.context.INITIAL_ADMIN_PASSWORD_
  }));
  assert.equal(firstLogin.user.forcePasswordChange, true);
  assertOk(harness.context.changeMyPassword(firstLogin.token, {
    currentPassword: harness.context.INITIAL_ADMIN_PASSWORD_,
    newPassword: password
  }));
  return { harness, password };
}

const tests = [
  ['only the spreadsheet owner can initialize the authentication store', () => {
    const harness = createHarness();
    harness.identity.effectiveEmail = 'spreadsheet-editor@example.com';
    assertWarehouseError(() => harness.context.initializeWarehouseFromSheet(), 'OWNER_REQUIRED');
    assert.equal(harness.properties.getProperty('WAREHOUSE_SPREADSHEET_ID'), null);
    assert.equal(harness.spreadsheet.sheets.size, 0);
  }],

  ['only the spreadsheet owner can recover administrator access', () => {
    const harness = createHarness();
    initialize(harness);
    const before = harness.context.findUserByNormalizedUsername_('admin');
    harness.identity.effectiveEmail = 'spreadsheet-editor@example.com';
    assertWarehouseError(() => harness.context.recoverAdministratorAccessFromSheet(), 'OWNER_REQUIRED');
    const after = harness.context.findUserByNormalizedUsername_('admin');
    assert.equal(after.passwordSalt, before.passwordSalt);
    assert.equal(after.passwordHash, before.passwordHash);
    assert.equal(after.sessionVersion, before.sessionVersion);
  }],

  ['fresh setup starts with login and forces a password change', () => {
    const harness = createHarness();
    const setup = initialize(harness);
    assert.equal(harness.context.INITIAL_ADMIN_PASSWORD_, 'Warehouse@2026!');
    assert.doesNotThrow(() => harness.context.validateStrongPassword_('123456', 'admin'));
    assertWarehouseError(() => harness.context.validateStrongPassword_('12345', 'admin'), 'WEAK_PASSWORD');
    assert.doesNotThrow(() => harness.context.validateStrongPassword_('x'.repeat(256), 'admin'));
    assertWarehouseError(() => harness.context.validateStrongPassword_('x'.repeat(257), 'admin'), 'WEAK_PASSWORD');
    assert.ok(harness.properties.getProperty(harness.context.AUTH_CONFIG_.PEPPER_PROPERTY));
    assert.equal(harness.context.countUserRows_(), 1, harness.spreadsheet.serializedCells());
    assert.equal(harness.spreadsheet.serializedCells().includes(setup.temporaryPassword), false, 'plaintext password leaked to a sheet');

    const loginResult = assertOk(harness.context.login('  ADMIN  ', setup.temporaryPassword));
    assert.equal(loginResult.user.username, 'admin');
    assert.equal(loginResult.user.forcePasswordChange, true);
    assertRpcError(harness.context.listUsers(loginResult.token, {}), 'PASSWORD_CHANGE_REQUIRED');

    const changed = assertOk(harness.context.changeMyPassword(loginResult.token, {
      currentPassword: setup.temporaryPassword,
      newPassword: 'N3w!Secure#Warehouse'
    }));
    assert.equal(changed.changed, true);
    assert.equal(changed.requiresLogin, true);
    assertRpcError(harness.context.listUsers(loginResult.token, {}), 'SESSION_EXPIRED');
    assertRpcError(harness.context.authenticate({ username: 'admin', password: setup.temporaryPassword }), 'INVALID_CREDENTIALS');

    const currentLogin = assertOk(harness.context.authenticate({ username: 'admin', password: 'N3w!Secure#Warehouse' }));
    assert.equal(currentLogin.user.forcePasswordChange, false);
  }],

  ['random administrator recovery invalidates the public setup password', () => {
    const harness = createHarness();
    const setup = initialize(harness);
    const recovery = harness.context.recoverAdministratorAccessFromSheet();
    assert.equal(recovery.recovered, true);
    assert.notEqual(recovery.temporaryPassword, setup.temporaryPassword);
    assertRpcError(harness.context.login('admin', setup.temporaryPassword), 'INVALID_CREDENTIALS');
    const recoveredLogin = assertOk(harness.context.login('admin', recovery.temporaryPassword));
    assert.equal(recoveredLogin.user.forcePasswordChange, true);
  }],

  ['administrator recovery survives password change, relogin, and inventory bootstrap', () => {
    const harness = createHarness();
    const setup = initialize(harness);
    const initialLogin = assertOk(harness.context.login('admin', setup.temporaryPassword));
    assertOk(harness.context.changeMyPassword(initialLogin.token, {
      currentPassword: setup.temporaryPassword,
      newPassword: 'BeforeRecovery123'
    }));
    const inventoryLogin = assertOk(harness.context.login('admin', 'BeforeRecovery123'));
    assertOk(harness.context.saveItem(inventoryLogin.token, {
      code: 'RECOVERY-001',
      name: 'Recovery inventory item',
      owner: 'Test owner',
      unit: 'قطعة',
      openingQuantity: 7,
      reorderLevel: 2,
      active: true
    }));

    const recovery = harness.context.recoverAdministratorAccessFromSheet();
    assert.equal(recovery.recovered, true);
    const temporaryLogin = assertOk(harness.context.login('admin', recovery.temporaryPassword));
    const forcedBootstrap = assertOk(harness.context.getBootstrap(temporaryLogin.token), 'temporary recovery session must bootstrap');
    assert.equal(forcedBootstrap.passwordChangeRequired, true);
    assert.equal(forcedBootstrap.items.length, 0);

    assertOk(harness.context.changeMyPassword(temporaryLogin.token, {
      currentPassword: recovery.temporaryPassword,
      newPassword: 'AfterRecovery123'
    }));
    const permanentLogin = assertOk(harness.context.login('admin', 'AfterRecovery123'));
    assert.equal(permanentLogin.user.forcePasswordChange, false);
    const bootstrap = assertOk(harness.context.getBootstrap(permanentLogin.token), 'post-recovery getBootstrap must succeed');
    assert.equal(bootstrap.passwordChangeRequired, false);
    assert.equal(bootstrap.dashboard.summary.totalItems, 1);
    assert.equal(bootstrap.itemCatalog.total, 1);
    assert.equal(bootstrap.itemCatalog.returned, 1);
    assert.equal(bootstrap.dashboard.stockStatusCounts.AVAILABLE, 1);
    assert.equal(Object.hasOwn(bootstrap.dashboard.stockStatusCounts, 'OK'), false);
    assertRpcSafeValue(bootstrap, 'getBootstrap.data');
  }],

  ['password change invalidates other sessions, and logout removes its session', () => {
    const { harness, password } = installAndSetPassword();
    const first = assertOk(harness.context.login('admin', password));
    const second = assertOk(harness.context.login('admin', password));
    assertOk(harness.context.changeMyPassword(first.token, {
      currentPassword: password,
      newPassword: 'An0ther!Secure#Pass'
    }));
    assertRpcError(harness.context.listUsers(second.token, {}), 'SESSION_INVALIDATED');

    const fresh = assertOk(harness.context.login('admin', 'An0ther!Secure#Pass'));
    assertOk(harness.context.logout(fresh.token));
    assertRpcError(harness.context.listUsers(fresh.token, {}), 'SESSION_EXPIRED');
  }],

  ['expired sessions fail bootstrap and are removed from the session cache', () => {
    const { harness, password } = installAndSetPassword();
    const login = assertOk(harness.context.login('admin', password));
    const cacheKey = harness.context.sessionCacheKey_(login.token);
    const cacheEntry = harness.cache.entries.get(cacheKey);
    assert.ok(cacheEntry, 'issued session was not cached');
    cacheEntry.expiresAt = Date.now() - 1;

    assertRpcError(harness.context.getBootstrap(login.token), 'SESSION_EXPIRED');
    assert.equal(harness.cache.entries.has(cacheKey), false, 'expired cache entry was not removed');
  }],

  ['administrator reset revokes target sessions and supports a complete new-password login', () => {
    const { harness, password } = installAndSetPassword();
    const administrator = assertOk(harness.context.login('admin', password));
    const created = assertOk(harness.context.saveUser(administrator.token, {
      username: 'reset-target',
      displayName: 'Reset target',
      role: 'STOREKEEPER',
      active: true
    }));
    const firstTargetLogin = assertOk(harness.context.login('reset-target', created.temporaryPassword));
    assertOk(harness.context.changeMyPassword(firstTargetLogin.token, {
      currentPassword: created.temporaryPassword,
      newPassword: 'TargetBeforeReset'
    }));
    const staleTargetSession = assertOk(harness.context.login('reset-target', 'TargetBeforeReset'));

    const reset = assertOk(harness.context.resetUserPassword(administrator.token, { userId: created.user.id }));
    assertRpcError(harness.context.getBootstrap(staleTargetSession.token), 'SESSION_INVALIDATED');
    assertRpcError(harness.context.login('reset-target', 'TargetBeforeReset'), 'INVALID_CREDENTIALS');

    const temporaryTargetLogin = assertOk(harness.context.login('reset-target', reset.temporaryPassword));
    const forcedBootstrap = assertOk(harness.context.getBootstrap(temporaryTargetLogin.token));
    assert.equal(forcedBootstrap.passwordChangeRequired, true);
    assertOk(harness.context.changeMyPassword(temporaryTargetLogin.token, {
      currentPassword: reset.temporaryPassword,
      newPassword: 'TargetAfterReset'
    }));
    const currentTargetLogin = assertOk(harness.context.login('reset-target', 'TargetAfterReset'));
    const currentBootstrap = assertOk(harness.context.getBootstrap(currentTargetLogin.token));
    assert.equal(currentBootstrap.passwordChangeRequired, false);
    assert.equal(currentBootstrap.user.role, 'STOREKEEPER');
  }],

  ['busy script locks fail safely without changing credentials and recover on retry', () => {
    const { harness, password } = installAndSetPassword();
    const active = assertOk(harness.context.login('admin', password));
    const releasesBeforeBusyLogin = harness.lockControl.releases;
    harness.lockControl.failNext = true;
    assertRpcError(harness.context.login('admin', password), 'SYSTEM_BUSY');
    assert.equal(harness.lockControl.releases, releasesBeforeBusyLogin, 'a lock that was never acquired must not be released');
    assertOk(harness.context.login('admin', password), 'login must recover after contention clears');

    const releasesBeforeBusyChange = harness.lockControl.releases;
    harness.lockControl.failNext = true;
    assertRpcError(harness.context.changeMyPassword(active.token, {
      currentPassword: password,
      newPassword: 'MustNotCommitWhileBusy'
    }), 'SYSTEM_BUSY');
    assert.equal(harness.lockControl.releases, releasesBeforeBusyChange, 'busy password mutation must not release an unacquired lock');
    assertOk(harness.context.getBootstrap(active.token), 'busy mutation must leave the existing session valid');
    assertOk(harness.context.login('admin', password), 'busy mutation must preserve the current password');
    assertRpcError(harness.context.login('admin', 'MustNotCommitWhileBusy'), 'INVALID_CREDENTIALS');
  }],

  ['five wrong passwords lock the account', () => {
    const { harness, password } = installAndSetPassword();
    for (let attempt = 1; attempt < harness.context.AUTH_CONFIG_.LOCK_AFTER_FAILURES; attempt += 1) {
      assertRpcError(harness.context.login('admin', 'Wr0ng!Password#1'), 'INVALID_CREDENTIALS');
    }
    const locked = assertRpcError(harness.context.login('admin', 'Wr0ng!Password#1'), 'ACCOUNT_LOCKED');
    assert.ok(locked.details.lockedUntil);
    assertRpcError(harness.context.login('admin', password), 'ACCOUNT_LOCKED');
  }],

  ['administrator recovery clears account lock and login-rate throttle', () => {
    const { harness, password } = installAndSetPassword();
    const staleSession = assertOk(harness.context.login('admin', password));

    for (let attempt = 1; attempt <= harness.context.AUTH_CONFIG_.RATE_LIMIT_ATTEMPTS; attempt += 1) {
      const result = harness.context.login('admin', 'Wr0ng!Password#2');
      const expected = attempt < harness.context.AUTH_CONFIG_.LOCK_AFTER_FAILURES ? 'INVALID_CREDENTIALS' : 'ACCOUNT_LOCKED';
      assertRpcError(result, expected);
    }
    assertRpcError(harness.context.login('admin', password), 'RATE_LIMITED');

    const recovery = harness.context.recoverAdministratorAccessFromSheet();
    assert.equal(recovery.recovered, true);
    assert.notEqual(recovery.temporaryPassword, password);
    assert.doesNotThrow(() => harness.context.validateStrongPassword_(recovery.temporaryPassword, 'admin'));
    assertRpcError(harness.context.listUsers(staleSession.token, {}), 'SESSION_INVALIDATED');

    const recoveredLogin = assertOk(harness.context.login('admin', recovery.temporaryPassword), 'recovery must clear the username throttle');
    assert.equal(recoveredLogin.user.forcePasswordChange, true);
  }],

  ['administrator password reset clears the target username rate throttle', () => {
    const { harness, password } = installAndSetPassword();
    const administrator = assertOk(harness.context.login('admin', password));
    const created = assertOk(harness.context.saveUser(administrator.token, {
      username: 'storekeeper',
      displayName: 'Storekeeper',
      role: 'STOREKEEPER',
      active: true
    }));
    const rateKey = harness.context.loginRateKey_('storekeeper');
    harness.cache.put(rateKey, JSON.stringify({
      count: harness.context.AUTH_CONFIG_.RATE_LIMIT_ATTEMPTS,
      startedAt: Date.now()
    }), harness.context.AUTH_CONFIG_.RATE_LIMIT_WINDOW_SECONDS);
    assertRpcError(harness.context.login('storekeeper', created.temporaryPassword), 'RATE_LIMITED');

    const reset = assertOk(harness.context.resetUserPassword(administrator.token, { userId: created.user.id }));
    assert.equal(harness.cache.get(rateKey), null);
    const recoveredLogin = assertOk(harness.context.login('storekeeper', reset.temporaryPassword));
    assert.equal(recoveredLogin.user.forcePasswordChange, true);
  }],

  ['credential mutation preflights the audit schema before changing a password', () => {
    const { harness, password } = installAndSetPassword();
    const administrator = assertOk(harness.context.login('admin', password));
    const created = assertOk(harness.context.saveUser(administrator.token, {
      username: 'audited-user',
      displayName: 'Audited user',
      role: 'AUDITOR',
      active: true
    }));
    const before = harness.context.findUserById_(created.user.id);
    const auditSchema = harness.context.REPOSITORY_SCHEMA_.AUDIT;
    const auditSheet = harness.spreadsheet.getSheetByName(auditSchema.name);
    const actionHeader = auditSchema.columns.action;
    let actionColumn = 0;
    for (let column = 1; column <= auditSheet.getLastColumn(); column += 1) {
      if (auditSheet.valueAt(1, column) === actionHeader) actionColumn = column;
    }
    assert.ok(actionColumn > 0);
    auditSheet.setValueAt(1, actionColumn, '');

    assertRpcError(harness.context.resetUserPassword(administrator.token, { userId: created.user.id }), 'SCHEMA_MISMATCH');
    const after = harness.context.findUserById_(created.user.id);
    assert.equal(after.passwordSalt, before.passwordSalt);
    assert.equal(after.passwordHash, before.passwordHash);
    assertOk(harness.context.login('audited-user', created.temporaryPassword));
  }],

  ['post-commit audit failure returns success, preserves the password, and queues replay', () => {
    const { harness, password } = installAndSetPassword();
    const administrator = assertOk(harness.context.login('admin', password));
    const created = assertOk(harness.context.saveUser(administrator.token, {
      username: 'outbox-user',
      displayName: 'Outbox user',
      role: 'STOREKEEPER',
      active: true
    }));
    const originalAppendAudit = harness.context.appendAuditRecord_;
    let failOnce = true;
    harness.context.appendAuditRecord_ = (input) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('forced transient audit failure');
      }
      return originalAppendAudit(input);
    };

    const reset = assertOk(harness.context.resetUserPassword(administrator.token, { userId: created.user.id }));
    assert.equal(reset.auditWarning.code, 'AUDIT_DEFERRED');
    assert.equal(reset.auditWarning.queued, true);
    assert.ok(harness.properties.getProperty(harness.context.AUTH_AUDIT_OUTBOX_PROPERTY_));
    harness.context.appendAuditRecord_ = originalAppendAudit;

    const recoveredLogin = assertOk(harness.context.login('outbox-user', reset.temporaryPassword));
    assert.equal(recoveredLogin.user.forcePasswordChange, true);
    assert.equal(harness.properties.getProperty(harness.context.AUTH_AUDIT_OUTBOX_PROPERTY_), null);
  }],

  ['audit outbox never discards an older event when capacity is reached', () => {
    const harness = createHarness();
    initialize(harness);
    const events = Array.from({ length: harness.context.AUTH_AUDIT_OUTBOX_MAX_EVENTS_ }, (_unused, index) =>
      harness.context.pendingAuthAuditEvent_({
        actor: { id: 'USR-1', username: 'admin', displayName: 'Admin' },
        action: `TEST_${index}`,
        entityType: 'TEST',
        entityId: String(index),
        status: 'SUCCESS',
        details: { index }
      }, new Error('forced outage'))
    );
    harness.context.writePendingAuthAudits_(events);
    const firstIncident = events[0].incidentId;
    const overflow = harness.context.pendingAuthAuditEvent_({ action: 'OVERFLOW' }, new Error('forced outage'));
    assert.throws(() => harness.context.writePendingAuthAudits_([...events, overflow]), /capacity reached/);
    const stored = JSON.parse(harness.properties.getProperty(harness.context.AUTH_AUDIT_OUTBOX_PROPERTY_));
    assert.equal(stored.length, harness.context.AUTH_AUDIT_OUTBOX_MAX_EVENTS_);
    assert.equal(stored[0].incidentId, firstIncident);
    const originalAppendAudit = harness.context.appendAuditRecord_;
    harness.context.appendAuditRecord_ = () => { throw new Error('still unavailable'); };
    assertWarehouseError(() => harness.context.preflightSessionAudit_(), 'AUDIT_BACKLOG_FULL');
    harness.context.appendAuditRecord_ = originalAppendAudit;
  }],

  ['schema v1 upgrades add the owner header without shifting existing item data', () => {
    const harness = createHarness();
    initialize(harness);
    const schema = harness.context.REPOSITORY_SCHEMA_.ITEMS;
    const sheet = harness.spreadsheet.getSheetByName(schema.name);
    const headers = harness.context.getHeaderInfo_(sheet);
    const codeColumn = headers.byLabel[schema.columns.code];
    const nameColumn = headers.byLabel[schema.columns.name];
    const ownerColumn = headers.byLabel[schema.columns.owner];
    sheet.setValueAt(2, codeColumn, 'LEGACY-001');
    sheet.setValueAt(2, nameColumn, 'Legacy item');
    sheet.setValueAt(1, ownerColumn, '');
    harness.context.setSettingValue_('SCHEMA_VERSION', '1', 'NUMBER', 'legacy schema', 'SYSTEM');

    assert.equal(harness.context.ensureRepositorySchemaCurrent_(), true);
    const migratedHeaders = harness.context.getHeaderInfo_(sheet);
    assert.ok(migratedHeaders.byLabel[schema.columns.owner] > 0);
    assert.equal(sheet.valueAt(2, codeColumn), 'LEGACY-001');
    assert.equal(sheet.valueAt(2, nameColumn), 'Legacy item');
    assert.equal(String(harness.context.getSettingValue_('SCHEMA_VERSION')), '2');
  }],

  ['template rows are ignored, malformed identity rows fail closed, and duplicate creation is rejected', () => {
    const templateHarness = createHarness();
    templateHarness.properties.setProperty('WAREHOUSE_SPREADSHEET_ID', templateHarness.spreadsheet.getId());
    templateHarness.context.setupRepository_(templateHarness.spreadsheet);
    templateHarness.context.appendMappedRow_('USERS', {
      active: false,
      sessionVersion: 2,
      forcePasswordChange: false
    });
    assert.equal(templateHarness.context.countUserRows_(), 0);
    assert.equal(templateHarness.context.setupSystem_(templateHarness.spreadsheet).created, true);
    assert.equal(templateHarness.context.countUserRows_(), 1, templateHarness.spreadsheet.serializedCells());
    assertWarehouseError(() => templateHarness.context.createUserRecord_({
      username: ' ADMIN ',
      displayName: 'Duplicate admin',
      password: 'Dupl1cate!Secure#Pass',
      role: 'ADMIN',
      active: true,
      forcePasswordChange: true,
      actor: 'SYSTEM'
    }), 'DUPLICATE_USERNAME');

    const admin = templateHarness.context.allUserRecords_()[0];
    templateHarness.context.appendMappedRow_('USERS', {
      id: 'USR-manually-duplicated',
      username: 'ADMIN',
      displayName: 'Manual duplicate',
      passwordSalt: admin.passwordSalt,
      passwordHash: admin.passwordHash,
      role: 'STOREKEEPER',
      active: true,
      failedAttempts: 0,
      sessionVersion: 1,
      forcePasswordChange: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'SHEET_EDITOR'
    });
    assertWarehouseError(() => templateHarness.context.allUserRecords_(), 'USER_DATA_INVALID');
    const duplicateRecovery = templateHarness.context.recoverAdministratorAccessFromSheet();
    assert.equal(duplicateRecovery.recovered, true);
    assert.equal(duplicateRecovery.duplicateAdministratorsArchived, 1);
    assert.equal(templateHarness.context.allUserRecords_().filter((user) => user.username === 'admin').length, 1);
    assertOk(templateHarness.context.login('admin', duplicateRecovery.temporaryPassword));

    const malformedHarness = createHarness();
    malformedHarness.properties.setProperty('WAREHOUSE_SPREADSHEET_ID', malformedHarness.spreadsheet.getId());
    malformedHarness.context.setupRepository_(malformedHarness.spreadsheet);
    malformedHarness.context.ensurePasswordPepper_();
    malformedHarness.context.appendMappedRow_('USERS', { id: 'USR-malformed-without-username' });
    assertWarehouseError(() => malformedHarness.context.setupSystem_(malformedHarness.spreadsheet), 'USER_DATA_INVALID');
  }]
];

let failures = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

if (failures) {
  console.error(`\nauth verification failed: ${failures}/${tests.length}`);
  process.exitCode = 1;
} else {
  console.log(`\nauth verification passed: ${tests.length}/${tests.length}`);
}
