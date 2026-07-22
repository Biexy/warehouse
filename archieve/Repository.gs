/** Data schema and low-level access for the bound Google Spreadsheet. */

var REPOSITORY_SCHEMA_ = {
  USERS: {
    name: 'المستخدمون',
    columns: {
      id: 'معرف المستخدم',
      username: 'اسم المستخدم',
      displayName: 'الاسم المعروض',
      passwordSalt: 'ملح كلمة المرور',
      passwordHash: 'بصمة كلمة المرور',
      role: 'الدور',
      active: 'نشط',
      failedAttempts: 'محاولات فاشلة',
      lockedUntil: 'مقفل حتى',
      sessionVersion: 'إصدار الجلسة',
      forcePasswordChange: 'يلزم تغيير كلمة المرور',
      lastLoginAt: 'آخر دخول',
      createdAt: 'تاريخ الإنشاء',
      updatedAt: 'تاريخ التحديث',
      createdBy: 'أنشأه'
    },
    order: ['id', 'username', 'displayName', 'passwordSalt', 'passwordHash', 'role', 'active', 'failedAttempts', 'lockedUntil', 'sessionVersion', 'forcePasswordChange', 'lastLoginAt', 'createdAt', 'updatedAt', 'createdBy']
  },
  ITEMS: {
    name: 'الأصناف',
    columns: {
      id: 'معرف الصنف',
      code: 'رمز الصنف',
      name: 'اسم الصنف',
      owner: 'المالك',
      unit: 'الوحدة',
      openingQuantity: 'الرصيد الافتتاحي',
      reorderLevel: 'حد إعادة الطلب',
      active: 'نشط',
      createdAt: 'تاريخ الإنشاء',
      updatedAt: 'تاريخ التحديث',
      createdBy: 'أنشأه',
      updatedBy: 'حدثه'
    },
    order: ['id', 'code', 'name', 'owner', 'unit', 'openingQuantity', 'reorderLevel', 'active', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']
  },
  MOVEMENTS: {
    name: 'الحركات',
    columns: {
      id: 'معرف الحركة',
      clientRequestId: 'معرف طلب العميل',
      timestamp: 'وقت الخادم',
      documentDate: 'تاريخ المستند',
      type: 'نوع الحركة',
      itemId: 'معرف الصنف',
      itemCode: 'رمز الصنف',
      itemName: 'اسم الصنف',
      quantity: 'الكمية',
      netChange: 'التغير الصافي',
      balanceBefore: 'الرصيد قبل',
      balanceAfter: 'الرصيد بعد',
      party: 'الجهة المستفيدة أو الموردة',
      reference: 'المرجع',
      notes: 'ملاحظات',
      originalMovementId: 'معرف الحركة الأصلية',
      actorId: 'معرف المنفذ',
      actorUsername: 'اسم مستخدم المنفذ',
      actorDisplayName: 'اسم المنفذ'
    },
    order: ['id', 'clientRequestId', 'timestamp', 'documentDate', 'type', 'itemId', 'itemCode', 'itemName', 'quantity', 'netChange', 'balanceBefore', 'balanceAfter', 'party', 'reference', 'notes', 'originalMovementId', 'actorId', 'actorUsername', 'actorDisplayName']
  },
  AUDIT: {
    name: 'سجل التدقيق',
    columns: {
      id: 'معرف السجل',
      timestamp: 'وقت الخادم',
      actorId: 'معرف المنفذ',
      actorUsername: 'اسم مستخدم المنفذ',
      actorDisplayName: 'اسم المنفذ',
      action: 'الإجراء',
      entityType: 'نوع الكيان',
      entityId: 'معرف الكيان',
      status: 'النتيجة',
      details: 'التفاصيل'
    },
    order: ['id', 'timestamp', 'actorId', 'actorUsername', 'actorDisplayName', 'action', 'entityType', 'entityId', 'status', 'details']
  },
  SETTINGS: {
    name: 'الإعدادات',
    columns: {
      key: 'المفتاح',
      value: 'القيمة',
      type: 'النوع',
      description: 'الوصف',
      updatedAt: 'تاريخ التحديث',
      updatedBy: 'حدثه'
    },
    order: ['key', 'value', 'type', 'description', 'updatedAt', 'updatedBy']
  }
};

function getBoundSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('WAREHOUSE_SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new WarehouseError_('SYSTEM_NOT_INITIALIZED', 'هيئ النظام من قائمة «نظام المخزون» داخل Google Sheets أولاً.');
  }
  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new WarehouseError_('SPREADSHEET_UNAVAILABLE', 'تعذر فتح جدول النظام المهيأ.');
  }
}

