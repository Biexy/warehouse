/** One-time, idempotent import for the 76-item catalog supplied by the owner. */

var PROVIDED_CATALOG_COMPLETED_PROPERTY_ = 'WAREHOUSE_PROVIDED_CATALOG_IMPORT_COMPLETED';

var PROVIDED_CATALOG_ = Object.freeze([
  { code: 'ITEM001', name: 'Stainless steel 316L Elbow 14" dia, 90 deg. Sch 10S', openingQuantity: 27, owner: 'سلطة المياه' },
  { code: 'ITEM002', name: 'Stainless steel 316L Elbow 12" dia, 90 deg. Sch 10S', openingQuantity: 2, owner: 'سلطة المياه' },
  { code: 'ITEM003', name: 'Stainless steel 316L Elbow 10" dia, 90 deg. Sch 10S', openingQuantity: 13, owner: 'مصلحة المياه' },
  { code: 'ITEM004', name: 'Stainless steel Tee 316L 14"X14"X14" dia, Sch 10S', openingQuantity: 12, owner: 'سلطة المياه' },
  { code: 'ITEM005', name: 'Stainless steel Tee 316L 14"X14"X8" dia, Sch 10S', openingQuantity: 1, owner: 'مصلحة المياه' },
  { code: 'ITEM006', name: 'Stainless steel Tee 316L 14"X14"X12" dia, Sch 10S', openingQuantity: 1, owner: 'سلطة المياه' },
  { code: 'ITEM007', name: 'Stainless steel Tee 316L 12"X12"X12" dia, Sch 10S', openingQuantity: 6, owner: 'مصلحة المياه' },
  { code: 'ITEM008', name: 'Stainless steel Flange DN500, PN 16 dia, Flange drilling EN 1092-1', openingQuantity: 5, owner: 'سلطة المياه' },
  { code: 'ITEM009', name: 'Stainless steel Flange DN400, PN 16 dia, Flange drilling EN 1092-1', openingQuantity: 6, owner: 'مصلحة المياه' },
  { code: 'ITEM010', name: 'Stainless steel Flange DN350, PN 25, Flange drilling EN 1092-1', openingQuantity: 22, owner: 'سلطة المياه' },
  { code: 'ITEM011', name: 'Stainless steel Flange DN350, PN 16, Flange drilling EN 1092-1', openingQuantity: 29, owner: 'مصلحة المياه' },
  { code: 'ITEM012', name: 'Stainless steel Flange DN300, PN 25, Flange drilling EN 1092-1', openingQuantity: 4, owner: 'سلطة المياه' },
  { code: 'ITEM013', name: 'Stainless steel Flange DN300, PN 16, Flange drilling EN 1092-1', openingQuantity: 1, owner: 'مصلحة المياه' },
  { code: 'ITEM014', name: 'Stainless steel Flange DN250, PN 25, Flange drilling EN 1092-1', openingQuantity: 3, owner: 'سلطة المياه' },
  { code: 'ITEM015', name: 'Stainless steel Flange DN250, PN 16, Flange drilling EN 1092-1', openingQuantity: 5, owner: 'مصلحة المياه' },
  { code: 'ITEM016', name: 'Stainless steel Flange DN150, PN 16, Flange drilling EN 1092-1', openingQuantity: 27, owner: 'سلطة المياه' },
  { code: 'ITEM017', name: 'Stainless steel Flange DN100, PN 16, Flange drilling EN 1092-1', openingQuantity: 33, owner: 'مصلحة المياه' },
  { code: 'ITEM018', name: 'Stainless steel Flange DN50, PN 16, Flange drilling EN 1092-1', openingQuantity: 17, owner: 'سلطة المياه' },
  { code: 'ITEM019', name: 'Dismantling Joint DN400, EN1092/PN25', openingQuantity: 2, owner: 'مصلحة المياه' },
  { code: 'ITEM020', name: 'Dismantling Joint DN400, EN1092/PN16', openingQuantity: 5, owner: 'سلطة المياه' },
  { code: 'ITEM021', name: 'Dismantling Joint DN350, EN1092/PN25', openingQuantity: 10, owner: 'مصلحة المياه' },
  { code: 'ITEM022', name: 'Dismantling Joint DN350, EN1092/PN16', openingQuantity: 14, owner: 'سلطة المياه' },
  { code: 'ITEM023', name: 'Dismantling Joint DN300, EN1092/PN25', openingQuantity: 4, owner: 'مصلحة المياه' },
  { code: 'ITEM024', name: 'Dismantling Joint DN300, EN1092/PN16', openingQuantity: 2, owner: 'سلطة المياه' },
  { code: 'ITEM025', name: 'Dismantling Joint DN250, EN1092/PN16', openingQuantity: 5, owner: 'مصلحة المياه' },
  { code: 'ITEM026', name: 'Dismantling Joint DN200, EN1092/PN25', openingQuantity: 1, owner: 'سلطة المياه' },
  { code: 'ITEM027', name: 'Dismantling Joint DN200, EN1092/PN16', openingQuantity: 1, owner: 'مصلحة المياه' },
  { code: 'ITEM028', name: 'Dismantling Joint DN150, EN1092/PN16', openingQuantity: 31, owner: 'سلطة المياه' },
  { code: 'ITEM029', name: 'Dismantling Joint DN100, EN1092/PN16', openingQuantity: 31, owner: 'مصلحة المياه' },
  { code: 'ITEM030', name: 'Dismantling Joint DN50, EN1092/PN16', openingQuantity: 3, owner: 'سلطة المياه' },
  { code: 'ITEM031', name: 'Triple Air Release Valve DN65 , PN16', openingQuantity: 36, owner: 'مصلحة المياه' },
  { code: 'ITEM032', name: 'Gate Valve DN 200 mm, EN1092/PN16', openingQuantity: 2, owner: 'سلطة المياه' },
  { code: 'ITEM033', name: 'Gate Valve DN 150 mm, EN1092/PN16', openingQuantity: 22, owner: 'مصلحة المياه' },
  { code: 'ITEM034', name: 'Gate Valve DN 100 mm, EN1092/PN16', openingQuantity: 33, owner: 'سلطة المياه' },
  { code: 'ITEM035', name: 'Gate Valve DN 65 mm, EN1092/PN16', openingQuantity: 15, owner: 'مصلحة المياه' },
  { code: 'ITEM036', name: 'Gate Valve DN 50 mm, EN1092/PN16', openingQuantity: 39, owner: 'سلطة المياه' },
  { code: 'ITEM037', name: 'Double Eccentric Flanged Butterfly Valve DN 350, PN16', openingQuantity: 22, owner: 'مصلحة المياه' },
  { code: 'ITEM038', name: 'Double Eccentric Flanged Butterfly Valve DN 250, PN16', openingQuantity: 1, owner: 'سلطة المياه' },
  { code: 'ITEM039', name: 'Tilting Check Valve DN 400, PN16', openingQuantity: 4, owner: 'مصلحة المياه' },
  { code: 'ITEM040', name: 'Tilting Check Valve DN 350, PN16', openingQuantity: 4, owner: 'سلطة المياه' },
  { code: 'ITEM041', name: 'Tilting Check Valve DN 300, PN16', openingQuantity: 6, owner: 'مصلحة المياه' },
  { code: 'ITEM042', name: 'Tilting Check Valve DN 250, PN16', openingQuantity: 3, owner: 'سلطة المياه' },
  { code: 'ITEM043', name: 'Reducer 65 to 50', openingQuantity: 16, owner: 'مصلحة المياه' },
  { code: 'ITEM044', name: 'Hydro cyclon DN100', openingQuantity: 1, owner: 'سلطة المياه' },
  { code: 'ITEM045', name: 'Hydro cyclon DN150', openingQuantity: 1, owner: 'مصلحة المياه' },
  { code: 'ITEM046', name: 'Guide for Submersible mixer', openingQuantity: 21, owner: 'سلطة المياه' },
  { code: 'ITEM047', name: 'Submersible mixer for reservoir', openingQuantity: 8, owner: 'مصلحة المياه' },
  { code: 'ITEM048', name: 'Derek crane of Submersible mixer', openingQuantity: 8, owner: 'سلطة المياه' },
  { code: 'ITEM049', name: 'Automatic Control Valve DN300,PN16', openingQuantity: 1, owner: 'مصلحة المياه' },
  { code: 'ITEM050', name: 'Automatic Control Valve DN300,PN25', openingQuantity: 2, owner: 'سلطة المياه' },
  { code: 'ITEM051', name: 'Automatic Control Valve DN250,PN16', openingQuantity: 1, owner: 'مصلحة المياه' },
  { code: 'ITEM052', name: 'LABS.010 , Float Switch', openingQuantity: 20, owner: 'سلطة المياه' },
  { code: 'ITEM053', name: 'Flow Cell Short Tipe', openingQuantity: 95, owner: 'مصلحة المياه' },
  { code: 'ITEM054', name: 'ANCHL-M , Chloride Combination Electrode', openingQuantity: 24, owner: 'سلطة المياه' },
  { code: 'ITEM055', name: 'ANPH-M , Digital PH Sensor', openingQuantity: 24, owner: 'مصلحة المياه' },
  { code: 'ITEM056', name: 'ANEC2000 , Conductivity Transmitter', openingQuantity: 24, owner: 'سلطة المياه' },
  { code: 'ITEM057', name: 'ACLS , Digital Residual Chlorine Sensor', openingQuantity: 31, owner: 'مصلحة المياه' },
  { code: 'ITEM058', name: 'Flow Cell Long Tipe', openingQuantity: 31, owner: 'سلطة المياه' },
  { code: 'ITEM059', name: 'LULT420.06 , UltraSonic Level Transmitter', openingQuantity: 2, owner: 'مصلحة المياه' },
  { code: 'ITEM060', name: 'ECKS-1000-ss , Conductivity Sensor', openingQuantity: 32, owner: 'سلطة المياه' },
  { code: 'ITEM061', name: 'MPS3200.420.007 , Pressure transmitter', openingQuantity: 74, owner: 'مصلحة المياه' },
  { code: 'ITEM062', name: 'Ball valve for Pressure transmitter "item 61"', openingQuantity: 43, owner: 'سلطة المياه' },
  { code: 'ITEM063', name: 'ANNO3-M , Digital Nitrate Sensor', openingQuantity: 24, owner: 'مصلحة المياه' },
  { code: 'ITEM064', name: 'LPRS80 , Radar Level Transmitter', openingQuantity: 8, owner: 'سلطة المياه' },
  { code: 'ITEM065', name: 'ANEC-M , Digital Conductivity Sensor', openingQuantity: 19, owner: 'مصلحة المياه' },
  { code: 'ITEM066', name: 'MPS580.420 , Level Transmitter', openingQuantity: 13, owner: 'سلطة المياه' },
  { code: 'ITEM067', name: 'EMDE.RM.0500.16.00.01.AC , Flow Meter DN500', openingQuantity: 2, owner: 'مصلحة المياه' },
  { code: 'ITEM068', name: 'EMDE.RM.0400.16.00.01.AC , Flow Meter DN400', openingQuantity: 2, owner: 'سلطة المياه' },
  { code: 'ITEM069', name: 'EMDE.RM.0350.16.00.01.AC , Flow Meter DN350', openingQuantity: 5, owner: 'مصلحة المياه' },
  { code: 'ITEM070', name: 'EMDE.RM.0300.16.00.01.AC , Flow Meter DN300', openingQuantity: 3, owner: 'سلطة المياه' },
  { code: 'ITEM071', name: 'EMDE.RM.0250.16.00.01.AC , FlowMeter DN250', openingQuantity: 7, owner: 'مصلحة المياه' },
  { code: 'ITEM072', name: 'EMDE.RM.0200.16.00.01.AC , FlowMeter DN200', openingQuantity: 3, owner: 'سلطة المياه' },
  { code: 'ITEM073', name: 'EMDE.RM.0150.16.00.01.AC , FlowMeter DN150', openingQuantity: 15, owner: 'مصلحة المياه' },
  { code: 'ITEM074', name: 'EMDE.RM.0100.16.00.01.AC , FlowMeter DN100', openingQuantity: 21, owner: 'سلطة المياه' },
  { code: 'ITEM075', name: 'RTU PLC Panel', openingQuantity: 1, owner: 'مصلحة المياه' },
  { code: 'ITEM076', name: 'Motor Control Board ( MCC Panel ) "VFD without HMI"', openingQuantity: 1, owner: 'مصلحة المياه' }
]);

