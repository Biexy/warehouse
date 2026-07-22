/** Inventory, dashboard, item, and append-only movement APIs. */

var DASHBOARD_CONFIG_ = Object.freeze({
  DEFAULT_DAYS: 30,
  ALLOWED_DAYS: [7, 30, 90],
  RECENT_LIMIT: 10,
  URGENT_LIMIT: 12,
  STOCK_SERIES_LIMIT: 12,
  BOOTSTRAP_CATALOG_LIMIT: 50
});

// Six decimal places remain distinguishable throughout the supported range.
// Keep both individual quantities and resulting balances within this bound.
var QUANTITY_SCALE_ = 1000000;
var MAX_QUANTITY_ = 1000000000;
var QUANTITY_EPSILON_ = 1 / QUANTITY_SCALE_;
var ITEM_LIST_STATUSES_ = ['ALL', 'ACTIVE', 'INACTIVE', 'LOW', 'OUT', 'AVAILABLE', 'OK'];
var MOVEMENT_LIST_TYPES_ = ['ALL', 'IN', 'OUT', 'REVERSAL'];

/**
 * getBootstrap(token) -> {user,permissions,dashboard,items,recentMovements,settings}
 * Forced-password sessions receive only the identity and permissions needed
 * to render the blocking password-change screen.
 */
function getBootstrap(token) {
  return apiResult_(function () {
    var session = requireSession_(token, null, { allowPasswordChange: true });
    var permissions = permissionsForRole_(session.user.role);
    if (session.user.forcePasswordChange) {
      return {
        user: publicUser_(session.user),
        permissions: permissions,
        passwordChangeRequired: true,
        dashboard: null,
        items: [],
        owners: [],
        itemCatalog: { total: 0, returned: 0, truncated: false, limit: DASHBOARD_CONFIG_.BOOTSTRAP_CATALOG_LIMIT, unavailableUntilPasswordChange: true },
        recentMovements: [],
        settings: publicSettings_()
      };
    }
    ensureRepositorySchemaCurrent_();
    var data = inventorySnapshot_(DASHBOARD_CONFIG_.DEFAULT_DAYS);
    var dashboard = dashboardFromSnapshot_(data);
    var catalog = bootstrapItemCatalog_(data);
    return {
      user: publicUser_(session.user),
      permissions: permissions,
      passwordChangeRequired: false,
      dashboard: dashboard,
      items: catalog.items,
      owners: catalogOwnerOptions_(data.items),
      itemCatalog: catalog.metadata,
      recentMovements: dashboard.recentMovements,
      settings: publicSettings_()
    };
  });
}

/**
 * Keep small catalogs complete. For larger data sets, send only the first 50
 * active options; listItems remains the authoritative paginated/search API.
 */
function bootstrapItemCatalog_(data) {
  var limit = DASHBOARD_CONFIG_.BOOTSTRAP_CATALOG_LIMIT;
  var allItems = data.items.map(function (item) {
    return publicItem_(item, data.balances[item.id] || 0, data.itemStats[item.id]);
  }).sort(function (a, b) {
    return a.code.localeCompare(b.code) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  var activeItems = allItems.filter(function (item) { return item.active; });
  var returnedItems = allItems.length <= limit ? allItems : activeItems.slice(0, limit);
  return {
    items: returnedItems,
    metadata: {
      total: allItems.length,
      activeTotal: activeItems.length,
      returned: returnedItems.length,
      truncated: returnedItems.length < allItems.length,
      limit: limit,
      mode: allItems.length <= limit ? 'COMPLETE' : 'ACTIVE_CAPPED',
      sort: 'CODE_NAME_ID'
    }
  };
}

/**
 * getDashboard(token,{days?:7|30|90}) -> capped, chart-ready inventory analytics.
 * Items and movements are each read once, then aggregated in memory.
 */
function getDashboard(token, params) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN', 'STOREKEEPER', 'AUDITOR']);
    ensureRepositorySchemaCurrent_();
    var days = normalizeDashboardDays_(params && params.days);
    return dashboardFromSnapshot_(inventorySnapshot_(days));
  });
}

/** listItems(token,{query,status,owner,page,pageSize}) -> paginated stock items. */
function listItems(token, params) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN', 'STOREKEEPER', 'AUDITOR']);
    ensureRepositorySchemaCurrent_();
    var listing = inventoryListing_(params);
    var start = (listing.paging.page - 1) * listing.paging.pageSize;
    return {
      items: listing.items.slice(start, start + listing.paging.pageSize),
      page: listing.paging.page,
      pageSize: listing.paging.pageSize,
      total: listing.items.length,
      owners: listing.owners,
      hasMore: start + listing.paging.pageSize < listing.items.length
    };
  });
}

/**
 * getInventoryReport(token,{query,status,owner}) -> complete filtered stock
 * report. Unlike listItems this intentionally returns every matching item for
 * CSV/PDF reports; the interactive table remains paginated.
 */
function getInventoryReport(token, params) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN', 'STOREKEEPER', 'AUDITOR']);
    ensureRepositorySchemaCurrent_();
    var listing = inventoryListing_(params);
    var snapshot = listing.snapshot;
    var allMovements = snapshot.movements || allMovementRecords_();
    return {
      items: listing.items,
      total: listing.items.length,
      owners: listing.owners,
      filters: listing.filters,
      generatedAt: isoDate_(new Date()),
      recentMovements: publicMovements_(snapshot.recentRows || [], allMovements),
      dashboard: dashboardFromSnapshot_(snapshot)
    };
  });
}

function inventoryListing_(params) {
  params = params || {};
  var paging = clampPage_(params);
  var query = requireText_(params.query, 'البحث', 200, true).toLowerCase();
  var status = normalizeListEnum_(params.status, 'ALL', ITEM_LIST_STATUSES_, 'status', 'حالة الصنف');
  var owner = requireText_(params.owner, 'المالك', 100, true).toLowerCase();
  var snapshot = inventorySnapshot_(DASHBOARD_CONFIG_.DEFAULT_DAYS);
  var owners = catalogOwnerOptions_(snapshot.items);
  var items = snapshot.items.map(function (item) {
    return publicItem_(item, snapshot.balances[item.id] || 0, snapshot.itemStats[item.id]);
  }).filter(function (item) {
    if (query && (item.code + ' ' + item.name + ' ' + item.owner + ' ' + item.unit).toLowerCase().indexOf(query) === -1) return false;
    if (owner && String(item.owner || '').toLowerCase() !== owner) return false;
    if (status === 'ACTIVE' && !item.active) return false;
    if (status === 'INACTIVE' && item.active) return false;
    if (status === 'LOW' && item.stockStatus !== 'LOW') return false;
    if (status === 'OUT' && item.stockStatus !== 'OUT') return false;
    if ((status === 'AVAILABLE' || status === 'OK') && item.stockStatus !== 'OK') return false;
    return true;
  }).sort(function (a, b) { return a.code.localeCompare(b.code) || a.name.localeCompare(b.name); });
  return {
    snapshot: snapshot,
    paging: paging,
    items: items,
    owners: owners,
    filters: { query: query, status: status, owner: owner }
  };
}