function setupRepository_(spreadsheet) {
  spreadsheet.setSpreadsheetTimeZone(WAREHOUSE_CONFIG_.TIME_ZONE);
  Object.keys(REPOSITORY_SCHEMA_).forEach(function (key) {
    ensureSchemaSheet_(spreadsheet, key, REPOSITORY_SCHEMA_[key]);
  });
}

/**
 * Apply additive schema migrations once per deployed schema version. This is
 * called after authentication and makes upgrades safe for existing Sheets;
 * users do not have to rerun the full first-install flow just to add a column.
 */
function ensureRepositorySchemaCurrent_() {
  var currentVersion = String(getSettingValue_('SCHEMA_VERSION') || '');
  if (currentVersion === WAREHOUSE_CONFIG_.SCHEMA_VERSION) return false;
  return withScriptLock_(function () {
    currentVersion = String(getSettingValue_('SCHEMA_VERSION') || '');
    if (currentVersion === WAREHOUSE_CONFIG_.SCHEMA_VERSION) return false;
    setupRepository_(getBoundSpreadsheet_());
    setSettingValue_('SCHEMA_VERSION', WAREHOUSE_CONFIG_.SCHEMA_VERSION, 'NUMBER', 'إصدار مخطط البيانات', 'SYSTEM');
    return true;
  });
}

function ensureSchemaSheet_(spreadsheet, schemaKey, schema) {
  var sheet = spreadsheet.getSheetByName(schema.name);
  if (!sheet) sheet = spreadsheet.insertSheet(schema.name);

  var labels = schema.order.map(function (key) { return schema.columns[key]; });
  if (sheet.getMaxColumns() < labels.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), labels.length - sheet.getMaxColumns());
  }

  var headerWidth = Math.max(sheet.getLastColumn(), labels.length);
  var current = sheet.getRange(1, 1, 1, headerWidth).getDisplayValues()[0];
  var nonEmpty = current.filter(function (value) { return String(value).trim() !== ''; });
  if (nonEmpty.length === 0) {
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
  } else {
    var seen = {};
    nonEmpty.forEach(function (label) {
      if (seen[label]) {
        throw new WarehouseError_('SCHEMA_MISMATCH', 'يوجد عنوان مكرر في ورقة ' + schema.name + ': ' + label);
      }
      seen[label] = true;
    });
    var nextColumn = current.length + 1;
    labels.forEach(function (label) {
      if (!seen[label]) {
        if (sheet.getMaxColumns() < nextColumn) sheet.insertColumnAfter(sheet.getMaxColumns());
        sheet.getRange(1, nextColumn).setValue(label);
        nextColumn += 1;
      }
    });
  }

  styleSchemaSheet_(sheet, schemaKey, schema);
}