/** importProvidedCatalog(token) -> idempotent result summary. */
function importProvidedCatalog(token) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN']);
    ensureRepositorySchemaCurrent_();
    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN']);
      var catalog = validateProvidedCatalog_();
      // Fail before the catalog write if either destination schema is broken.
      schemaMetadata_('ITEMS');
      preflightAuthAudit_();

      var existingItems = allItemRecords_();
      var existingByCode = Object.create(null);
      var existingByName = Object.create(null);
      existingItems.forEach(function (item) {
        var key = normalizeItemCode_(item.code);
        if (existingByCode[key]) {
          throw new WarehouseError_('ITEM_DATA_INVALID', 'يوجد رمز صنف مكرر في ورقة الأصناف: ' + key);
        }
        existingByCode[key] = item;
        var nameKey = normalizeCatalogText_(item.name);
        if (nameKey) {
          if (!existingByName[nameKey]) existingByName[nameKey] = [];
          existingByName[nameKey].push(item);
        }
      });

      var now = new Date();
      var created = [];
      var skipped = [];
      catalog.forEach(function (entry) {
        var existingByMatchingCode = existingByCode[entry.code] || null;
        var matchingNames = existingByName[normalizeCatalogText_(entry.name)] || [];
        var existingByMatchingName = matchingNames.length ? matchingNames[0] : null;
        var existing = existingByMatchingCode || existingByMatchingName;
        if (existing) {
          var sameRowForCodeAndName = !existingByMatchingCode || !existingByMatchingName || existingByMatchingCode.id === existingByMatchingName.id;
          var duplicateNameConflict = matchingNames.length > 1 || !existingByMatchingCode || !sameRowForCodeAndName;
          skipped.push({
            code: entry.code,
            existingCode: existing.code,
            existingName: existing.name,
            existingOwner: existing.owner || 'غير محدد',
            duplicateNameConflict: duplicateNameConflict,
            matchesCatalog: !duplicateNameConflict && catalogEntryMatchesItem_(entry, existing)
          });
          return;
        }
        created.push({
          id: newId_('ITM'),
          code: entry.code,
          name: entry.name,
          owner: entry.owner,
          unit: 'قطعة',
          openingQuantity: entry.openingQuantity,
          reorderLevel: 0,
          active: true,
          createdAt: now,
          updatedAt: now,
          createdBy: session.user.username,
          updatedBy: session.user.username
        });
      });

      if (created.length) appendItemRecords_(created);
      var auditWarning = '';
      if (created.length) {
        auditWarning = appendCommittedInventoryAudit_({
          actor: session.user,
          action: 'PROVIDED_CATALOG_IMPORT',
          entityType: 'ITEM_CATALOG',
          entityId: 'ITEM001-ITEM076',
          status: 'SUCCESS',
          details: {
            catalogTotal: catalog.length,
            created: created.length,
            skipped: skipped.length,
            conflicts: skipped.filter(function (entry) { return !entry.matchesCatalog; }).length,
            owners: catalogOwners_(catalog)
          }
        });
      }

      var conflictingCodes = skipped.filter(function (entry) { return !entry.matchesCatalog; }).map(function (entry) { return entry.code; });
      var completed = conflictingCodes.length === 0 && created.length + skipped.length === catalog.length;
      if (completed) {
        PropertiesService.getScriptProperties().setProperty(PROVIDED_CATALOG_COMPLETED_PROPERTY_, 'true');
      }

      return {
        catalogTotal: catalog.length,
        created: created.length,
        skipped: skipped.length,
        skippedCodes: skipped.map(function (entry) { return entry.code; }),
        conflictingCodes: conflictingCodes,
        completed: completed,
        owners: catalogOwners_(catalog),
        unit: 'قطعة',
        reorderLevel: 0,
        duplicateCodesInProvidedCatalog: [],
        duplicateNamesInProvidedCatalog: [],
        auditWarning: auditWarning || null
      };
    });
  });
}