/** saveItem(token,payload) -> {item}; payload.id selects targeted update. */
function saveItem(token, payload) {
  return apiResult_(function () {
    payload = requireObject_(payload, 'الصنف');
    requireSession_(token, ['ADMIN']);
    ensureRepositorySchemaCurrent_();
    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN']);
      preflightInventoryMutation_('ITEMS');
      var code = normalizeItemCode_(payload.code);
      var name = requireText_(payload.name, 'اسم الصنف', 160, false);
      var requestedOwner = requireText_(payload.owner, 'المالك', 100, true);
      var unit = requireText_(payload.unit, 'الوحدة', 40, false);
      var reorderLevel = requireFiniteNumber_(payload.reorderLevel === undefined ? 0 : payload.reorderLevel, 'حد إعادة الطلب', 0, MAX_QUANTITY_);
      var duplicate = findItemByCode_(code);
      var now = new Date();

      if (!payload.id) {
        if (duplicate) throw new WarehouseError_('DUPLICATE_ITEM_CODE', 'رمز الصنف مستخدم مسبقاً.', { field: 'code' });
        var openingQuantity = requireFiniteNumber_(payload.openingQuantity === undefined ? 0 : payload.openingQuantity, 'الرصيد الافتتاحي', 0, MAX_QUANTITY_);
        var initialActive = parseBoolean_(payload.active, true);
        validateNewItemLifecycle_(initialActive, openingQuantity);
        var created = appendItemRecord_({
          id: newId_('ITM'),
          code: code,
          name: name,
          owner: requestedOwner || 'غير محدد',
          unit: unit,
          openingQuantity: roundQuantity_(openingQuantity),
          reorderLevel: roundQuantity_(reorderLevel),
          active: initialActive,
          createdAt: now,
          updatedAt: now,
          createdBy: session.user.username,
          updatedBy: session.user.username
        });
        var createAuditWarning = appendCommittedInventoryAudit_({
          actor: session.user,
          action: 'ITEM_CREATE',
          entityType: 'ITEM',
          entityId: created.id,
          status: 'SUCCESS',
          details: { code: created.code, owner: created.owner, openingQuantity: created.openingQuantity }
        });
        var createResult = { item: publicItem_(created, created.openingQuantity) };
        if (createAuditWarning) createResult.auditWarning = createAuditWarning;
        return createResult;
      }

      var item = findItemById_(requireText_(payload.id, 'معرف الصنف', 100, false));
      if (!item) throw new WarehouseError_('ITEM_NOT_FOUND', 'الصنف غير موجود.');
      if (duplicate && duplicate.id !== item.id) throw new WarehouseError_('DUPLICATE_ITEM_CODE', 'رمز الصنف مستخدم مسبقاً.', { field: 'code' });
      if (payload.openingQuantity !== undefined) {
        var requestedOpeningQuantity = roundQuantity_(requireFiniteNumber_(payload.openingQuantity, 'الرصيد الافتتاحي', 0, MAX_QUANTITY_));
        if (requestedOpeningQuantity !== item.openingQuantity) {
          throw new WarehouseError_('OPENING_BALANCE_IMMUTABLE', 'لا يمكن تعديل الرصيد الافتتاحي. سجل حركة مخزن للتصحيح.');
        }
      }
      var nextActive = payload.active === undefined ? item.active : parseBoolean_(payload.active, item.active);
      var itemMovements = allMovementRecords_();
      validateItemLifecycleChange_(item, unit, nextActive, itemMovements);
      var currentBalance = calculateBalances_([item], itemMovements)[item.id] || 0;
      var updated = updateItemFields_(item, {
        code: code,
        name: name,
        owner: requestedOwner || item.owner || 'غير محدد',
        unit: unit,
        reorderLevel: roundQuantity_(reorderLevel),
        active: nextActive,
        updatedBy: session.user.username
      });
      var updateAuditWarning = appendCommittedInventoryAudit_({
        actor: session.user,
        action: 'ITEM_UPDATE',
        entityType: 'ITEM',
        entityId: updated.id,
        status: 'SUCCESS',
        details: { code: updated.code, owner: updated.owner, active: updated.active }
      });
      var updateResult = { item: publicItem_(updated, currentBalance) };
      if (updateAuditWarning) updateResult.auditWarning = updateAuditWarning;
      return updateResult;
    });
  });
}

/**
 * listMovements(token,filters) -> paginated append-only movement history.
 * dateFrom/dateTo apply to documentDate when present, otherwise server time.
 */
function listMovements(token, params) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN', 'STOREKEEPER', 'AUDITOR']);
    ensureRepositorySchemaCurrent_();
    var listing = movementListing_(params);
    var reportSummary = movementReportSummary_(listing.movements, listing.items, listing.all);
    var start = (listing.paging.page - 1) * listing.paging.pageSize;
    return {
      movements: publicMovements_(listing.movements.slice(start, start + listing.paging.pageSize), listing.all),
      summary: reportSummary,
      page: listing.paging.page,
      pageSize: listing.paging.pageSize,
      total: listing.movements.length,
      hasMore: start + listing.paging.pageSize < listing.movements.length
    };
  });
}

/** getMovementExport(token,filters) -> complete filtered append-only log. */
function getMovementExport(token, params) {
  return apiResult_(function () {
    requireSession_(token, ['ADMIN', 'STOREKEEPER', 'AUDITOR']);
    ensureRepositorySchemaCurrent_();
    var listing = movementListing_(params);
    return {
      movements: publicMovements_(listing.movements, listing.all),
      total: listing.movements.length,
      summary: movementReportSummary_(listing.movements, listing.items, listing.all),
      filters: listing.filters,
      generatedAt: isoDate_(new Date())
    };
  });
}

function movementListing_(params) {
  params = params || {};
  var paging = clampPage_(params);
  var query = requireText_(params.query, 'البحث', 200, true).toLowerCase();
  var type = normalizeListEnum_(params.type, 'ALL', MOVEMENT_LIST_TYPES_, 'type', 'نوع الحركة');
  var itemId = String(params.itemId || '');
  var itemQuery = requireText_(params.itemQuery, 'بحث الصنف', 200, true).toLowerCase();
  var owner = requireText_(params.owner, 'المالك', 100, true);
  var dateFrom = params.dateFrom ? parseDocumentDate_(params.dateFrom, 'dateFrom') : null;
  var dateTo = params.dateTo ? parseDocumentDate_(params.dateTo, 'dateTo') : null;
  var fromKey = dateFrom ? documentDateKey_(dateFrom) : null;
  var toKey = dateTo ? documentDateKey_(dateTo) : null;
  validateDocumentDateRange_(fromKey, toKey);
  var items = allItemRecords_();
  var itemById = Object.create(null);
  items.forEach(function (item) { itemById[item.id] = item; });
  var all = allMovementRecords_();
  var movements = all.filter(function (movement) {
    if (type !== 'ALL' && movement.type !== type) return false;
    if (itemId && movement.itemId !== itemId) return false;
    var currentItem = itemById[movement.itemId] || null;
    if (owner && (!currentItem || currentItem.owner !== owner)) return false;
    var itemHaystack = [movement.itemCode, movement.itemName, currentItem && currentItem.code, currentItem && currentItem.name, currentItem && currentItem.owner].join(' ').toLowerCase();
    if (itemQuery && itemHaystack.indexOf(itemQuery) === -1) return false;
    var dateKey = documentDateKey_(movement.documentDate || movement.timestamp);
    if (fromKey && dateKey < fromKey) return false;
    if (toKey && dateKey > toKey) return false;
    var haystack = [movement.id, movement.itemCode, movement.itemName, movement.party, movement.reference, movement.notes, movement.actorDisplayName].join(' ').toLowerCase();
    return !query || haystack.indexOf(query) !== -1;
  }).sort(newestMovementFirst_);
  return {
    paging: paging,
    items: items,
    all: all,
    movements: movements,
    filters: { query: query, type: type, itemId: itemId, itemQuery: itemQuery, owner: owner, dateFrom: fromKey || '', dateTo: toKey || '' }
  };
}

/**
 * saveMovement(token,{clientRequestId,itemId,type,quantity,party,documentDate,reference,notes?})
 * -> {movement,balancePreview}; documentDate/reference are required for new
 * IN/OUT records, while timestamp/UUID/actor remain server-authoritative.
 */