function styleSchemaSheet_(sheet, schemaKey, schema) {
  var headers = getHeaderInfo_(sheet);
  var lastColumn = headers.values.length;
  sheet.setRightToLeft(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);
  sheet.getRange(1, 1, 1, lastColumn)
    .setBackground('#15202b')
    .setFontColor('#8ee8ff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  schema.order.forEach(function (key) {
    var column = headers.byLabel[schema.columns[key]];
    if (!column) return;
    var width = key === 'notes' || key === 'details' || key === 'description' ? 280 :
      (key === 'displayName' || key === 'name' || key === 'itemName' ? 190 : 135);
    sheet.setColumnWidth(column, width);
  });

  ['createdAt', 'updatedAt', 'timestamp', 'documentDate', 'lockedUntil', 'lastLoginAt'].forEach(function (key) {
    var dateColumn = headers.byLabel[schema.columns[key]];
    if (dateColumn && sheet.getMaxRows() > 1) {
      sheet.getRange(2, dateColumn, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    }
  });
  ['openingQuantity', 'reorderLevel', 'quantity', 'netChange', 'balanceBefore', 'balanceAfter'].forEach(function (key) {
    var numberColumn = headers.byLabel[schema.columns[key]];
    if (numberColumn && sheet.getMaxRows() > 1) {
      sheet.getRange(2, numberColumn, sheet.getMaxRows() - 1, 1).setNumberFormat('0.######');
    }
  });

  if (sheet.getMaxRows() > 1 && schema.columns.active) {
    var activeColumn = headers.byLabel[schema.columns.active];
    var checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build();
    sheet.getRange(2, activeColumn, sheet.getMaxRows() - 1, 1).setDataValidation(checkboxRule);
  }
  if (sheet.getMaxRows() > 1 && schema.columns.forcePasswordChange) {
    var forceColumn = headers.byLabel[schema.columns.forcePasswordChange];
    var forceRule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build();
    sheet.getRange(2, forceColumn, sheet.getMaxRows() - 1, 1).setDataValidation(forceRule);
  }
  if (sheet.getMaxRows() > 1 && schema.columns.role) {
    var roleColumn = headers.byLabel[schema.columns.role];
    var roleRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['ADMIN', 'STOREKEEPER', 'AUDITOR'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, roleColumn, sheet.getMaxRows() - 1, 1).setDataValidation(roleRule);
  }

  if (schemaKey === 'USERS') {
    ['passwordSalt', 'passwordHash'].forEach(function (key) {
      var secretColumn = headers.byLabel[schema.columns[key]];
      if (secretColumn) {
        try { sheet.hideColumns(secretColumn); } catch (ignored) { /* Already hidden. */ }
      }
    });
  }
}

function getSchemaSheet_(schemaKey) {
  var schema = REPOSITORY_SCHEMA_[schemaKey];
  var sheet = getBoundSpreadsheet_().getSheetByName(schema.name);
  if (!sheet) throw new WarehouseError_('SYSTEM_NOT_INITIALIZED', 'هيئ النظام من قائمة «نظام المخزون» داخل Google Sheets أولاً.');
  return sheet;
}

function getHeaderInfo_(sheet) {
  var lastColumn = Math.max(1, sheet.getLastColumn());
  var values = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  while (values.length && !String(values[values.length - 1]).trim()) values.pop();
  var byLabel = Object.create(null);
  values.forEach(function (label, index) {
    label = String(label).trim();
    if (!label) return;
    if (byLabel[label]) {
      throw new WarehouseError_('SCHEMA_MISMATCH', 'يوجد عنوان عمود مكرر: ' + label, { sheet: sheet.getName(), header: label });
    }
    byLabel[label] = index + 1;
  });
  return { values: values, byLabel: byLabel };
}

/** Header-only validated handle used by writes; never reads operational rows. */
function schemaMetadata_(schemaKey) {
  var schema = REPOSITORY_SCHEMA_[schemaKey];
  if (!schema) throw new WarehouseError_('SCHEMA_MISMATCH', 'مخطط الورقة غير معروف.');
  var sheet = getSchemaSheet_(schemaKey);
  var headers = getHeaderInfo_(sheet);
  schema.order.forEach(function (key) {
    if (!headers.byLabel[schema.columns[key]]) {
      throw new WarehouseError_('SCHEMA_MISMATCH', 'العمود مفقود في ' + schema.name + ': ' + schema.columns[key]);
    }
  });
  return { schema: schema, sheet: sheet, headers: headers };
}

function schemaTable_(schemaKey) {
  var table = schemaMetadata_(schemaKey);
  var rows = [];
  var lastRow = table.sheet.getLastRow();
  if (lastRow > 1) {
    var values = table.sheet.getRange(2, 1, lastRow - 1, table.headers.values.length).getValues();
    values.forEach(function (row, index) {
      var hasValue = row.some(function (cell) { return cell !== '' && cell !== null; });
      if (hasValue) rows.push({ rowNumber: index + 2, values: row });
    });
  }
  table.rows = rows;
  return table;
}

function rowValue_(table, row, key) {
  var label = table.schema.columns[key];
  var column = table.headers.byLabel[label];
  return column ? row[column - 1] : null;
}

function appendMappedRow_(schemaKey, valuesByKey) {
  var table = schemaMetadata_(schemaKey);
  var row = table.headers.values.map(function () { return ''; });
  Object.keys(valuesByKey).forEach(function (key) {
    var column = table.headers.byLabel[table.schema.columns[key]];
    if (column) row[column - 1] = safeCellValue_(valuesByKey[key]);
  });
  var rowNumber = Math.max(2, table.sheet.getLastRow() + 1);
  if (rowNumber > table.sheet.getMaxRows()) table.sheet.insertRowAfter(table.sheet.getMaxRows());
  table.sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  return rowNumber;
}