function validateProvidedCatalog_() {
  if (PROVIDED_CATALOG_.length !== 76) {
    throw new WarehouseError_('CATALOG_DATA_INVALID', 'يجب أن تحتوي القائمة الجاهزة على 76 صنفاً بالضبط.');
  }
  var codes = Object.create(null);
  var names = Object.create(null);
  return PROVIDED_CATALOG_.map(function (row, index) {
    var code = normalizeItemCode_(row.code);
    var expectedCode = 'ITEM' + String(index + 1).padStart(3, '0');
    var name = requireText_(row.name, 'اسم الصنف', 160, false);
    var owner = requireText_(row.owner, 'المالك', 100, false);
    var quantity = roundQuantity_(requireFiniteNumber_(row.openingQuantity, 'الرصيد الافتتاحي', 0, MAX_QUANTITY_));
    var nameKey = normalizeCatalogText_(name);
    if (code !== expectedCode) throw new WarehouseError_('CATALOG_DATA_INVALID', 'تسلسل رمز القائمة غير صالح عند ' + expectedCode + '.');
    if (codes[code]) throw new WarehouseError_('CATALOG_DATA_INVALID', 'يوجد رمز مكرر داخل القائمة الجاهزة: ' + code);
    if (names[nameKey]) throw new WarehouseError_('CATALOG_DATA_INVALID', 'يوجد اسم صنف مكرر داخل القائمة الجاهزة: ' + name);
    if (owner !== 'سلطة المياه' && owner !== 'مصلحة المياه') {
      throw new WarehouseError_('CATALOG_DATA_INVALID', 'قيمة المالك غير معروفة للصنف ' + code + '.');
    }
    codes[code] = true;
    names[nameKey] = true;
    return { code: code, name: name, owner: owner, openingQuantity: quantity };
  });
}