function saveMovement(token, payload) {
  return apiResult_(function () {
    payload = requireObject_(payload, 'حركة المخزون');
    requireSession_(token, ['ADMIN', 'STOREKEEPER']);
    ensureRepositorySchemaCurrent_();
    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN', 'STOREKEEPER']);
      preflightInventoryMutation_('MOVEMENTS');
      var clientRequestId = normalizeClientRequestId_(payload.clientRequestId, true);
      var requestedItemId = requireText_(payload.itemId, 'الصنف', 100, false);
      var type = normalizeMovementType_(payload.type);
      var quantity = roundQuantity_(requireFiniteNumber_(payload.quantity, 'الكمية', QUANTITY_EPSILON_, MAX_QUANTITY_));
      var party = requireText_(payload.party, 'الجهة المستفيدة أو الموردة', 200, false);
      var documentDateText = requireText_(payload.documentDate, 'تاريخ المستند', 10, false);
      var documentDate = parseDocumentDate_(documentDateText, 'documentDate');
      assertDocumentDateNotFuture_(documentDate, 'documentDate');
      var reference = requireText_(payload.reference, 'رقم المستند أو الفاتورة', 120, false);
      var notes = requireText_(payload.notes, 'الملاحظات', 1000, true);
      var normalizedRequest = {
        itemId: requestedItemId,
        type: type,
        quantity: quantity,
        party: party,
        documentDate: documentDate,
        reference: reference,
        notes: notes
      };
      var existingMovements = allMovementRecords_();
      for (var existingIndex = 0; existingIndex < existingMovements.length; existingIndex += 1) {
        if (existingMovements[existingIndex].clientRequestId === clientRequestId) {
          if (!movementRequestMatches_(existingMovements[existingIndex], normalizedRequest, session.user.id)) {
            throw new WarehouseError_('IDEMPOTENCY_KEY_CONFLICT', 'معرف طلب العميل مستخدم لعملية مختلفة.', { field: 'clientRequestId' });
          }
          return {
            movement: publicMovements_([existingMovements[existingIndex]], existingMovements)[0],
            balancePreview: movementBalancePreview_(existingMovements[existingIndex]),
            deduplicated: true
          };
        }
      }
      var allItems = allItemRecords_();
      var item = null;
      for (var itemIndex = 0; itemIndex < allItems.length; itemIndex += 1) {
        if (allItems[itemIndex].id === requestedItemId) { item = allItems[itemIndex]; break; }
      }
      if (!item) throw new WarehouseError_('ITEM_NOT_FOUND', 'الصنف غير موجود.');
      if (!item.active) throw new WarehouseError_('ITEM_INACTIVE', 'لا يمكن تسجيل حركة لصنف معطل.');
      var allMovements = existingMovements;
      var balances = calculateBalances_(allItems, allMovements);
      var before = roundQuantity_(balances[item.id] || 0);
      var netChange = type === 'IN' ? quantity : -quantity;
      var after = roundQuantity_(before + netChange);
      if (after < -0.0000001) {
        throw new WarehouseError_('INSUFFICIENT_STOCK', 'الرصيد غير كافٍ لتنفيذ حركة الصرف.', {
          available: before,
          requested: quantity,
          balancePreview: movementBalancePreview_({
            type: type,
            itemId: item.id,
            itemCode: item.code,
            itemName: item.name,
            quantity: quantity,
            netChange: netChange,
            balanceBefore: before,
            balanceAfter: after
          }, false)
        });
      }
      assertBalanceWithinLimit_(after);
      var movement = appendMovementRecord_({
        id: newId_('MOV'),
        clientRequestId: clientRequestId,
        timestamp: new Date(),
        documentDate: documentDate,
        type: type,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        quantity: quantity,
        netChange: netChange,
        balanceBefore: before,
        balanceAfter: after,
        party: party,
        reference: reference,
        notes: notes,
        originalMovementId: '',
        actorId: session.user.id,
        actorUsername: session.user.username,
        actorDisplayName: session.user.displayName
      });
      var movementAuditWarning = appendCommittedInventoryAudit_({
        actor: session.user,
        action: 'MOVEMENT_CREATE',
        entityType: 'MOVEMENT',
        entityId: movement.id,
        status: 'SUCCESS',
        details: { itemId: item.id, type: type, direction: movementDirection_(type, netChange), quantity: quantity, party: party, reference: reference, balanceAfter: after }
      });
      var movementResult = { movement: publicMovement_(movement, false), balancePreview: movementBalancePreview_(movement), deduplicated: false };
      if (movementAuditWarning) movementResult.auditWarning = movementAuditWarning;
      return movementResult;
    });
  });
}

/** reverseMovement(token,{movementId,reason,documentDate?,clientRequestId?}) -> appended reversal. */
function reverseMovement(token, payload) {
  return apiResult_(function () {
    payload = requireObject_(payload, 'عكس الحركة');
    requireSession_(token, ['ADMIN', 'STOREKEEPER']);
    ensureRepositorySchemaCurrent_();
    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN', 'STOREKEEPER']);
      preflightInventoryMutation_('MOVEMENTS');
      var movementId = requireText_(payload.movementId || payload.id, 'معرف الحركة', 100, false);
      var reason = requireText_(payload.reason, 'سبب العكس', 500, false);
      var clientRequestId = normalizeClientRequestId_(payload.clientRequestId, false);
      var reversalDocumentDate = payload.documentDate ? parseDocumentDate_(payload.documentDate, 'documentDate') : '';
      if (reversalDocumentDate) assertDocumentDateNotFuture_(reversalDocumentDate, 'documentDate');
      var allMovements = allMovementRecords_();
      var original = null;
      for (var i = 0; i < allMovements.length; i += 1) if (allMovements[i].id === movementId) original = allMovements[i];
      if (!original) throw new WarehouseError_('MOVEMENT_NOT_FOUND', 'الحركة غير موجودة.');
      if (original.type === 'REVERSAL') throw new WarehouseError_('REVERSAL_NOT_REVERSIBLE', 'لا يمكن عكس حركة عكس.');
      validateReversalDocumentDate_(reversalDocumentDate, original);
      var requestIdMatch = null;
      var existingReversal = null;
      allMovements.forEach(function (movement) {
        if (clientRequestId && movement.clientRequestId === clientRequestId) requestIdMatch = movement;
        if (movement.type === 'REVERSAL' && movement.originalMovementId === original.id) existingReversal = movement;
      });
      var reversalRequest = { originalMovementId: original.id, reason: reason, documentDate: reversalDocumentDate };
      if (requestIdMatch) {
        if (!reversalRequestMatches_(requestIdMatch, reversalRequest, session.user.id)) {
          throw new WarehouseError_('IDEMPOTENCY_KEY_CONFLICT', 'معرف طلب العميل مستخدم لعملية مختلفة.', { field: 'clientRequestId' });
        }
        return reversalDeduplicatedResult_(requestIdMatch, original.id);
      }
      if (existingReversal) {
        if (reversalRequestMatches_(existingReversal, reversalRequest, session.user.id)) {
          return reversalDeduplicatedResult_(existingReversal, original.id);
        }
        throw new WarehouseError_('ALREADY_REVERSED', 'تم عكس هذه الحركة مسبقاً.');
      }

      var items = allItemRecords_();
      var item = null;
      for (var j = 0; j < items.length; j += 1) if (items[j].id === original.itemId) item = items[j];
      if (!item) throw new WarehouseError_('ITEM_NOT_FOUND', 'الصنف المرتبط بالحركة غير موجود.');
      validateReversalItemState_(item);
      var balances = calculateBalances_(items, allMovements);
      var before = roundQuantity_(balances[item.id] || 0);
      var netChange = roundQuantity_(-original.netChange);
      var after = roundQuantity_(before + netChange);
      if (after < -0.0000001) {
        throw new WarehouseError_('INSUFFICIENT_STOCK_FOR_REVERSAL', 'لا يمكن عكس التوريد لأن الكمية صرفت بعده.', { available: before, required: Math.abs(netChange) });
      }
      assertBalanceWithinLimit_(after);
      var reversal = appendMovementRecord_({
        id: newId_('MOV'),
        clientRequestId: clientRequestId,
        timestamp: new Date(),
        documentDate: reversalDocumentDate,
        type: 'REVERSAL',
        itemId: item.id,
        itemCode: original.itemCode || item.code,
        itemName: original.itemName || item.name,
        quantity: original.quantity,
        netChange: netChange,
        balanceBefore: before,
        balanceAfter: after,
        party: original.party,
        reference: original.reference,
        notes: reason,
        originalMovementId: original.id,
        actorId: session.user.id,
        actorUsername: session.user.username,
        actorDisplayName: session.user.displayName
      });
      var reversalAuditWarning = appendCommittedInventoryAudit_({
        actor: session.user,
        action: 'MOVEMENT_REVERSE',
        entityType: 'MOVEMENT',
        entityId: reversal.id,
        status: 'SUCCESS',
        details: { originalMovementId: original.id, reason: reason, balanceAfter: after }
      });
      var reversalResult = { movement: publicMovement_(reversal, false), balancePreview: movementBalancePreview_(reversal), originalMovementId: original.id, deduplicated: false };
      if (reversalAuditWarning) reversalResult.auditWarning = reversalAuditWarning;
      return reversalResult;
    });
  });
}

/**
 * correctMovement(token,{movementId,reason,clientRequestId,itemId,type,quantity,
 * documentDate,party,reference,notes?}) -> one batch write containing an
 * audited reversal and its corrected replacement.
 */