/** Append multiple mapped records in one Sheets write. */
function appendMappedRows_(schemaKey, rowsByKey) {
  if (!Array.isArray(rowsByKey) || !rowsByKey.length) return [];
  var table = schemaMetadata_(schemaKey);
  var rows = rowsByKey.map(function (valuesByKey) {
    var row = table.headers.values.map(function () { return ''; });
    Object.keys(valuesByKey || {}).forEach(function (key) {
      var column = table.headers.byLabel[table.schema.columns[key]];
      if (column) row[column - 1] = safeCellValue_(valuesByKey[key]);
    });
    return row;
  });
  var firstRow = Math.max(2, table.sheet.getLastRow() + 1);
  var requiredLastRow = firstRow + rows.length - 1;
  if (requiredLastRow > table.sheet.getMaxRows()) {
    table.sheet.insertRowsAfter(table.sheet.getMaxRows(), requiredLastRow - table.sheet.getMaxRows());
  }
  table.sheet.getRange(firstRow, 1, rows.length, table.headers.values.length).setValues(rows);
  return rows.map(function (_row, index) { return firstRow + index; });
}

function updateMappedRow_(schemaKey, rowNumber, valuesByKey) {
  var table = schemaMetadata_(schemaKey);
  if (rowNumber < 2 || rowNumber > table.sheet.getLastRow()) {
    throw new WarehouseError_('NOT_FOUND', 'السجل غير موجود.');
  }
  var updates = [];
  Object.keys(valuesByKey).forEach(function (key) {
    var column = table.headers.byLabel[table.schema.columns[key]];
    if (column) updates.push({ column: column, value: safeCellValue_(valuesByKey[key]) });
  });
  updates.sort(function (left, right) { return left.column - right.column; });

  // Write only mapped cells. Rewriting the whole row would replace formulas in
  // owner-added columns with their calculated values. Adjacent mapped cells
  // are still batched so related fields such as a password salt/hash are
  // written together in one Sheets operation.
  var group = [];
  updates.forEach(function (update, index) {
    if (!group.length || update.column === group[group.length - 1].column + 1) {
      group.push(update);
    }
    if (index === updates.length - 1 || updates[index + 1].column !== update.column + 1) {
      table.sheet.getRange(rowNumber, group[0].column, 1, group.length)
        .setValues([group.map(function (entry) { return entry.value; })]);
      group = [];
    }
  });
}

/** Prefix spreadsheet formula leaders before every string write. */
function safeCellValue_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;
  var text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function readCellText_(value) {
  if (value === null || value === undefined) return '';
  var text = String(value);
  return /^'[=+\-@]/.test(text) ? text.substring(1) : text;
}

function userFromTableRow_(table, entry) {
  var row = entry.values;
  return {
    rowNumber: entry.rowNumber,
    id: readCellText_(rowValue_(table, row, 'id')),
    username: normalizeUsername_(readCellText_(rowValue_(table, row, 'username'))),
    displayName: readCellText_(rowValue_(table, row, 'displayName')),
    passwordSalt: readCellText_(rowValue_(table, row, 'passwordSalt')),
    passwordHash: readCellText_(rowValue_(table, row, 'passwordHash')),
    role: readCellText_(rowValue_(table, row, 'role')),
    active: rowValue_(table, row, 'active') === true || String(rowValue_(table, row, 'active')).toLowerCase() === 'true',
    failedAttempts: Number(rowValue_(table, row, 'failedAttempts')) || 0,
    lockedUntil: rowValue_(table, row, 'lockedUntil') || null,
    sessionVersion: Number(rowValue_(table, row, 'sessionVersion')) || 1,
    forcePasswordChange: rowValue_(table, row, 'forcePasswordChange') === true || String(rowValue_(table, row, 'forcePasswordChange')).toLowerCase() === 'true',
    lastLoginAt: rowValue_(table, row, 'lastLoginAt') || null,
    createdAt: rowValue_(table, row, 'createdAt') || null,
    updatedAt: rowValue_(table, row, 'updatedAt') || null,
    createdBy: readCellText_(rowValue_(table, row, 'createdBy'))
  };
}

