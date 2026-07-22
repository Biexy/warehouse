/** Validated administrator-only bulk item import from CSV/XLSX previews. */

var ITEM_FILE_IMPORT_MAX_ROWS_ = 500;

function previewItemFileImport(token, rows) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN']);
    ensureRepositorySchemaCurrent_();
    return buildItemFileImportPreview_(rows, allItemRecords_());
  });
}

function commitItemFileImport(token, rows) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN']);
    ensureRepositorySchemaCurrent_();
    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN']);
      preflightInventoryMutation_('ITEMS');
      var preview = buildItemFileImportPreview_(rows, allItemRecords_());
      if (preview.invalid > 0 || preview.conflicts > 0) {
        throw new WarehouseError_('ITEM_IMPORT_NOT_READY', 'تعذر الاستيراد. أصلح الصفوف الخاطئة والمتعارضة ثم أعد المعاينة.', {
          invalid: preview.invalid,
          conflicts: preview.conflicts
        });
      }

      var now = new Date();
      var created = preview.rows.filter(function (row) { return row.status === 'NEW'; }).map(function (row) {
        return {
          id: newId_('ITM'),
          code: row.item.code,
          name: row.item.name,
          owner: row.item.owner,
          unit: row.item.unit,
          openingQuantity: row.item.openingQuantity,
          reorderLevel: row.item.reorderLevel,
          active: true,
          createdAt: now,
          updatedAt: now,
          createdBy: session.user.username,
          updatedBy: session.user.username
        };
      });
      if (created.length) appendItemRecords_(created);

      var auditWarning = '';
      if (created.length) {
        auditWarning = appendCommittedInventoryAudit_({
          actor: session.user,
          action: 'ITEM_FILE_IMPORT',
          entityType: 'ITEM_CATALOG',
          entityId: 'FILE-' + now.getTime(),
          status: 'SUCCESS',
          details: {
            rowsReceived: preview.total,
            created: created.length,
            skippedExisting: preview.existing,
            codes: created.slice(0, 100).map(function (item) { return item.code; })
          }
        });
      }
      return {
        total: preview.total,
        created: created.length,
        skippedExisting: preview.existing,
        completed: true,
        auditWarning: auditWarning || null
      };
    });
  });
}

function buildItemFileImportPreview_(rows, existingItems) {
  if (!Array.isArray(rows)) throw new WarehouseError_('ITEM_IMPORT_INVALID', 'بيانات ملف الأصناف غير صالحة.');
  if (!rows.length) throw new WarehouseError_('ITEM_IMPORT_EMPTY', 'لا يحتوي الملف على أصناف.');
  if (rows.length > ITEM_FILE_IMPORT_MAX_ROWS_) {
    throw new WarehouseError_('ITEM_IMPORT_TOO_LARGE', 'الحد الأقصى للاستيراد الواحد هو ' + ITEM_FILE_IMPORT_MAX_ROWS_ + ' صنف.');
  }

  var existingByCode = Object.create(null);
  var existingByName = Object.create(null);
  (existingItems || []).forEach(function (item) {
    existingByCode[normalizeItemCode_(item.code)] = item;
    var nameKey = normalizeCatalogText_(item.name);
    if (nameKey) existingByName[nameKey] = item;
  });

  var fileCodes = Object.create(null);
  var fileNames = Object.create(null);
  var normalizedRows = rows.map(function (raw, index) {
    var rowNumber = index + 2;
    try {
      raw = requireObject_(raw, 'صف الاستيراد');
      var item = {
        code: normalizeItemCode_(raw.code),
        name: requireText_(raw.name, 'اسم الصنف', 160, false),
        owner: requireText_(raw.owner, 'المالك', 100, false),
        unit: requireText_(raw.unit || 'قطعة', 'الوحدة', 40, false),
        openingQuantity: roundQuantity_(requireFiniteNumber_(raw.openingQuantity === '' || raw.openingQuantity === undefined ? 0 : raw.openingQuantity, 'الرصيد الافتتاحي', 0, MAX_QUANTITY_)),
        reorderLevel: roundQuantity_(requireFiniteNumber_(raw.reorderLevel === '' || raw.reorderLevel === undefined ? 0 : raw.reorderLevel, 'حد إعادة الطلب', 0, MAX_QUANTITY_))
      };
      var nameKey = normalizeCatalogText_(item.name);
      if (fileCodes[item.code]) throw new WarehouseError_('DUPLICATE_IMPORT_CODE', 'الكود مكرر داخل الملف مع الصف ' + fileCodes[item.code] + '.');
      if (fileNames[nameKey]) throw new WarehouseError_('DUPLICATE_IMPORT_NAME', 'اسم الصنف مكرر داخل الملف مع الصف ' + fileNames[nameKey] + '.');
      fileCodes[item.code] = rowNumber;
      fileNames[nameKey] = rowNumber;

      var codeMatch = existingByCode[item.code] || null;
      var nameMatch = existingByName[nameKey] || null;
      if (codeMatch || nameMatch) {
        var sameExisting = (!codeMatch || !nameMatch || codeMatch.id === nameMatch.id);
        var exact = sameExisting && codeMatch &&
          normalizeCatalogText_(codeMatch.name) === nameKey &&
          normalizeCatalogText_(codeMatch.owner || '') === normalizeCatalogText_(item.owner) &&
          normalizeCatalogText_(codeMatch.unit || '') === normalizeCatalogText_(item.unit) &&
          roundQuantity_(Number(codeMatch.openingQuantity) || 0) === item.openingQuantity &&
          roundQuantity_(Number(codeMatch.reorderLevel) || 0) === item.reorderLevel;
        if (exact) return { rowNumber: rowNumber, status: 'EXISTING', item: item, message: 'موجود مسبقًا بنفس البيانات.' };
        return { rowNumber: rowNumber, status: 'CONFLICT', item: item, message: codeMatch ? 'الكود موجود مسبقًا ببيانات مختلفة.' : 'اسم الصنف موجود مسبقًا بكود مختلف.' };
      }
      return { rowNumber: rowNumber, status: 'NEW', item: item, message: 'جاهز للإضافة.' };
    } catch (error) {
      return {
        rowNumber: rowNumber,
        status: 'INVALID',
        item: {
          code: raw && raw.code || '',
          name: raw && raw.name || '',
          owner: raw && raw.owner || '',
          unit: raw && raw.unit || '',
          openingQuantity: raw && raw.openingQuantity,
          reorderLevel: raw && raw.reorderLevel
        },
        message: error && error.message || 'صف غير صالح.'
      };
    }
  });

  return {
    total: normalizedRows.length,
    valid: normalizedRows.filter(function (row) { return row.status === 'NEW' || row.status === 'EXISTING'; }).length,
    newItems: normalizedRows.filter(function (row) { return row.status === 'NEW'; }).length,
    existing: normalizedRows.filter(function (row) { return row.status === 'EXISTING'; }).length,
    conflicts: normalizedRows.filter(function (row) { return row.status === 'CONFLICT'; }).length,
    invalid: normalizedRows.filter(function (row) { return row.status === 'INVALID'; }).length,
    canCommit: normalizedRows.some(function (row) { return row.status === 'NEW'; }) &&
      !normalizedRows.some(function (row) { return row.status === 'INVALID' || row.status === 'CONFLICT'; }),
    rows: normalizedRows
  };
}