function correctMovement(token, payload) {
  return apiResult_(function () {
    payload = requireObject_(payload, 'تصحيح الحركة');
    requireSession_(token, ['ADMIN', 'STOREKEEPER']);
    ensureRepositorySchemaCurrent_();
    return withScriptLock_(function () {
      var session = requireSession_(token, ['ADMIN', 'STOREKEEPER']);
      preflightInventoryMutation_('MOVEMENTS');
      var movementId = requireText_(payload.movementId || payload.id, 'معرف الحركة', 100, false);
      var reason = requireText_(payload.reason, 'سبب التصحيح', 500, false);
      var clientRequestId = normalizeClientRequestId_(payload.clientRequestId, true);
      var reversalRequestId = correctionRequestKey_(clientRequestId, 'R');
      var replacementRequestId = correctionRequestKey_(clientRequestId, 'N');
      var requestedItemId = requireText_(payload.itemId, 'الصنف', 100, false);
      var type = normalizeMovementType_(payload.type);
      var quantity = roundQuantity_(requireFiniteNumber_(payload.quantity, 'الكمية', QUANTITY_EPSILON_, MAX_QUANTITY_));
      var party = requireText_(payload.party, 'الجهة المستفيدة أو الموردة', 200, false);
      var documentDateText = requireText_(payload.documentDate, 'تاريخ المستند', 10, false);
      var documentDate = parseDocumentDate_(documentDateText, 'documentDate');
      assertDocumentDateNotFuture_(documentDate, 'documentDate');
      var reference = requireText_(payload.reference, 'رقم المستند أو الفاتورة', 120, false);
      var notes = requireText_(payload.notes, 'الملاحظات', 1000, true);
      var replacementRequest = {
        itemId: requestedItemId,
        type: type,
        quantity: quantity,
        party: party,
        documentDate: documentDate,
        reference: reference,
        notes: notes
      };

      var allMovements = allMovementRecords_();
      var original = null;
      var requestReversal = null;
      var requestReplacement = null;
      var existingReversal = null;
      allMovements.forEach(function (movement) {
        if (movement.id === movementId) original = movement;
        if (movement.clientRequestId === reversalRequestId) requestReversal = movement;
        if (movement.clientRequestId === replacementRequestId) requestReplacement = movement;
        if (movement.type === 'REVERSAL' && movement.originalMovementId === movementId) existingReversal = movement;
      });
      if (!original) throw new WarehouseError_('MOVEMENT_NOT_FOUND', 'الحركة غير موجودة.');
      if (original.type === 'REVERSAL') throw new WarehouseError_('REVERSAL_NOT_REVERSIBLE', 'لا يمكن تصحيح حركة عكس.');

      if (requestReversal || requestReplacement) {
        var reversalRequest = { originalMovementId: original.id, reason: reason, documentDate: '' };
        if (!requestReversal || !requestReplacement ||
            !reversalRequestMatches_(requestReversal, reversalRequest, session.user.id) ||
            !movementRequestMatches_(requestReplacement, replacementRequest, session.user.id)) {
          throw new WarehouseError_('IDEMPOTENCY_KEY_CONFLICT', 'معرف طلب التصحيح مستخدم لعملية مختلفة أو غير مكتملة.', { field: 'clientRequestId' });
        }
        return {
          reversal: publicMovement_(requestReversal, false),
          movement: publicMovement_(requestReplacement, false),
          originalMovementId: original.id,
          deduplicated: true
        };
      }
      if (existingReversal) throw new WarehouseError_('ALREADY_REVERSED', 'تم عكس هذه الحركة مسبقاً.');

      var items = allItemRecords_();
      var originalItem = null;
      var replacementItem = null;
      items.forEach(function (item) {
        if (item.id === original.itemId) originalItem = item;
        if (item.id === requestedItemId) replacementItem = item;
      });
      if (!originalItem) throw new WarehouseError_('ITEM_NOT_FOUND', 'الصنف المرتبط بالحركة غير موجود.');
      if (!replacementItem) throw new WarehouseError_('ITEM_NOT_FOUND', 'الصنف المصحح غير موجود.');
      validateReversalItemState_(originalItem);
      if (!replacementItem.active) throw new WarehouseError_('ITEM_INACTIVE', 'لا يمكن تسجيل التصحيح على صنف معطل.');

      var balances = calculateBalances_(items, allMovements);
      var reversalBefore = roundQuantity_(balances[originalItem.id] || 0);
      var reversalNet = roundQuantity_(-original.netChange);
      var reversalAfter = roundQuantity_(reversalBefore + reversalNet);
      if (reversalAfter < -0.0000001) {
        throw new WarehouseError_('INSUFFICIENT_STOCK_FOR_REVERSAL', 'لا يمكن تصحيح التوريد لأن الكمية صرفت بعده.', { available: reversalBefore, required: Math.abs(reversalNet) });
      }
      assertBalanceWithinLimit_(reversalAfter);

      var replacementBefore = originalItem.id === replacementItem.id ? reversalAfter : roundQuantity_(balances[replacementItem.id] || 0);
      var replacementNet = type === 'IN' ? quantity : -quantity;
      var replacementAfter = roundQuantity_(replacementBefore + replacementNet);
      if (replacementAfter < -0.0000001) {
        throw new WarehouseError_('INSUFFICIENT_STOCK', 'الرصيد غير كافٍ لتنفيذ حركة الصرف المصححة.', { available: replacementBefore, requested: quantity });
      }
      assertBalanceWithinLimit_(replacementAfter);

      var timestamp = new Date();
      var reversal = {
        id: newId_('MOV'),
        clientRequestId: reversalRequestId,
        timestamp: timestamp,
        documentDate: '',
        type: 'REVERSAL',
        itemId: originalItem.id,
        itemCode: original.itemCode || originalItem.code,
        itemName: original.itemName || originalItem.name,
        quantity: original.quantity,
        netChange: reversalNet,
        balanceBefore: reversalBefore,
        balanceAfter: reversalAfter,
        party: original.party,
        reference: original.reference,
        notes: reason,
        originalMovementId: original.id,
        actorId: session.user.id,
        actorUsername: session.user.username,
        actorDisplayName: session.user.displayName
      };
      var replacement = {
        id: newId_('MOV'),
        clientRequestId: replacementRequestId,
        timestamp: timestamp,
        documentDate: documentDate,
        type: type,
        itemId: replacementItem.id,
        itemCode: replacementItem.code,
        itemName: replacementItem.name,
        quantity: quantity,
        netChange: replacementNet,
        balanceBefore: replacementBefore,
        balanceAfter: replacementAfter,
        party: party,
        reference: reference,
        notes: notes,
        originalMovementId: original.id,
        actorId: session.user.id,
        actorUsername: session.user.username,
        actorDisplayName: session.user.displayName
      };
      appendMovementRecords_([reversal, replacement]);
      var correctionAuditWarning = appendCommittedInventoryAudit_({
        actor: session.user,
        action: 'MOVEMENT_CORRECT',
        entityType: 'MOVEMENT',
        entityId: replacement.id,
        status: 'SUCCESS',
        details: {
          originalMovementId: original.id,
          reversalMovementId: reversal.id,
          correctedMovementId: replacement.id,
          reason: reason,
          correctedType: type,
          correctedQuantity: quantity,
          balanceAfter: replacementAfter
        }
      });
      var result = {
        reversal: publicMovement_(reversal, false),
        movement: publicMovement_(replacement, false),
        originalMovementId: original.id,
        deduplicated: false
      };
      if (correctionAuditWarning) result.auditWarning = correctionAuditWarning;
      return result;
    });
  });
}

/**
 * One range read per operational sheet, followed by one movement pass. The
 * returned snapshot is reused by dashboard, bootstrap, and item listing.
 */