function allUserRecords_() {
  var table = schemaTable_('USERS');
  // Ignore preformatted/template rows that contain defaults (for example a
  // session-version value or checkbox) but no actual user identity. A real
  // user must have both an ID and username; partial identities fail closed.
  var users = [];
  var ids = {};
  var usernames = {};
  table.rows.forEach(function (entry) {
    var id = readCellText_(rowValue_(table, entry.values, 'id'));
    var rawUsername = readCellText_(rowValue_(table, entry.values, 'username'));
    if (!id && !rawUsername) return;
    if (!id || !rawUsername) {
      throw new WarehouseError_('USER_DATA_INVALID', 'يوجد صف مستخدم غير مكتمل في ورقة المستخدمين.', { row: entry.rowNumber });
    }

    var username;
    try {
      username = validateUsername_(rawUsername);
    } catch (ignored) {
      throw new WarehouseError_('USER_DATA_INVALID', 'اسم مستخدم غير صالح في ورقة المستخدمين.', { row: entry.rowNumber });
    }
    if (ids[id]) {
      throw new WarehouseError_('USER_DATA_INVALID', 'يوجد معرّف مستخدم مكرر في ورقة المستخدمين.', { row: entry.rowNumber });
    }
    if (usernames[username]) {
      throw new WarehouseError_('USER_DATA_INVALID', 'يوجد اسم مستخدم مكرر في ورقة المستخدمين.', { row: entry.rowNumber });
    }

    var user = userFromTableRow_(table, entry);
    if (!user.passwordSalt || !user.passwordHash || WAREHOUSE_ROLES_.indexOf(user.role) === -1) {
      throw new WarehouseError_('USER_DATA_INVALID', 'بيانات الدخول أو الدور غير مكتملة في ورقة المستخدمين.', { row: entry.rowNumber });
    }
    ids[id] = true;
    usernames[username] = true;
    users.push(user);
  });
  return users;
}

/**
 * Owner-recovery helper for installations affected by the historical row
 * reader bug that allowed setup to append more than one SYSTEM admin. The
 * oldest identity is preserved so existing audit references remain useful;
 * later duplicates are renamed and disabled, which also makes their existing
 * username-bound password hashes unusable.
 */
function archiveDuplicateAdministratorRows_() {
  var table = schemaTable_('USERS');
  var administrators = table.rows.map(function (entry) {
    return userFromTableRow_(table, entry);
  }).filter(function (user) {
    return user.id && user.username === 'admin';
  }).sort(function (left, right) {
    return left.rowNumber - right.rowNumber;
  });

  if (administrators.length <= 1) return { archived: 0, retainedId: administrators.length ? administrators[0].id : '' };
  var retained = administrators[0];
  for (var i = 1; i < administrators.length; i += 1) {
    var duplicate = administrators[i];
    updateMappedRow_('USERS', duplicate.rowNumber, {
      username: 'archived_admin_' + duplicate.rowNumber,
      role: 'AUDITOR',
      active: false,
      failedAttempts: 0,
      lockedUntil: '',
      sessionVersion: duplicate.sessionVersion + 1,
      forcePasswordChange: true,
      updatedAt: new Date()
    });
  }
  return { archived: administrators.length - 1, retainedId: retained.id };
}

function findUserByNormalizedUsername_(username) {
  var normalized = normalizeUsername_(username);
  var users = allUserRecords_();
  for (var i = 0; i < users.length; i += 1) {
    if (users[i].username === normalized) return users[i];
  }
  return null;
}

function findUserById_(id) {
  var target = String(id || '');
  var users = allUserRecords_();
  for (var i = 0; i < users.length; i += 1) {
    if (users[i].id === target) return users[i];
  }
  return null;
}

function countUserRows_() {
  return allUserRecords_().length;
}

function createUserRecord_(input) {
  var username = validateUsername_(input.username);
  if (findUserByNormalizedUsername_(username)) {
    throw new WarehouseError_('DUPLICATE_USERNAME', 'اسم المستخدم مستخدم مسبقاً.', { field: 'username' });
  }
  var displayName = requireText_(input.displayName, 'الاسم المعروض', 100, false);
  var role = validateRole_(input.role);
  validateStrongPassword_(input.password, username);
  var salt = generatePasswordSalt_();
  var now = new Date();
  var record = {
    id: newId_('USR'),
    username: username,
    displayName: displayName,
    passwordSalt: salt,
    passwordHash: derivePasswordHash_(username, input.password, salt),
    role: role,
    active: parseBoolean_(input.active, true),
    failedAttempts: 0,
    lockedUntil: '',
    sessionVersion: 1,
    forcePasswordChange: parseBoolean_(input.forcePasswordChange, true),
    lastLoginAt: '',
    createdAt: now,
    updatedAt: now,
    createdBy: requireText_(input.actor || 'SYSTEM', 'المنشئ', 100, false)
  };
  record.rowNumber = appendMappedRow_('USERS', record);
  return record;
}