function catalogOwners_(catalog) {
  var seen = Object.create(null);
  (catalog || []).forEach(function (entry) { if (entry.owner) seen[entry.owner] = true; });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
}

function catalogEntryMatchesItem_(entry, item) {
  return normalizeItemCode_(item.code) === entry.code &&
    normalizeCatalogText_(item.name) === normalizeCatalogText_(entry.name) &&
    normalizeCatalogText_(item.owner || '') === normalizeCatalogText_(entry.owner) &&
    normalizeCatalogText_(item.unit || '') === normalizeCatalogText_('قطعة') &&
    roundQuantity_(Number(item.openingQuantity) || 0) === entry.openingQuantity &&
    roundQuantity_(Number(item.reorderLevel) || 0) === 0 &&
    item.active === true;
}

/**
 * Completion is durable after a successful import. For older installations
 * that predate the marker, derive the state without mutating Script Properties.
 */
function catalogImportCompleted_() {
  var stored = PropertiesService.getScriptProperties().getProperty(PROVIDED_CATALOG_COMPLETED_PROPERTY_);
  if (stored === 'true') return true;
  try {
    return providedCatalogMatchesItems_(validateProvidedCatalog_(), allItemRecords_());
  } catch (error) {
    return false;
  }
}

function providedCatalogMatchesItems_(catalog, items) {
  var byCode = Object.create(null);
  var byName = Object.create(null);
  var invalidCode = Object.create(null);
  (items || []).forEach(function (item) {
    var code = normalizeItemCode_(item.code);
    var name = normalizeCatalogText_(item.name);
    if (byCode[code]) invalidCode[code] = true;
    else byCode[code] = item;
    if (name) {
      if (!byName[name]) byName[name] = [];
      byName[name].push(item);
    }
  });
  return (catalog || []).every(function (entry) {
    var item = byCode[entry.code];
    var matchingNames = byName[normalizeCatalogText_(entry.name)] || [];
    return !!item && !invalidCode[entry.code] && matchingNames.length === 1 && matchingNames[0].id === item.id && catalogEntryMatchesItem_(entry, item);
  });
}

function normalizeCatalogText_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}