function inventorySnapshot_(days) {
  days = normalizeDashboardDays_(days);
  var items = allItemRecords_();
  var movements = allMovementRecords_();
  var now = new Date();
  var todayKey = Utilities.formatDate(now, WAREHOUSE_CONFIG_.TIME_ZONE, 'yyyy-MM-dd');
  var todayDate = parseDocumentDate_(todayKey, 'dashboardDate');
  var rangeStartDate = new Date(todayDate.getTime());
  rangeStartDate.setDate(rangeStartDate.getDate() - days + 1);
  var rangeStartKey = documentDateKey_(rangeStartDate);

  var balances = Object.create(null);
  var itemStats = Object.create(null);
  var itemById = Object.create(null);
  items.forEach(function (item) {
    itemById[item.id] = item;
    balances[item.id] = roundQuantity_(item.openingQuantity);
    itemStats[item.id] = {
      incomingMovementCount: 0,
      outgoingMovementCount: 0,
      reversalMovementCount: 0,
      movementCount: 0,
      totalIncoming: 0,
      totalOutgoing: 0,
      reversalNet: 0,
      netMovement: 0,
      lastMovementAt: null
    };
  });

  var dailyByDate = Object.create(null);
  var dailyTrend = [];
  for (var dayOffset = days - 1; dayOffset >= 0; dayOffset -= 1) {
    var dayDate = new Date(todayDate.getTime());
    dayDate.setDate(dayDate.getDate() - dayOffset);
    var dayKey = documentDateKey_(dayDate);
    var point = newDailyTrendPoint_(dayKey);
    dailyByDate[dayKey] = point;
    dailyTrend.push(point);
  }

  var allTimeFlow = newFlowAggregate_();
  var rangeFlow = newFlowAggregate_();
  var todayFlow = newFlowAggregate_();
  var flowByUnitMap = Object.create(null);
  var reversedIds = Object.create(null);
  var legacyIncomingToday = 0;
  var legacyOutgoingToday = 0;
  var movementsToday = 0;

  movements.forEach(function (movement) {
    addMovementToFlow_(allTimeFlow, movement);
    var item = itemById[movement.itemId];
    var unit = item && item.unit ? item.unit : 'غير محدد';
    if (!flowByUnitMap[unit]) flowByUnitMap[unit] = newFlowAggregate_();
    addMovementToFlow_(flowByUnitMap[unit], movement);

    if (Object.prototype.hasOwnProperty.call(balances, movement.itemId)) {
      balances[movement.itemId] = roundQuantity_(balances[movement.itemId] + movement.netChange);
      var stats = itemStats[movement.itemId];
      stats.movementCount += 1;
      stats.netMovement = roundQuantity_(stats.netMovement + movement.netChange);
      if (movement.type === 'IN') {
        stats.incomingMovementCount += 1;
        stats.totalIncoming = roundQuantity_(stats.totalIncoming + movement.quantity);
      } else if (movement.type === 'OUT') {
        stats.outgoingMovementCount += 1;
        stats.totalOutgoing = roundQuantity_(stats.totalOutgoing + movement.quantity);
      } else if (movement.type === 'REVERSAL') {
        stats.reversalMovementCount += 1;
        stats.reversalNet = roundQuantity_(stats.reversalNet + movement.netChange);
      }
      if (movement.timestamp && (!stats.lastMovementAt || new Date(movement.timestamp).getTime() > new Date(stats.lastMovementAt).getTime())) {
        stats.lastMovementAt = movement.timestamp;
      }
    }

    if (movement.type === 'REVERSAL' && movement.originalMovementId) reversedIds[movement.originalMovementId] = true;
    var businessDateKey = documentDateKey_(movement.documentDate || movement.timestamp);
    if (businessDateKey >= rangeStartKey && businessDateKey <= todayKey && dailyByDate[businessDateKey]) {
      addMovementToTrendPoint_(dailyByDate[businessDateKey], movement);
      addMovementToFlow_(rangeFlow, movement);
    }
    var serverDateKey = movement.timestamp ? Utilities.formatDate(new Date(movement.timestamp), WAREHOUSE_CONFIG_.TIME_ZONE, 'yyyy-MM-dd') : '';
    if (serverDateKey === todayKey) {
      movementsToday += 1;
      addMovementToFlow_(todayFlow, movement);
      if (movement.netChange > 0) legacyIncomingToday += movement.netChange;
      if (movement.netChange < 0) legacyOutgoingToday += Math.abs(movement.netChange);
    }
  });

  Object.keys(itemStats).forEach(function (itemId) {
    itemStats[itemId].currentQuantity = roundQuantity_(balances[itemId] || 0);
    itemStats[itemId].lastMovementAt = isoDate_(itemStats[itemId].lastMovementAt);
  });
  dailyTrend.forEach(finalizeTrendPoint_);
  finalizeFlowAggregate_(allTimeFlow);
  finalizeFlowAggregate_(rangeFlow);
  finalizeFlowAggregate_(todayFlow);
  Object.keys(flowByUnitMap).forEach(function (unit) { finalizeFlowAggregate_(flowByUnitMap[unit]); });

  var recentRows = movements.slice().sort(newestMovementFirst_).slice(0, DASHBOARD_CONFIG_.RECENT_LIMIT);
  return {
    days: days,
    generatedAt: now,
    rangeStart: rangeStartKey,
    rangeEnd: todayKey,
    items: items,
    movements: movements,
    balances: balances,
    itemStats: itemStats,
    reversedIds: reversedIds,
    recentRows: recentRows,
    dailyTrend: dailyTrend,
    allTimeFlow: allTimeFlow,
    rangeFlow: rangeFlow,
    todayFlow: todayFlow,
    flowByUnitMap: flowByUnitMap,
    movementsToday: movementsToday,
    legacyIncomingToday: roundQuantity_(legacyIncomingToday),
    legacyOutgoingToday: roundQuantity_(legacyOutgoingToday)
  };
}

function calculateBalances_(items, movements) {
  var balances = {};
  items.forEach(function (item) { balances[item.id] = roundQuantity_(item.openingQuantity); });
  movements.forEach(function (movement) {
    if (Object.prototype.hasOwnProperty.call(balances, movement.itemId)) {
      balances[movement.itemId] = roundQuantity_(balances[movement.itemId] + movement.netChange);
    }
  });
  return balances;
}

/**
 * Summarize the complete filtered result set before pagination. Quantity
 * fields exist only inside unit buckets (and their single-unit item rows), so
 * unlike legacy KPIs the report never adds kilograms, pieces, boxes, etc.
 */
function movementReportSummary_(filteredMovements, items, allMovements) {
  var itemById = Object.create(null);
  items.forEach(function (item) { itemById[item.id] = item; });
  var currentBalances = calculateBalances_(items, allMovements);
  var unitBuckets = Object.create(null);
  var itemBuckets = Object.create(null);

  filteredMovements.forEach(function (movement) {
    var item = itemById[movement.itemId] || null;
    var unit = item && item.unit ? item.unit : 'غير محدد';
    if (!unitBuckets[unit]) unitBuckets[unit] = newMovementSummaryBucket_(unit);
    addMovementToSummaryBucket_(unitBuckets[unit], movement);

    var itemKey = movement.itemId || ('__MOVEMENT__' + movement.id);
    if (!itemBuckets[itemKey]) {
      itemBuckets[itemKey] = {
        itemId: movement.itemId || null,
        itemCode: movement.itemCode || (item && item.code) || '',
        itemName: movement.itemName || (item && item.name) || '',
        currentItemCode: item ? item.code : '',
        currentItemName: item ? item.name : '',
        owner: item ? (item.owner || 'غير محدد') : 'غير محدد',
        unit: unit,
        currentBalance: item && Object.prototype.hasOwnProperty.call(currentBalances, item.id) ? roundQuantity_(currentBalances[item.id]) : null,
        incoming: 0,
        outgoing: 0,
        reversalNet: 0,
        net: 0
      };
    }
    addMovementToSummaryBucket_(itemBuckets[itemKey], movement);
  });

  var byItem = Object.keys(itemBuckets).map(function (key) {
    return finalizeMovementSummaryBucket_(itemBuckets[key]);
  }).sort(function (a, b) {
    return a.unit.localeCompare(b.unit) || String(a.itemCode || '').localeCompare(String(b.itemCode || '')) || String(a.itemId || '').localeCompare(String(b.itemId || ''));
  });
  var currentByUnit = Object.create(null);
  byItem.forEach(function (entry) {
    if (!currentByUnit[entry.unit]) currentByUnit[entry.unit] = { value: 0, unavailable: false };
    if (entry.currentBalance === null) currentByUnit[entry.unit].unavailable = true;
    else currentByUnit[entry.unit].value += entry.currentBalance;
  });
  var byUnit = Object.keys(unitBuckets).sort(function (a, b) { return a.localeCompare(b); }).map(function (unit) {
    var result = finalizeMovementSummaryBucket_(unitBuckets[unit]);
    var current = currentByUnit[unit] || { value: 0, unavailable: false };
    result.currentBalance = current.unavailable ? null : roundQuantity_(current.value);
    return result;
  });

  return {
    movementCount: filteredMovements.length,
    byUnit: byUnit,
    byItem: byItem
  };
}

function newMovementSummaryBucket_(unit) {
  return {
    unit: unit,
    incoming: 0,
    outgoing: 0,
    reversalNet: 0,
    net: 0
  };
}

function addMovementToSummaryBucket_(bucket, movement) {
  bucket.net += movement.netChange;
  if (movement.type === 'IN') bucket.incoming += movement.quantity;
  if (movement.type === 'OUT') bucket.outgoing += movement.quantity;
  if (movement.type === 'REVERSAL') bucket.reversalNet += movement.netChange;
}

function finalizeMovementSummaryBucket_(bucket) {
  bucket.incoming = roundQuantity_(bucket.incoming);
  bucket.outgoing = roundQuantity_(bucket.outgoing);
  bucket.reversalNet = roundQuantity_(bucket.reversalNet);
  bucket.net = roundQuantity_(bucket.net);
  return bucket;
}