function updateUserFields_(user, values) {
  values = values || {};
  var securityKeys = ['passwordSalt', 'passwordHash', 'role', 'active', 'failedAttempts', 'lockedUntil', 'sessionVersion', 'forcePasswordChange'];
  values.updatedAt = new Date();
  var touchesSecurity = securityKeys.some(function (key) { return Object.prototype.hasOwnProperty.call(values, key); });
  if (touchesSecurity) {
    // Columns D:N form one contiguous credential/state block through the
    // update timestamp. Supplying unchanged values makes updateMappedRow_
    // commit that block in one write,
    // preventing a new hash from being stored without its session version or
    // forced-change flag.
    var completeSecurityBlock = {};
    securityKeys.concat(['lastLoginAt', 'createdAt', 'updatedAt']).forEach(function (key) {
      completeSecurityBlock[key] = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : user[key];
    });
    Object.keys(values).forEach(function (key) { completeSecurityBlock[key] = values[key]; });
    values = completeSecurityBlock;
  }
  updateMappedRow_('USERS', user.rowNumber, values);
  var updated = {};
  Object.keys(user).forEach(function (key) { updated[key] = user[key]; });
  Object.keys(values).forEach(function (key) { updated[key] = values[key]; });
  return updated;
}

function publicUser_(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    lockedUntil: isoDate_(user.lockedUntil),
    forcePasswordChange: user.forcePasswordChange,
    lastLoginAt: isoDate_(user.lastLoginAt),
    createdAt: isoDate_(user.createdAt),
    updatedAt: isoDate_(user.updatedAt)
  };
}

function itemFromTableRow_(table, entry) {
  var row = entry.values;
  return {
    rowNumber: entry.rowNumber,
    id: readCellText_(rowValue_(table, row, 'id')),
    code: readCellText_(rowValue_(table, row, 'code')),
    name: readCellText_(rowValue_(table, row, 'name')),
    owner: readCellText_(rowValue_(table, row, 'owner')),
    unit: readCellText_(rowValue_(table, row, 'unit')),
    openingQuantity: Number(rowValue_(table, row, 'openingQuantity')) || 0,
    reorderLevel: Number(rowValue_(table, row, 'reorderLevel')) || 0,
    active: rowValue_(table, row, 'active') === true || String(rowValue_(table, row, 'active')).toLowerCase() === 'true',
    createdAt: rowValue_(table, row, 'createdAt') || null,
    updatedAt: rowValue_(table, row, 'updatedAt') || null,
    createdBy: readCellText_(rowValue_(table, row, 'createdBy')),
    updatedBy: readCellText_(rowValue_(table, row, 'updatedBy'))
  };
}

function allItemRecords_() {
  var table = schemaTable_('ITEMS');
  // Formatting/default template rows are not records. App-created inventory
  // items always have a server-generated identity.
  return table.rows.filter(function (entry) {
    return !!readCellText_(rowValue_(table, entry.values, 'id'));
  }).map(function (entry) { return itemFromTableRow_(table, entry); });
}

function findItemById_(id) {
  var target = String(id || '');
  var items = allItemRecords_();
  for (var i = 0; i < items.length; i += 1) if (items[i].id === target) return items[i];
  return null;
}

function findItemByCode_(code) {
  var target = normalizeItemCode_(code);
  var items = allItemRecords_();
  for (var i = 0; i < items.length; i += 1) if (items[i].code === target) return items[i];
  return null;
}

function appendItemRecord_(record) {
  record.rowNumber = appendMappedRow_('ITEMS', record);
  return record;
}

function appendItemRecords_(records) {
  var rowNumbers = appendMappedRows_('ITEMS', records);
  records.forEach(function (record, index) { record.rowNumber = rowNumbers[index]; });
  return records;
}

