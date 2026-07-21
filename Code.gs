/**
 * Warehouse Control - Google Apps Script entry points and shared utilities.
 *
 * The bound Google Spreadsheet is the live data store. Export.gs creates the
 * requested .xlsx copy without ever sharing the source spreadsheet.
 */

var WAREHOUSE_CONFIG_ = Object.freeze({
  APP_NAME: 'نظام مراقبة المخزون',
  TIME_ZONE: 'Asia/Hebron',
  SCHEMA_VERSION: '1',
  MAX_TEXT_LENGTH: 1000,
  MAX_PAGE_SIZE: 100,
  LOCK_WAIT_MS: 30000
});

// First-install administrator password. It is deliberately easy to type and
// is accepted only while the pristine SYSTEM-created admin is still waiting
// for its mandatory first password change.
var INITIAL_ADMIN_PASSWORD_ = 'Warehouse@2026!';

/** @constructor */
function WarehouseError_(code, message, details) {
  this.name = 'WarehouseError';
  this.code = code || 'INTERNAL_ERROR';
  this.message = message || 'حدث خطأ غير متوقع.';
  this.details = details || null;
}

WarehouseError_.prototype = Object.create(Error.prototype);
WarehouseError_.prototype.constructor = WarehouseError_;

/**
 * Web app entry point. HtmlService's default X-Frame-Options policy is kept;
 * ALLOWALL is deliberately not used.
 */
function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle(WAREHOUSE_CONFIG_.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Include a trusted project HTML partial from Index.html. */
function include_(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}

/**
 * Adds the only supported initialization entry point to the bound Sheet UI.
 * A web-app request has no active spreadsheet and therefore cannot use it.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('نظام المخزون')
    .addItem('تهيئة النظام', 'initializeWarehouseFromSheet')
    .addSeparator()
    .addItem('استعادة دخول المدير', 'recoverAdministratorAccessFromSheet')
    .addToUi();
}

/**
 * Sheet-menu handler. Captures the bound spreadsheet ID without accepting an
 * ID from a browser, then invokes the private initializer.
 */
function initializeWarehouseFromSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new WarehouseError_('SHEET_CONTEXT_REQUIRED', 'شغل التهيئة من قائمة «نظام المخزون» داخل Google Sheets.');
  }
  var properties = PropertiesService.getScriptProperties();
  var storedId = properties.getProperty('WAREHOUSE_SPREADSHEET_ID');
  if (storedId && storedId !== spreadsheet.getId()) {
    throw new WarehouseError_('SPREADSHEET_MISMATCH', 'المشروع مهيأ لجدول آخر، ولن يتم تغييره تلقائياً.');
  }
  properties.setProperty('WAREHOUSE_SPREADSHEET_ID', spreadsheet.getId());
  var result = setupSystem_(spreadsheet);
  var message = result.created ?
    ('تمت التهيئة.\n\nاسم المستخدم: ' + result.username + '\nكلمة المرور المؤقتة: ' + result.temporaryPassword + '\n\nانسخها الآن؛ لن تظهر مرة أخرى.') :
    result.message;
  SpreadsheetApp.getUi().alert('نظام المخزون', message, SpreadsheetApp.getUi().ButtonSet.OK);
  return result;
}

/**
 * Private one-time setup. It is safe to run repeatedly.
 *
 * On the first run only, the Sheet dialog and returned object contain the
 * randomly generated temporary administrator password. Plaintext passwords
 * are never written to Sheets, Properties, Cache, logs, or another persistent
 * store.
 */