function dashboardFromSnapshot_(data) {
  var counts = { AVAILABLE: 0, LOW: 0, OUT: 0, INACTIVE: 0 };
  var activeItems = 0;
  var inactiveItems = 0;
  var totalCurrentQuantity = 0;
  var totalOpeningQuantity = 0;
  var currentByUnit = Object.create(null);
  var currentByOwner = Object.create(null);
  var urgentItems = [];
  var stockItems = [];
  var inactiveStockAnomalies = [];

  data.items.forEach(function (item) {
    var stats = data.itemStats[item.id];
    var publicItem = publicItem_(item, data.balances[item.id] || 0, stats);
    if (!item.active) {
      inactiveItems += 1;
      counts.INACTIVE += 1;
      if (roundQuantity_(publicItem.currentQuantity) !== 0) {
        publicItem.inventoryAnomaly = 'INACTIVE_WITH_STOCK';
        publicItem.shortageToReorder = 0;
        publicItem.stockCoverageRatio = null;
        inactiveStockAnomalies.push(publicItem);
        urgentItems.push(publicItem);
      }
      return;
    }
    activeItems += 1;
    totalCurrentQuantity += publicItem.currentQuantity;
    totalOpeningQuantity += item.openingQuantity;
    // Public item rows keep the historical healthy status `OK`, while the
    // dashboard contract exposes that bucket as `AVAILABLE`. Never create an
    // ad-hoc `OK` counter: incrementing an undefined bucket produces NaN,
    // which Google Apps Script cannot serialize back to the browser.
    var countStatus = publicItem.stockStatus === 'OK' ? 'AVAILABLE' : publicItem.stockStatus;
    counts[countStatus] += 1;
    var owner = item.owner || 'غير محدد';
    if (!currentByOwner[owner]) {
      currentByOwner[owner] = { owner: owner, itemCount: 0, currentQuantity: 0, actionNeededCount: 0 };
    }
    currentByOwner[owner].itemCount += 1;
    currentByOwner[owner].currentQuantity += publicItem.currentQuantity;
    if (publicItem.stockStatus !== 'OK') currentByOwner[owner].actionNeededCount += 1;
    var unit = item.unit || 'غير محدد';
    if (!currentByUnit[unit]) {
      currentByUnit[unit] = { unit: unit, itemCount: 0, availableItemCount: 0, actionNeededCount: 0, currentQuantity: 0 };
    }
    currentByUnit[unit].itemCount += 1;
    currentByUnit[unit].currentQuantity += publicItem.currentQuantity;
    if (publicItem.stockStatus === 'OK') currentByUnit[unit].availableItemCount += 1;
    else currentByUnit[unit].actionNeededCount += 1;

    stockItems.push(publicItem);
    if (publicItem.stockStatus === 'LOW' || publicItem.stockStatus === 'OUT') {
      publicItem.shortageToReorder = roundQuantity_(Math.max(0, item.reorderLevel - publicItem.currentQuantity));
      publicItem.stockCoverageRatio = item.reorderLevel > 0 ? roundRatio_(publicItem.currentQuantity / item.reorderLevel) : null;
      urgentItems.push(publicItem);
    }
  });

  urgentItems.sort(compareUrgentItems_);
  stockItems.sort(function (a, b) { return b.currentQuantity - a.currentQuantity || a.code.localeCompare(b.code); });
  var unitKeys = Object.keys(currentByUnit).sort(function (a, b) { return a.localeCompare(b); });
  var flowUnitKeys = Object.keys(data.flowByUnitMap).filter(function (unit) {
    return data.flowByUnitMap[unit] && data.flowByUnitMap[unit].movementCount > 0;
  }).sort(function (a, b) { return a.localeCompare(b); });
  var currentStockMixedUnits = unitKeys.length > 1;
  var flowMixedUnits = flowUnitKeys.length > 1;
  var anyMixedUnits = currentStockMixedUnits || flowMixedUnits;
  var currentUnitsByUnit = unitKeys.map(function (unit) {
    var entry = currentByUnit[unit];
    entry.currentQuantity = roundQuantity_(entry.currentQuantity);
    return entry;
  });
  var ownerSummary = Object.keys(currentByOwner).map(function (owner) {
    var entry = currentByOwner[owner];
    entry.currentQuantity = roundQuantity_(entry.currentQuantity);
    return entry;
  }).sort(function (a, b) {
    return b.itemCount - a.itemCount || a.owner.localeCompare(b.owner);
  });
  var flowByUnit = flowUnitKeys.map(function (unit) {
    return { unit: unit, flow: data.flowByUnitMap[unit] };
  });
  var actionNeeded = counts.LOW + counts.OUT + inactiveStockAnomalies.length;
  var healthyPercentage = activeItems ? roundRatio_(counts.AVAILABLE * 100 / activeItems) : 100;
  var summary = {
    totalItems: activeItems,
    allItems: data.items.length,
    activeItems: activeItems,
    inactiveItems: inactiveItems,
    availableItems: counts.AVAILABLE,
    lowStockItems: counts.LOW,
    outOfStockItems: counts.OUT,
    inactiveStockAnomalyCount: inactiveStockAnomalies.length,
    actionNeededCount: actionNeeded,
    healthyPercentage: healthyPercentage,
    currentQuantity: roundQuantity_(totalCurrentQuantity),
    openingQuantity: roundQuantity_(totalOpeningQuantity),
    movementCount: data.allTimeFlow.movementCount,
    incomingMovementCount: data.allTimeFlow.incoming.movementCount,
    outgoingMovementCount: data.allTimeFlow.outgoing.movementCount,
    reversalMovementCount: data.allTimeFlow.reversals.movementCount,
    incomingQuantity: data.allTimeFlow.incoming.quantity,
    outgoingQuantity: data.allTimeFlow.outgoing.quantity,
    reversalNetQuantity: data.allTimeFlow.reversals.netQuantity,
    mixedUnits: anyMixedUnits,
    inventoryMixedUnits: currentStockMixedUnits,
    movementMixedUnits: flowMixedUnits,
    currentStockMixedUnits: currentStockMixedUnits,
    flowMixedUnits: flowMixedUnits
  };
  var statusTotal = data.items.length || 1;
  var statusDistribution = ['AVAILABLE', 'LOW', 'OUT', 'INACTIVE'].map(function (status) {
    return { status: status, count: counts[status], percentage: roundRatio_(counts[status] * 100 / statusTotal) };
  });
  var recentMovements = publicMovementsWithReversedMap_(data.recentRows, data.reversedIds);
  var topStockItems = stockItems.slice(0, DASHBOARD_CONFIG_.STOCK_SERIES_LIMIT);

  return {
    generatedAt: data.generatedAt.toISOString(),
    range: {
      days: data.days,
      from: data.rangeStart,
      to: data.rangeEnd,
      dateBasis: 'DOCUMENT_DATE_OR_SERVER_TIMESTAMP'
    },
    summary: summary,
    stockStatusCounts: counts,
    stockStatusDistribution: statusDistribution,
    dailyMovementTrend: data.dailyTrend,
    movementTrend: data.dailyTrend,
    flowTotals: data.allTimeFlow,
    rangeFlow: data.rangeFlow,
    todayFlow: data.todayFlow,
    currentUnitsByUnit: currentUnitsByUnit,
    ownerSummary: ownerSummary,
    flowByUnit: flowByUnit,
    urgentItems: urgentItems.slice(0, DASHBOARD_CONFIG_.URGENT_LIMIT),
    urgentItemsTotal: urgentItems.length,
    inactiveStockAnomalies: inactiveStockAnomalies.slice(0, DASHBOARD_CONFIG_.URGENT_LIMIT),
    topStockItems: topStockItems,
    stockLevelSeries: topStockItems.map(function (item) {
      return { itemId: item.id, code: item.code, name: item.name, unit: item.unit, currentQuantity: item.currentQuantity, reorderLevel: item.reorderLevel, status: item.status };
    }),
    recentMovements: recentMovements,
    recentMovementLimit: DASHBOARD_CONFIG_.RECENT_LIMIT,
    inventoryMixedUnits: currentStockMixedUnits,
    movementMixedUnits: flowMixedUnits,
    quantityAggregation: anyMixedUnits ? 'RAW_ACROSS_MIXED_UNITS' : 'SINGLE_UNIT',
    currentStockQuantityAggregation: currentStockMixedUnits ? 'RAW_ACROSS_MIXED_UNITS' : 'SINGLE_UNIT',
    flowQuantityAggregation: flowMixedUnits ? 'RAW_ACROSS_MIXED_UNITS' : 'SINGLE_UNIT',

    // Compatibility with the existing frontend and the original HTML KPIs.
    totalItems: activeItems,
    totalQuantity: roundQuantity_(totalCurrentQuantity),
    totalCurrentUnits: roundQuantity_(totalCurrentQuantity),
    totalIncoming: data.allTimeFlow.incoming.quantity,
    totalOutgoing: data.allTimeFlow.outgoing.quantity,
    totalIn: data.allTimeFlow.incoming.quantity,
    totalOut: data.allTimeFlow.outgoing.quantity,
    lowStockItems: counts.LOW,
    lowStockCount: counts.LOW,
    lowCount: counts.LOW,
    outOfStockItems: counts.OUT,
    outOfStockCount: counts.OUT,
    outCount: counts.OUT,
    criticalItems: actionNeeded,
    movementsToday: data.movementsToday,
    incomingToday: data.legacyIncomingToday,
    outgoingToday: data.legacyOutgoingToday
  };
}