function updateItemFields_(item, values) {
  values.updatedAt = new Date();
  updateMappedRow_('ITEMS', item.rowNumber, values);
  var updated = {};
  Object.keys(item).forEach(function (key) { updated[key] = item[key]; });
  Object.keys(values).forEach(function (key) { updated[key] = values[key]; });
  return updated;
}

function movementFromTableRow_(table, entry) {
  var row = entry.values;
  return {
    rowNumber: entry.rowNumber,
    id: readCellText_(rowValue_(table, row, 'id')),
    clientRequestId: readCellText_(rowValue_(table, row, 'clientRequestId')),
    timestamp: rowValue_(table, row, 'timestamp') || null,
    documentDate: rowValue_(table, row, 'documentDate') || null,
    type: readCellText_(rowValue_(table, row, 'type')),
    itemId: readCellText_(rowValue_(table, row, 'itemId')),
    itemCode: readCellText_(rowValue_(table, row, 'itemCode')),
    itemName: readCellText_(rowValue_(table, row, 'itemName')),
    quantity: Number(rowValue_(table, row, 'quantity')) || 0,
    netChange: Number(rowValue_(table, row, 'netChange')) || 0,
    balanceBefore: Number(rowValue_(table, row, 'balanceBefore')) || 0,
    balanceAfter: Number(rowValue_(table, row, 'balanceAfter')) || 0,
    party: readCellText_(rowValue_(table, row, 'party')),
    reference: readCellText_(rowValue_(table, row, 'reference')),
    notes: readCellText_(rowValue_(table, row, 'notes')),
    originalMovementId: readCellText_(rowValue_(table, row, 'originalMovementId')),
    actorId: readCellText_(rowValue_(table, row, 'actorId')),
    actorUsername: readCellText_(rowValue_(table, row, 'actorUsername')),
    actorDisplayName: readCellText_(rowValue_(table, row, 'actorDisplayName'))
  };
}

function allMovementRecords_() {
  var table = schemaTable_('MOVEMENTS');
  // Ignore preformatted/template rows that contain defaults but no ledger ID.
  return table.rows.filter(function (entry) {
    return !!readCellText_(rowValue_(table, entry.values, 'id'));
  }).map(function (entry) { return movementFromTableRow_(table, entry); });
}

function findMovementById_(id) {
  var target = String(id || '');
  var movements = allMovementRecords_();
  for (var i = 0; i < movements.length; i += 1) if (movements[i].id === target) return movements[i];
  return null;
}

function appendMovementRecord_(record) {
  record.rowNumber = appendMappedRow_('MOVEMENTS', record);
  return record;
}

function appendAuditRecord_(input) {
  var actor = input.actor || {};
  var details = input.details === undefined ? {} : input.details;
  var serialized;
  try { serialized = JSON.stringify(details); } catch (ignored) { serialized = '{}'; }
  if (serialized.length > 5000) serialized = serialized.substring(0, 4997) + '...';
  return appendMappedRow_('AUDIT', {
    id: newId_('AUD'),
    timestamp: new Date(),
    actorId: actor.id || '',
    actorUsername: actor.username || '',
    actorDisplayName: actor.displayName || '',
    action: input.action || 'UNKNOWN',
    entityType: input.entityType || '',
    entityId: input.entityId || '',
    status: input.status || 'SUCCESS',
    details: serialized
  });
}

function getSettingValue_(key) {
  var table = schemaTable_('SETTINGS');
  for (var i = 0; i < table.rows.length; i += 1) {
    if (readCellText_(rowValue_(table, table.rows[i].values, 'key')) === key) {
      return readCellText_(rowValue_(table, table.rows[i].values, 'value'));
    }
  }
  return null;
}

function setSettingValue_(key, value, type, description, actor) {
  var table = schemaTable_('SETTINGS');
  var values = {
    key: requireText_(key, 'مفتاح الإعداد', 100, false),
    value: value === null || value === undefined ? '' : String(value),
    type: type || 'TEXT',
    description: description || '',
    updatedAt: new Date(),
    updatedBy: actor || 'SYSTEM'
  };
  for (var i = 0; i < table.rows.length; i += 1) {
    if (readCellText_(rowValue_(table, table.rows[i].values, 'key')) === key) {
      updateMappedRow_('SETTINGS', table.rows[i].rowNumber, values);
      return;
    }
  }
  appendMappedRow_('SETTINGS', values);
}