function setupSystem_(spreadsheet) {
  return withScriptLock_(function () {
    setupRepository_(spreadsheet);
    var existingUserCount = countUserRows_();
    var pepperExists = !!PropertiesService.getScriptProperties().getProperty(AUTH_CONFIG_.PEPPER_PROPERTY);
    if (existingUserCount > 0 && !pepperExists) {
      throw new WarehouseError_(
        'AUTH_PEPPER_MISSING',
        'مفتاح حماية كلمات المرور غير موجود. لا يمكن استبداله تلقائياً؛ استخدم «استعادة دخول المدير» من قائمة النظام.'
      );
    }
    if (!pepperExists) ensurePasswordPepper_();

    // Keep schema/settings completion idempotent even when an admin exists.
    setSettingValue_('SCHEMA_VERSION', WAREHOUSE_CONFIG_.SCHEMA_VERSION, 'NUMBER', 'إصدار مخطط البيانات', 'SYSTEM');
    setSettingValue_('SYSTEM_NAME', WAREHOUSE_CONFIG_.APP_NAME, 'TEXT', 'اسم النظام', 'SYSTEM');
    if (getSettingValue_('BACKUP_FOLDER_ID') === null) {
      setSettingValue_('BACKUP_FOLDER_ID', '', 'DRIVE_FOLDER_ID', 'معرف مجلد نسخ Excel الاحتياطية', 'SYSTEM');
    }

    var existingAdmin = findUserByNormalizedUsername_('admin');
    if (existingAdmin) {
      var existingResult = {
        initialized: true,
        created: false,
        message: 'النظام مهيأ مسبقاً، ولم يتم تغيير حساب المدير.'
      };
      Logger.log(JSON.stringify(existingResult));
      return existingResult;
    }

    if (existingUserCount > 0) {
      throw new WarehouseError_(
        'SETUP_CONFLICT',
        'يوجد مستخدمون ولا يوجد حساب admin. أوقف الإعداد لحماية البيانات.'
      );
    }

    var temporaryPassword = INITIAL_ADMIN_PASSWORD_;
    var admin = createUserRecord_({
      username: 'admin',
      displayName: 'مدير النظام',
      password: temporaryPassword,
      role: 'ADMIN',
      active: true,
      forcePasswordChange: true,
      actor: 'SYSTEM'
    });

    appendAuditRecord_({
      actor: { id: admin.id, username: admin.username, displayName: admin.displayName },
      action: 'SYSTEM_SETUP',
      entityType: 'SYSTEM',
      entityId: spreadsheet.getId(),
      status: 'SUCCESS',
      details: { schemaVersion: WAREHOUSE_CONFIG_.SCHEMA_VERSION }
    });
    SpreadsheetApp.flush();

    var result = {
      initialized: true,
      created: true,
      username: admin.username,
      displayName: admin.displayName,
      temporaryPassword: temporaryPassword,
      forcePasswordChange: true,
      warning: 'انسخ كلمة المرور المؤقتة الآن؛ لن تظهر مرة أخرى.'
    };
    return result;
  });
}

/**
 * Owner recovery handler. It is callable only with an actual active Sheet
 * context and never accepts a spreadsheet ID from its caller.
 */
function recoverAdministratorAccessFromSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new WarehouseError_('SHEET_CONTEXT_REQUIRED', 'شغل الاستعادة من قائمة «نظام المخزون» داخل Google Sheets.');
  }
  var properties = PropertiesService.getScriptProperties();
  var storedId = properties.getProperty('WAREHOUSE_SPREADSHEET_ID');
  if (storedId && storedId !== spreadsheet.getId()) {
    throw new WarehouseError_('SPREADSHEET_MISMATCH', 'هذا ليس جدول النظام المهيأ.');
  }
  var ui = SpreadsheetApp.getUi();
  var choice = ui.alert(
    'استعادة دخول المدير',
    'سيتم إلغاء جلسات المدير وإنشاء كلمة مرور مؤقتة جديدة. هل تريد المتابعة؟',
    ui.ButtonSet.YES_NO
  );
  if (choice !== ui.Button.YES) return { recovered: false, cancelled: true };
  properties.setProperty('WAREHOUSE_SPREADSHEET_ID', spreadsheet.getId());
  var result = recoverAdministratorAccess_(spreadsheet);
  var recoveryMessage = 'اسم المستخدم: ' + result.username + '\nكلمة المرور المؤقتة: ' + result.temporaryPassword + '\n\nانسخها الآن؛ لن تظهر مرة أخرى.';
  if (result.warning) recoveryMessage += '\n\nتنبيه: ' + result.warning;
  ui.alert(
    'تمت الاستعادة',
    recoveryMessage,
    ui.ButtonSet.OK
  );
  return result;
}