function normalizeDashboardDays_(value) {
  if (value === undefined || value === null || value === '') return DASHBOARD_CONFIG_.DEFAULT_DAYS;
  var days = Number(value);
  if (DASHBOARD_CONFIG_.ALLOWED_DAYS.indexOf(days) === -1) {
    throw new WarehouseError_('VALIDATION_ERROR', 'نطاق لوحة المؤشرات يجب أن يكون 7 أو 30 أو 90 يوماً.', { field: 'days', allowed: DASHBOARD_CONFIG_.ALLOWED_DAYS });
  }
  return days;
}

function newFlowAggregate_() {
  return {
    movementCount: 0,
    incoming: { movementCount: 0, quantity: 0 },
    outgoing: { movementCount: 0, quantity: 0 },
    reversals: { movementCount: 0, netQuantity: 0, increaseQuantity: 0, decreaseQuantity: 0 },
    netQuantity: 0
  };
}

function addMovementToFlow_(flow, movement) {
  flow.movementCount += 1;
  flow.netQuantity += movement.netChange;
  if (movement.type === 'IN') {
    flow.incoming.movementCount += 1;
    flow.incoming.quantity += movement.quantity;
  } else if (movement.type === 'OUT') {
    flow.outgoing.movementCount += 1;
    flow.outgoing.quantity += movement.quantity;
  } else if (movement.type === 'REVERSAL') {
    flow.reversals.movementCount += 1;
    flow.reversals.netQuantity += movement.netChange;
    if (movement.netChange > 0) flow.reversals.increaseQuantity += movement.netChange;
    if (movement.netChange < 0) flow.reversals.decreaseQuantity += Math.abs(movement.netChange);
  }
}

function finalizeFlowAggregate_(flow) {
  flow.incoming.quantity = roundQuantity_(flow.incoming.quantity);
  flow.outgoing.quantity = roundQuantity_(flow.outgoing.quantity);
  flow.reversals.netQuantity = roundQuantity_(flow.reversals.netQuantity);
  flow.reversals.increaseQuantity = roundQuantity_(flow.reversals.increaseQuantity);
  flow.reversals.decreaseQuantity = roundQuantity_(flow.reversals.decreaseQuantity);
  flow.netQuantity = roundQuantity_(flow.netQuantity);
}

function newDailyTrendPoint_(dateKey) {
  return {
    date: dateKey,
    movementCount: 0,
    inCount: 0,
    outCount: 0,
    reversalCount: 0,
    inQuantity: 0,
    outQuantity: 0,
    reversalNetQuantity: 0,
    netQuantity: 0
  };
}

function addMovementToTrendPoint_(point, movement) {
  point.movementCount += 1;
  point.netQuantity += movement.netChange;
  if (movement.type === 'IN') {
    point.inCount += 1;
    point.inQuantity += movement.quantity;
  } else if (movement.type === 'OUT') {
    point.outCount += 1;
    point.outQuantity += movement.quantity;
  } else if (movement.type === 'REVERSAL') {
    point.reversalCount += 1;
    point.reversalNetQuantity += movement.netChange;
  }
}

function finalizeTrendPoint_(point) {
  point.inQuantity = roundQuantity_(point.inQuantity);
  point.outQuantity = roundQuantity_(point.outQuantity);
  point.reversalNetQuantity = roundQuantity_(point.reversalNetQuantity);
  point.netQuantity = roundQuantity_(point.netQuantity);
}

function compareUrgentItems_(a, b) {
  var aRank = a.inventoryAnomaly === 'INACTIVE_WITH_STOCK' ? 0 : (a.stockStatus === 'OUT' ? 1 : 2);
  var bRank = b.inventoryAnomaly === 'INACTIVE_WITH_STOCK' ? 0 : (b.stockStatus === 'OUT' ? 1 : 2);
  if (aRank !== bRank) return aRank - bRank;
  var aCoverage = a.stockCoverageRatio === null ? Number.POSITIVE_INFINITY : a.stockCoverageRatio;
  var bCoverage = b.stockCoverageRatio === null ? Number.POSITIVE_INFINITY : b.stockCoverageRatio;
  return aCoverage - bCoverage || b.shortageToReorder - a.shortageToReorder || a.code.localeCompare(b.code);
}

function roundRatio_(number) {
  return Math.round((Number(number) || 0) * 100) / 100;
}

function publicItem_(item, currentQuantity, stats) {
  stats = stats || {};
  var current = roundQuantity_(currentQuantity);
  var stockStatus = !item.active ? 'INACTIVE' : (current <= 0 ? 'OUT' : (current <= item.reorderLevel ? 'LOW' : 'OK'));
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    owner: item.owner || 'غير محدد',
    unit: item.unit,
    openingQuantity: item.openingQuantity,
    reorderLevel: item.reorderLevel,
    currentQuantity: current,
    totalIncoming: roundQuantity_(stats.totalIncoming || 0),
    totalOutgoing: roundQuantity_(stats.totalOutgoing || 0),
    reversalNet: roundQuantity_(stats.reversalNet || 0),
    movementCount: Number(stats.movementCount) || 0,
    incomingMovementCount: Number(stats.incomingMovementCount) || 0,
    outgoingMovementCount: Number(stats.outgoingMovementCount) || 0,
    reversalMovementCount: Number(stats.reversalMovementCount) || 0,
    lastMovementAt: stats.lastMovementAt || null,
    active: item.active,
    stockStatus: stockStatus,
    status: stockStatus === 'OK' ? 'AVAILABLE' : stockStatus,
    createdAt: isoDate_(item.createdAt),
    updatedAt: isoDate_(item.updatedAt)
  };
}

function publicMovement_(movement, reversed) {
  var direction = movementDirection_(movement.type, movement.netChange);
  return {
    id: movement.id,
    clientRequestId: movement.clientRequestId || null,
    timestamp: isoDate_(movement.timestamp),
    documentDate: movement.documentDate ? documentDateKey_(movement.documentDate) : null,
    type: movement.type,
    direction: direction,
    isIncoming: movement.type === 'IN',
    isOutgoing: movement.type === 'OUT',
    itemId: movement.itemId,
    itemCode: movement.itemCode,
    itemName: movement.itemName,
    quantity: movement.quantity,
    netChange: movement.netChange,
    balanceBefore: movement.balanceBefore,
    balanceAfter: movement.balanceAfter,
    party: movement.party,
    reference: movement.reference,
    notes: movement.notes,
    originalMovementId: movement.originalMovementId || null,
    reversed: !!reversed,
    canReverse: movement.type !== 'REVERSAL' && !reversed,
    actor: {
      id: movement.actorId,
      username: movement.actorUsername,
      displayName: movement.actorDisplayName
    },
    actorId: movement.actorId,
    actorUsername: movement.actorUsername,
    actorDisplayName: movement.actorDisplayName
  };
}

function publicMovements_(movements, allMovements) {
  var reversedIds = Object.create(null);
  allMovements.forEach(function (movement) {
    if (movement.type === 'REVERSAL' && movement.originalMovementId) reversedIds[movement.originalMovementId] = true;
  });
  return publicMovementsWithReversedMap_(movements, reversedIds);
}

function publicMovementsWithReversedMap_(movements, reversedIds) {
  return movements.map(function (movement) { return publicMovement_(movement, !!reversedIds[movement.id]); });
}

function movementDirection_(type, netChange) {
  if (type === 'IN') return 'INCOMING';
  if (type === 'OUT') return 'OUTGOING';
  if (type === 'REVERSAL') return Number(netChange) >= 0 ? 'REVERSAL_INCREASE' : 'REVERSAL_DECREASE';
  return 'UNKNOWN';
}

function movementBalancePreview_(movement, canSubmit) {
  return {
    itemId: movement.itemId,
    itemCode: movement.itemCode,
    itemName: movement.itemName,
    type: movement.type,
    direction: movementDirection_(movement.type, movement.netChange),
    quantity: roundQuantity_(movement.quantity),
    balanceBefore: roundQuantity_(movement.balanceBefore),
    netChange: roundQuantity_(movement.netChange),
    balanceAfter: roundQuantity_(movement.balanceAfter),
    canSubmit: canSubmit === undefined ? Number(movement.balanceAfter) >= -0.0000001 : !!canSubmit
  };
}

