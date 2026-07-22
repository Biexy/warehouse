(function () {
  'use strict';

  // Local preview only: `?mock=1&skipLogin=1` starts with a mock session.
  // This file is never included by the deployed Apps Script application.
  if (new URLSearchParams(window.location.search).get('skipLogin') === '1') {
    try {
      window.sessionStorage.setItem(
        'warehouse-control.session-token.v1',
        'wms_preview_token_1234567890123456789012345678901234567890'
      );
    } catch (ignored) { /* sessionStorage can be unavailable in private mode. */ }
  }

  var items = [
    { id: 'ITM-1', code: 'PUMP-017', name: 'مضخة مياه صناعية', owner: 'سلطة المياه', unit: 'قطعة', openingQuantity: 8, currentQuantity: 12, reorderLevel: 5, active: true, stockStatus: 'OK' },
    { id: 'ITM-2', code: 'VALVE-204', name: 'صمام تحكم نحاسي', owner: 'مصلحة المياه', unit: 'قطعة', openingQuantity: 5, currentQuantity: 3, reorderLevel: 4, active: true, stockStatus: 'LOW' },
    { id: 'ITM-3', code: 'FILTER-08', name: 'مرشح هواء دقيق', owner: 'سلطة المياه', unit: 'علبة', openingQuantity: 6, currentQuantity: 0, reorderLevel: 2, active: true, stockStatus: 'OUT' }
  ];
  for (var itemIndex = 4; itemIndex <= 84; itemIndex += 1) {
    var mockStatus = itemIndex % 17 === 0 ? 'OUT' : (itemIndex % 7 === 0 ? 'LOW' : 'OK');
    var mockReorder = 6 + (itemIndex % 5);
    var mockQuantity = mockStatus === 'OUT' ? 0 : (mockStatus === 'LOW' ? Math.max(1, mockReorder - 2) : mockReorder + 8 + (itemIndex % 12));
    items.push({
      id: 'ITM-' + itemIndex,
      code: 'PART-' + String(itemIndex).padStart(3, '0'),
      name: 'قطعة تشغيل تجريبية ' + itemIndex,
      owner: itemIndex % 2 === 0 ? 'سلطة المياه' : 'مصلحة المياه',
      unit: itemIndex % 3 === 0 ? 'علبة' : 'قطعة',
      openingQuantity: mockQuantity,
      currentQuantity: mockQuantity,
      reorderLevel: mockReorder,
      active: true,
      stockStatus: mockStatus
    });
  }
  var movements = [
    { id: 'MOV-1042', timestamp: '2026-07-21T09:42:00.000Z', documentDate: '2026-07-21', type: 'OUT', itemId: 'ITM-2', itemCode: 'VALVE-204', itemName: 'صمام تحكم نحاسي', quantity: 2, balanceBefore: 5, balanceAfter: 3, party: 'قسم الصيانة', reference: 'ISS-884', notes: '', canReverse: true, reversed: false, actor: { username: 'admin', displayName: 'مدير النظام' } },
    { id: 'MOV-1041', timestamp: '2026-07-20T12:10:00.000Z', documentDate: '2026-07-20', type: 'IN', itemId: 'ITM-1', itemCode: 'PUMP-017', itemName: 'مضخة مياه صناعية', quantity: 4, balanceBefore: 8, balanceAfter: 12, party: 'المورد المحلي', reference: 'REC-332', notes: '', canReverse: true, reversed: false, actor: { username: 'admin', displayName: 'مدير النظام' } }
  ];
  var catalogRegressionMode = new URLSearchParams(window.location.search).get('catalogRegression') === '1';
  if (catalogRegressionMode) {
    var savedRegressionState = window.sessionStorage.getItem('warehouse-catalog-regression-state-v1');
    if (savedRegressionState) {
      var parsedRegressionState = JSON.parse(savedRegressionState);
      items.splice.apply(items, [0, items.length].concat(parsedRegressionState.items || []));
      movements.splice.apply(movements, [0, movements.length].concat(parsedRegressionState.movements || []));
    } else {
      items.splice(0, items.length); movements.splice(0, movements.length);
    }
  }
  function persistRegressionState() {
    if (catalogRegressionMode) window.sessionStorage.setItem('warehouse-catalog-regression-state-v1', JSON.stringify({items:items,movements:movements}));
  }
  items.forEach(function (item) {
    item.totalIncoming = movements.filter(function (movement) { return movement.itemId === item.id && movement.type === 'IN'; }).reduce(function (sum, movement) { return sum + movement.quantity; }, 0);
    item.totalOutgoing = movements.filter(function (movement) { return movement.itemId === item.id && movement.type === 'OUT'; }).reduce(function (sum, movement) { return sum + movement.quantity; }, 0);
  });
  var users = [
    { id: 'USR-1', username: 'admin', displayName: 'مدير النظام', role: 'ADMIN', active: true, forcePasswordChange: false, lastLoginAt: '2026-07-21T09:30:00.000Z' },
    { id: 'USR-2', username: 'امين_المخزن', displayName: 'أمين المخزن', role: 'STOREKEEPER', active: true, forcePasswordChange: false, lastLoginAt: '2026-07-20T08:00:00.000Z' },
    { id: 'USR-3', username: 'auditor', displayName: 'المراقب الداخلي', role: 'AUDITOR', active: true, forcePasswordChange: false, lastLoginAt: '2026-07-19T10:15:00.000Z' }
  ];

  function previewUser() {
    var requestedRole = String(new URLSearchParams(window.location.search).get('role') || 'ADMIN').toUpperCase();
    return users.find(function (user) { return user.role === requestedRole; }) || users[0];
  }

  function dashboard(days) {
    days = [7, 30, 90].indexOf(Number(days)) === -1 ? 30 : Number(days);
    var trend = [];
    var incomingCount = 0;
    var outgoingCount = 0;
    var incomingQuantity = 0;
    var outgoingQuantity = 0;
    for (var offset = days - 1; offset >= 0; offset -= 1) {
      var date = new Date(Date.UTC(2026, 6, 21 - offset));
      var dayInCount = offset % 5 === 0 ? 2 : (offset % 3 === 0 ? 1 : 0);
      var dayOutCount = offset % 4 === 0 ? 2 : 1;
      var dayInQuantity = dayInCount * (4 + (offset % 7));
      var dayOutQuantity = dayOutCount * (2 + (offset % 5));
      incomingCount += dayInCount;
      outgoingCount += dayOutCount;
      incomingQuantity += dayInQuantity;
      outgoingQuantity += dayOutQuantity;
      trend.push({
        date: date.toISOString().slice(0, 10),
        movementCount: dayInCount + dayOutCount,
        inCount: dayInCount,
        outCount: dayOutCount,
        reversalCount: 0,
        inQuantity: dayInQuantity,
        outQuantity: dayOutQuantity,
        reversalNetQuantity: 0,
        netQuantity: dayInQuantity - dayOutQuantity,
        incomingCount: dayInCount,
        outgoingCount: dayOutCount,
        incomingQuantity: dayInQuantity,
        outgoingQuantity: dayOutQuantity
      });
    }
    var availableCount = items.filter(function (item) { return item.stockStatus === 'OK'; }).length;
    var lowCount = items.filter(function (item) { return item.stockStatus === 'LOW'; }).length;
    var outCount = items.filter(function (item) { return item.stockStatus === 'OUT'; }).length;
    var urgentItems = items.filter(function (item) { return item.stockStatus !== 'OK'; }).sort(function (a, b) {
      if (a.stockStatus !== b.stockStatus) return a.stockStatus === 'OUT' ? -1 : 1;
      return (a.currentQuantity / Math.max(a.reorderLevel, 1)) - (b.currentQuantity / Math.max(b.reorderLevel, 1));
    }).slice(0, 10);
    var stockStatusCounts = { AVAILABLE: availableCount, LOW: lowCount, OUT: outCount, INACTIVE: 0 };
    var rangeFlow = {
      movementCount: incomingCount + outgoingCount,
      incoming: { movementCount: incomingCount, quantity: incomingQuantity },
      outgoing: { movementCount: outgoingCount, quantity: outgoingQuantity },
      reversals: { movementCount: 0, netQuantity: 0, increaseQuantity: 0, decreaseQuantity: 0 },
      netQuantity: incomingQuantity - outgoingQuantity
    };
    var summary = {
      totalItems: items.length,
      activeItems: items.length,
      inactiveItems: 0,
      availableItems: availableCount,
      lowStockItems: lowCount,
      outOfStockItems: outCount,
      actionNeededCount: lowCount + outCount,
      healthyPercentage: Math.round((availableCount / items.length) * 100),
      movementCount: incomingCount + outgoingCount,
      incomingMovementCount: incomingCount,
      outgoingMovementCount: outgoingCount,
      incomingQuantity: incomingQuantity,
      outgoingQuantity: outgoingQuantity,
      mixedUnits: true
    };
    var ownerSummaryMap = items.reduce(function (result, item) {
      var owner = item.owner || 'غير محدد';
      if (!result[owner]) result[owner] = { owner: owner, itemCount: 0, currentQuantity: 0, actionNeededCount: 0 };
      result[owner].itemCount += 1;
      result[owner].currentQuantity += item.currentQuantity;
      if (item.stockStatus !== 'OK') result[owner].actionNeededCount += 1;
      return result;
    }, {});
    return {
      generatedAt: '2026-07-21T12:00:00.000Z',
      range: { days: days, from: trend[0].date, to: trend[trend.length - 1].date, dateBasis: 'DOCUMENT_DATE_OR_SERVER_TIMESTAMP' },
      summary: summary,
      totalItems: items.length,
      activeItems: items.length,
      totalQuantity: items.reduce(function (sum, item) { return sum + item.currentQuantity; }, 0),
      availableCount: availableCount,
      lowStockCount: lowCount,
      outOfStockCount: outCount,
      actionNeededCount: lowCount + outCount,
      healthyPercent: Math.round((availableCount / items.length) * 100),
      movementsToday: 3,
      incomingToday: 12,
      outgoingToday: 5,
      periodDays: days,
      periodStart: trend[0].date,
      periodEnd: trend[trend.length - 1].date,
      movementCount: incomingCount + outgoingCount,
      incomingCount: incomingCount,
      outgoingCount: outgoingCount,
      incomingQuantity: incomingQuantity,
      outgoingQuantity: outgoingQuantity,
      statusCounts: { available: availableCount, low: lowCount, out: outCount },
      stockStatusCounts: stockStatusCounts,
      stockStatusDistribution: [
        { status: 'AVAILABLE', count: availableCount, percentage: Math.round((availableCount / items.length) * 100) },
        { status: 'LOW', count: lowCount, percentage: Math.round((lowCount / items.length) * 100) },
        { status: 'OUT', count: outCount, percentage: Math.round((outCount / items.length) * 100) },
        { status: 'INACTIVE', count: 0, percentage: 0 }
      ],
      rangeFlow: rangeFlow,
      dailyMovementTrend: trend,
      movementTrend: trend,
      ownerSummary: Object.keys(ownerSummaryMap).map(function (owner) { return ownerSummaryMap[owner]; }),
      urgentItems: urgentItems,
      recentMovements: movements
    };
  }

  function paginate(rows, params, key) {
    var page = Number(params && params.page) || 1;
    var pageSize = Number(params && params.pageSize) || 25;
    var start = (page - 1) * pageSize;
    var result = {};
    result[key] = rows.slice(start, start + pageSize);
    result.page = page;
    result.pageSize = pageSize;
    result.total = rows.length;
    result.hasMore = start + pageSize < rows.length;
    return result;
  }

  function filterItems(params) {
    params = params || {};
    var query = String(params.query || '').trim().toLocaleLowerCase('ar');
    var status = String(params.status || '').toUpperCase();
    return items.filter(function (item) {
      if (query && [item.code, item.name, item.owner, item.unit].join(' ').toLocaleLowerCase('ar').indexOf(query) === -1) return false;
      if (params.owner && item.owner !== params.owner) return false;
      if (status === 'ACTIVE' && item.active === false) return false;
      if (status === 'INACTIVE' && item.active !== false) return false;
      if ((status === 'AVAILABLE' || status === 'OK') && item.stockStatus !== 'OK') return false;
      if (status === 'LOW' && item.stockStatus !== 'LOW') return false;
      if (status === 'OUT' && item.stockStatus !== 'OUT') return false;
      return true;
    });
  }

  function filterMovements(params) {
    params = params || {};
    var query = String(params.query || '').trim().toLocaleLowerCase('ar');
    var itemQuery = String(params.itemQuery || '').trim().toLocaleLowerCase('ar');
    var owner = String(params.owner || '').trim();
    var type = String(params.type || '').toUpperCase();
    return movements.filter(function (movement) {
      if (type && type !== 'ALL' && movement.type !== type) return false;
      if (params.itemId && movement.itemId !== params.itemId) return false;
      var currentItem = items.find(function (item) { return item.id === movement.itemId; });
      if (owner && (!currentItem || currentItem.owner !== owner)) return false;
      var itemHaystack = [movement.itemCode, movement.itemName, currentItem && currentItem.code, currentItem && currentItem.name, currentItem && currentItem.owner].join(' ').toLocaleLowerCase('ar');
      if (itemQuery && itemHaystack.indexOf(itemQuery) === -1) return false;
      if (params.dateFrom && movement.documentDate < params.dateFrom) return false;
      if (params.dateTo && movement.documentDate > params.dateTo) return false;
      var haystack = [movement.id, movement.itemCode, movement.itemName, movement.party, movement.reference, movement.notes].join(' ').toLocaleLowerCase('ar');
      return !query || haystack.indexOf(query) !== -1;
    });
  }

  function movementReport(filtered) {
    var byUnitMap = Object.create(null);
    var byItemMap = Object.create(null);
    filtered.forEach(function (movement) {
      var item = items.find(function (candidate) { return candidate.id === movement.itemId; });
      var unit = item && item.unit || 'غير محدد';
      var net = movement.type === 'IN' ? movement.quantity : movement.type === 'OUT' ? -movement.quantity : Number(movement.netChange) || 0;
      if (!byUnitMap[unit]) byUnitMap[unit] = { unit: unit, incoming: 0, outgoing: 0, reversalNet: 0, net: 0, currentBalance: 0 };
      if (!byItemMap[movement.itemId]) {
        byItemMap[movement.itemId] = {
          itemId: movement.itemId,
          itemCode: movement.itemCode,
          itemName: movement.itemName,
          owner: item && item.owner || 'غير محدد',
          unit: unit,
          incoming: 0,
          outgoing: 0,
          reversalNet: 0,
          net: 0,
          currentBalance: item ? item.currentQuantity : null
        };
        byUnitMap[unit].currentBalance += item ? item.currentQuantity : 0;
      }
      [byUnitMap[unit], byItemMap[movement.itemId]].forEach(function (bucket) {
        if (movement.type === 'IN') bucket.incoming += movement.quantity;
        if (movement.type === 'OUT') bucket.outgoing += movement.quantity;
        if (movement.type === 'REVERSAL') bucket.reversalNet += net;
        bucket.net += net;
      });
    });
    return {
      movementCount: filtered.length,
      byUnit: Object.keys(byUnitMap).map(function (key) { return byUnitMap[key]; }),
      byItem: Object.keys(byItemMap).map(function (key) { return byItemMap[key]; })
    };
  }

  function bootstrap() {
    var user = previewUser();
    return {
      user: user,
      permissions: {
        canManageItems: user.role === 'ADMIN',
        canCreateMovements: user.role === 'ADMIN' || user.role === 'STOREKEEPER',
        canReverseMovements: user.role === 'ADMIN' || user.role === 'STOREKEEPER',
        canManageUsers: user.role === 'ADMIN',
        canCreateBackups: user.role === 'ADMIN'
      },
      passwordChangeRequired: false,
      dashboard: dashboard(30),
      items: items.slice(0, 50),
      owners: ['سلطة المياه', 'مصلحة المياه'],
      itemCatalog: { total: items.length, activeTotal: items.length, returned: 50, truncated: true, limit: 50, mode: 'ACTIVE_CAPPED', sort: 'CODE_NAME_ID' },
      recentMovements: movements,
      settings: { systemName: 'نظام مراقبة المخزون', backupConfigured: false, schemaVersion: '2', catalogImportCompleted: providedCatalogComplete() }
    };
  }

  function providedCatalogComplete() {
    for (var catalogIndex = 1; catalogIndex <= 76; catalogIndex += 1) {
      var code = 'ITEM' + String(catalogIndex).padStart(3, '0');
      if (!items.some(function (item) { return item.code === code; })) return false;
    }
    return true;
  }

  function handle(method, args) {
    var payload = args.length > 1 ? args[1] || {} : args[0] || {};
    if (method === 'authenticate') return { token: 'wms_preview_token_1234567890123456789012345678901234567890', expiresAt: '2026-07-21T15:30:00.000Z', user: previewUser() };
    if (method === 'getBootstrap') {
      var sessionMode = new URLSearchParams(window.location.search).get('session');
      if (sessionMode === 'expired' || sessionMode === 'revoked') throw Object.assign(new Error('انتهت الجلسة. سجّل الدخول مجدداً.'), { code: sessionMode === 'expired' ? 'SESSION_EXPIRED' : 'INVALID_SESSION' });
      return bootstrap();
    }
    if (method === 'getDashboard') return dashboard(payload.days);
    if (method === 'getInventoryReport') {
      var reportItems = filterItems(payload);
      return {
        items: reportItems,
        total: reportItems.length,
        owners: ['سلطة المياه', 'مصلحة المياه'],
        filters: { query: payload.query || '', owner: payload.owner || '', status: payload.status || 'ALL' },
        generatedAt: new Date().toISOString(),
        dashboard: dashboard(30),
        recentMovements: movements.slice(0, 10)
      };
    }
    if (method === 'listItems') {
      var itemResult = paginate(filterItems(payload), payload, 'items');
      itemResult.owners = ['سلطة المياه', 'مصلحة المياه'];
      return itemResult;
    }
    if (method === 'listMovements') {
      var filteredMovements = filterMovements(payload);
      var movementResult = paginate(filteredMovements, payload, 'movements');
      movementResult.summary = movementReport(filteredMovements);
      return movementResult;
    }
    if (method === 'getMovementExport') {
      var exportMovements = filterMovements(payload);
      return { movements: exportMovements, total: exportMovements.length, summary: movementReport(exportMovements), generatedAt: new Date().toISOString() };
    }
    if (method === 'listUsers') return paginate(users, payload, 'users');
    if (method === 'logout') return { loggedOut: true };
    if (method === 'saveMovement') {
      var duplicateMovement = movements.find(function (movement) { return movement.clientRequestId === payload.clientRequestId; });
      if (duplicateMovement) return { movement: duplicateMovement, deduplicated: true };
      var movementItem = items.find(function (item) { return item.id === payload.itemId; });
      if (!movementItem) throw Object.assign(new Error('الصنف غير موجود.'), { code: 'ITEM_NOT_FOUND' });
      var quantity = Number(payload.quantity);
      var nextBalance = movementItem.currentQuantity + (payload.type === 'IN' ? quantity : -quantity);
      if (nextBalance < 0) throw Object.assign(new Error('الرصيد غير كافٍ لتنفيذ حركة الصرف.'), { code: 'INSUFFICIENT_STOCK' });
      var createdMovement = { id: 'MOV-MOCK-' + (movements.length + 1), clientRequestId: payload.clientRequestId, timestamp: new Date().toISOString(), documentDate: payload.documentDate, type: payload.type, itemId: movementItem.id, itemCode: movementItem.code, itemName: movementItem.name, quantity: quantity, netChange: payload.type === 'IN' ? quantity : -quantity, balanceBefore: movementItem.currentQuantity, balanceAfter: nextBalance, party: payload.party, reference: payload.reference, notes: payload.notes || '', canReverse: true, reversed: false, actor: { username: previewUser().username, displayName: previewUser().displayName }, actorDisplayName: previewUser().displayName };
      movementItem.currentQuantity = nextBalance;
      if (payload.type === 'IN') movementItem.totalIncoming = Number(movementItem.totalIncoming || 0) + quantity;
      else movementItem.totalOutgoing = Number(movementItem.totalOutgoing || 0) + quantity;
      movements.unshift(createdMovement);
      persistRegressionState();
      return { movement: createdMovement, deduplicated: false };
    }
    if (method === 'correctMovement') return { reversal: movements[0], movement: movements[1], originalMovementId: payload.movementId, deduplicated: false };
    if (method === 'reverseMovement') return { movement: movements[0] };
    if (method === 'saveItem') return { item: items[0] };
    if (method === 'importProvidedCatalog') {
      var created = 0;
      var skippedCodes = [];
      for (var catalogIndex = 1; catalogIndex <= 76; catalogIndex += 1) {
        var code = 'ITEM' + String(catalogIndex).padStart(3, '0');
        if (items.some(function (item) { return item.code === code; })) {
          skippedCodes.push(code);
          continue;
        }
        var owner = catalogIndex % 2 === 0 ? 'سلطة المياه' : 'مصلحة المياه';
        items.push({ id: 'ITM-CATALOG-' + catalogIndex, code: code, name: 'صنف القائمة الجاهزة ' + code, owner: owner, unit: 'قطعة', openingQuantity: catalogIndex % 12 + 1, currentQuantity: catalogIndex % 12 + 1, reorderLevel: 0, active: true, stockStatus: 'OK' });
        created += 1;
      }
      persistRegressionState();
      return { catalogTotal: 76, created: created, skipped: skippedCodes.length, skippedCodes: skippedCodes, conflictingCodes: [], owners: ['سلطة المياه', 'مصلحة المياه'], unit: 'قطعة', reorderLevel: 0, completed: providedCatalogComplete() };
    }
    if (method === 'saveUser') return { user: users[1], temporaryPassword: 'Z!7aPreviewPassword1' };
    if (method === 'resetUserPassword') return { user: users[1], temporaryPassword: 'Z!7aPreviewPassword2' };
    if (method === 'changeMyPassword') return { changed: true, requiresLogin: true };
    if (method === 'configureBackupFolder') return { folderId: 'preview-folder-123', folderName: 'نسخ المخزون' };
    if (method === 'createBackup') return { fileId: 'preview-file-123', fileName: 'warehouse-preview.xlsx', url: '#preview-file', createdAt: new Date().toISOString(), sizeBytes: 48128 };
    throw Object.assign(new Error('Unknown preview RPC: ' + method), { code: 'UNKNOWN_RPC' });
  }

  function createRunner() {
    var success = function () {};
    var failure = function () {};
    var proxy = new Proxy({}, {
      get: function (_target, property) {
        if (property === 'withSuccessHandler') return function (handler) { success = handler; return proxy; };
        if (property === 'withFailureHandler') return function (handler) { failure = handler; return proxy; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          window.setTimeout(function () {
            try { success({ ok: true, data: handle(String(property), args) }); }
            catch (error) { failure(error); }
          }, 40);
        };
      }
    });
    return proxy;
  }

  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: createRunner });
  window.__warehouseMock = { handle: handle, items: items, movements: movements };
})();