function recoverAdministratorAccess_(spreadsheet) {
  return withScriptLock_(function () {
    setupRepository_(spreadsheet);
    var users = allUserRecords_();
    if (!users.length) {
      throw new WarehouseError_('SYSTEM_NOT_INITIALIZED', 'لا يوجد مستخدمون. استخدم «تهيئة النظام» بدلاً من الاستعادة.');
    }
    var pepperWasMissing = !PropertiesService.getScriptProperties().getProperty(AUTH_CONFIG_.PEPPER_PROPERTY);
    if (pepperWasMissing) {
      ensurePasswordPepper_();
      // Cached sessions do not depend on the password hash; invalidate every
      // one when the server secret is re-provisioned.
      users.forEach(function (user) {
        updateUserFields_(user, { sessionVersion: user.sessionVersion + 1 });
      });
      users = allUserRecords_();
    }
    var administrator = null;
    for (var i = 0; i < users.length; i += 1) {
      if (users[i].username === 'admin') administrator = users[i];
    }
    if (!administrator) {
      for (var j = 0; j < users.length; j += 1) {
        if (users[j].role === 'ADMIN') { administrator = users[j]; break; }
      }
    }
    if (!administrator) throw new WarehouseError_('ADMIN_NOT_FOUND', 'لا يوجد حساب مدير لاستعادته.');

    var temporaryPassword = INITIAL_ADMIN_PASSWORD_;
    var salt = generatePasswordSalt_();
    administrator = updateUserFields_(administrator, {
      passwordSalt: salt,
      passwordHash: derivePasswordHash_(administrator.username, temporaryPassword, salt),
      role: 'ADMIN',
      active: true,
      failedAttempts: 0,
      lockedUntil: '',
      forcePasswordChange: true,
      sessionVersion: administrator.sessionVersion + 1
    });
    appendAuditRecord_({
      actor: { id: administrator.id, username: administrator.username, displayName: administrator.displayName },
      action: 'ADMIN_RECOVERY',
      entityType: 'USER',
      entityId: administrator.id,
      status: 'SUCCESS',
      details: { pepperReprovisioned: pepperWasMissing }
    });
    return {
      recovered: true,
      username: administrator.username,
      temporaryPassword: temporaryPassword,
      forcePasswordChange: true,
      pepperReprovisioned: pepperWasMissing,
      warning: pepperWasMissing ? 'يجب إعادة تعيين كلمات مرور باقي المستخدمين من لوحة المدير.' : ''
    };
  });
}

/** Execute a callable and convert all expected errors to a stable RPC shape. */
function apiResult_(callable) {
  try {
    return { ok: true, data: callable() };
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    return { ok: false, error: publicError_(error) };
  }
}

function publicError_(error) {
  if (error && error.name === 'WarehouseError') {
    var expected = { code: error.code, message: error.message };
    if (error.details !== null && error.details !== undefined) {
      expected.details = error.details;
    }
    return expected;
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'تعذر إتمام الطلب. حاول مرة أخرى، ثم راجع سجل التشغيل إن استمر الخطأ.'
  };
}

/** All mutations use the script-wide lock, not a user-specific lock. */
function withScriptLock_(callable) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(WAREHOUSE_CONFIG_.LOCK_WAIT_MS);
  } catch (error) {
    throw new WarehouseError_(
      'SYSTEM_BUSY',
      'النظام مشغول بعملية أخرى. أعد المحاولة بعد لحظات.'
    );
  }
  try {
    return callable();
  } finally {
    lock.releaseLock();
  }
}

function requireObject_(value, fieldName) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    throw new WarehouseError_('VALIDATION_ERROR', 'بيانات ' + fieldName + ' غير صالحة.');
  }
  return value;
}

function requireText_(value, fieldName, maxLength, allowEmpty) {
  var text = value === null || value === undefined ? '' : String(value).trim();
  if (!allowEmpty && !text) {
    throw new WarehouseError_('VALIDATION_ERROR', 'حقل ' + fieldName + ' مطلوب.', { field: fieldName });
  }
  var limit = maxLength || WAREHOUSE_CONFIG_.MAX_TEXT_LENGTH;
  if (text.length > limit || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    throw new WarehouseError_('VALIDATION_ERROR', 'قيمة ' + fieldName + ' غير صالحة.', { field: fieldName });
  }
  return text;
}

function requireFiniteNumber_(value, fieldName, minimum, maximum) {
  var number = typeof value === 'number' ? value : Number(value);
  if (!isFinite(number) || (minimum !== undefined && number < minimum) || (maximum !== undefined && number > maximum)) {
    throw new WarehouseError_('VALIDATION_ERROR', 'قيمة ' + fieldName + ' غير صالحة.', { field: fieldName });
  }
  return number;
}

function parseBoolean_(value, defaultValue) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return defaultValue;
}

function newId_(prefix) {
  return String(prefix || 'ID') + '-' + Utilities.getUuid();
}

function isoDate_(value) {
  if (!value) return null;
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

function clampPage_(params) {
  params = params || {};
  var requestedPage = Number(params.page);
  var requestedPageSize = Number(params.pageSize);
  var page = isFinite(requestedPage) ? Math.max(1, Math.min(100000, Math.floor(requestedPage))) : 1;
  var pageSize = isFinite(requestedPageSize) ? Math.max(1, Math.min(WAREHOUSE_CONFIG_.MAX_PAGE_SIZE, Math.floor(requestedPageSize))) : 25;
  return { page: page, pageSize: pageSize };
}