function permissionsForRole_(role) {
  return {
    canReadItems: true,
    canManageItems: role === 'ADMIN',
    canReadMovements: true,
    canCreateMovements: role === 'ADMIN' || role === 'STOREKEEPER',
    canReverseMovements: role === 'ADMIN' || role === 'STOREKEEPER',
    canManageUsers: role === 'ADMIN',
    canCreateBackups: role === 'ADMIN',
    canViewReports: true
  };
}

function publicSettings_() {
  return {
    systemName: getSettingValue_('SYSTEM_NAME') || WAREHOUSE_CONFIG_.APP_NAME,
    backupConfigured: !!getSettingValue_('BACKUP_FOLDER_ID'),
    schemaVersion: getSettingValue_('SCHEMA_VERSION') || WAREHOUSE_CONFIG_.SCHEMA_VERSION
  };
}

function catalogOwnerOptions_(items) {
  var seen = Object.create(null);
  (items || []).forEach(function (item) {
    var owner = String(item.owner || '').trim();
    if (owner) seen[owner] = true;
  });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
}

function preflightInventoryMutation_(schemaKey) {
  schemaMetadata_(schemaKey);
  preflightAuthAudit_();
}

/**
 * Inventory writes are already committed when their audit row is appended.
 * Reuse the bounded durable audit outbox so a transient audit failure returns
 * truthful success with a warning and is replayed by a later mutation.
 */
function appendCommittedInventoryAudit_(input) {
  return appendCommittedAuthAudit_(input);
}

function normalizeListEnum_(value, defaultValue, allowedValues, field, label) {
  var normalized = value === null || value === undefined || String(value).trim() === '' ? defaultValue : String(value).trim().toUpperCase();
  if (allowedValues.indexOf(normalized) === -1) {
    throw new WarehouseError_('VALIDATION_ERROR', 'قيمة ' + label + ' غير صالحة.', { field: field, allowed: allowedValues });
  }
  return normalized;
}

function validateDocumentDateRange_(fromKey, toKey) {
  if (fromKey && toKey && fromKey > toKey) {
    throw new WarehouseError_('VALIDATION_ERROR', 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.', { field: 'dateRange' });
  }
}

function normalizeClientRequestId_(value, required) {
  var text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) {
    if (required) throw new WarehouseError_('VALIDATION_ERROR', 'حقل معرف طلب العميل مطلوب.', { field: 'clientRequestId' });
    return '';
  }
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(text)) {
    throw new WarehouseError_('VALIDATION_ERROR', 'معرف طلب العميل غير صالح.', { field: 'clientRequestId' });
  }
  return text;
}

function correctionRequestKey_(clientRequestId, suffix) {
  var source = String(clientRequestId);
  if (source.length <= 98) return source + '_' + suffix;
  var hash = 2166136261;
  for (var i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return source.substring(0, 88) + '_' + suffix + '_' + (hash >>> 0).toString(36);
}

function movementRequestMatches_(movement, request, actorId) {
  return movement.type === request.type &&
    movement.itemId === request.itemId &&
    roundQuantity_(movement.quantity) === roundQuantity_(request.quantity) &&
    documentDateKey_(movement.documentDate) === documentDateKey_(request.documentDate) &&
    movement.party === request.party &&
    movement.reference === request.reference &&
    movement.notes === request.notes &&
    movement.actorId === actorId;
}

function reversalRequestMatches_(movement, request, actorId) {
  return movement.type === 'REVERSAL' &&
    movement.originalMovementId === request.originalMovementId &&
    movement.notes === request.reason &&
    documentDateKey_(movement.documentDate) === documentDateKey_(request.documentDate) &&
    movement.actorId === actorId;
}

function reversalDeduplicatedResult_(movement, originalMovementId) {
  return {
    movement: publicMovement_(movement, false),
    balancePreview: movementBalancePreview_(movement),
    originalMovementId: originalMovementId,
    deduplicated: true
  };
}

function validateItemLifecycleChange_(item, nextUnit, nextActive, movements) {
  var relatedMovements = movements.filter(function (movement) { return movement.itemId === item.id; });
  if (nextUnit !== item.unit && (roundQuantity_(item.openingQuantity) !== 0 || relatedMovements.length > 0)) {
    throw new WarehouseError_('ITEM_UNIT_IMMUTABLE', 'لا يمكن تغيير وحدة صنف له رصيد افتتاحي أو حركات مخزون.', { field: 'unit' });
  }
  if (item.active && !nextActive) {
    var currentBalance = calculateBalances_([item], relatedMovements)[item.id] || 0;
    if (roundQuantity_(currentBalance) !== 0) {
      throw new WarehouseError_('ITEM_HAS_STOCK', 'لا يمكن تعطيل صنف لديه رصيد حالي. صفّر الرصيد بحركة مخزون أولاً.', { currentBalance: roundQuantity_(currentBalance) });
    }
  }
}

function validateNewItemLifecycle_(active, openingQuantity) {
  if (!active && roundQuantity_(Number(openingQuantity) || 0) !== 0) {
    throw new WarehouseError_('ITEM_INACTIVE_WITH_STOCK', 'لا يمكن إنشاء صنف موقوف برصيد غير صفري. أنشئه نشطاً أو اجعل الرصيد صفراً.');
  }
}

function validateReversalItemState_(item) {
  if (item && item.active === false) {
    throw new WarehouseError_('ITEM_INACTIVE', 'فعّل الصنف أولاً قبل إنشاء حركة عكس قد تغيّر رصيده.');
  }
}

function validateReversalDocumentDate_(reversalDate, original) {
  if (!reversalDate || !original) return;
  var originalDate = original.documentDate || original.timestamp;
  if (originalDate && documentDateKey_(reversalDate) < documentDateKey_(originalDate)) {
    throw new WarehouseError_('REVERSAL_DATE_BEFORE_ORIGINAL', 'تاريخ العكس لا يمكن أن يسبق تاريخ الحركة الأصلية.', { field: 'documentDate' });
  }
}

function assertDocumentDateNotFuture_(date, fieldName) {
  var dateKey = documentDateKey_(date);
  var todayKey = Utilities.formatDate(new Date(), WAREHOUSE_CONFIG_.TIME_ZONE, 'yyyy-MM-dd');
  if (dateKey > todayKey) {
    throw new WarehouseError_('FUTURE_DOCUMENT_DATE', 'تاريخ المستند لا يمكن أن يكون في المستقبل.', { field: fieldName });
  }
}

function assertBalanceWithinLimit_(balance) {
  if (!isFinite(balance) || balance > MAX_QUANTITY_) {
    throw new WarehouseError_('STOCK_LIMIT_EXCEEDED', 'الرصيد الناتج يتجاوز الحد العددي الآمن للنظام.', { maximum: MAX_QUANTITY_ });
  }
}

function normalizeItemCode_(value) {
  var code = requireText_(value, 'رمز الصنف', 64, false).toUpperCase();
  try { code = code.normalize('NFKC'); } catch (ignored) { /* Supported by V8. */ }
  if (/\s/.test(code) || /^[=+@]/.test(code)) {
    throw new WarehouseError_('VALIDATION_ERROR', 'رمز الصنف يجب ألا يحتوي مسافات.', { field: 'code' });
  }
  return code;
}

function normalizeMovementType_(value) {
  var type = String(value || '').trim().toUpperCase();
  var incoming = ['IN', 'INCOMING', 'RECEIPT', 'وارد'];
  var outgoing = ['OUT', 'OUTGOING', 'ISSUE', 'صادر'];
  if (incoming.indexOf(type) !== -1) return 'IN';
  if (outgoing.indexOf(type) !== -1) return 'OUT';
  throw new WarehouseError_('VALIDATION_ERROR', 'نوع الحركة يجب أن يكون توريداً أو صرفاً.', { field: 'type' });
}

function parseDocumentDate_(value, fieldName) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  var text = String(value || '').trim();
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new WarehouseError_('VALIDATION_ERROR', 'تاريخ المستند يجب أن يكون بصيغة YYYY-MM-DD.', { field: fieldName });
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(year, month - 1, day, 12, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new WarehouseError_('VALIDATION_ERROR', 'تاريخ المستند غير صالح.', { field: fieldName });
  }
  return date;
}

function documentDateKey_(value) {
  if (!value) return '';
  return Utilities.formatDate(new Date(value), WAREHOUSE_CONFIG_.TIME_ZONE, 'yyyy-MM-dd');
}

function newestMovementFirst_(a, b) {
  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime() || b.rowNumber - a.rowNumber;
}

function roundQuantity_(number) {
  number = Number(number);
  if (!isFinite(number)) return 0;
  var rounded = Math.round(number * QUANTITY_SCALE_) / QUANTITY_SCALE_;
  return rounded === 0 ? 0 : rounded;
}
