import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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

const context = vm.createContext({
  console,
  Utilities: {
    getUuid() {
      return `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    },
    formatDate(value, timeZone, pattern) {
      if (pattern !== 'yyyy-MM-dd') throw new Error(`Unsupported test date pattern: ${pattern}`);
      return dateKey(value, timeZone);
    }
  }
});

const inventorySource = fs.readFileSync('warehouse-one-tab/Inventory.gs', 'utf8');
const backend = [fs.readFileSync('warehouse-one-tab/Code.gs', 'utf8'), fs.readFileSync('warehouse-one-tab/Repository.gs', 'utf8'), inventorySource].join('\n');
vm.runInContext(backend, context, { filename: 'inventory-backend.gs' });

function expectWarehouseError(code, callable) {
  assert.throws(callable, (error) => error && error.code === code, `Expected ${code}`);
}

// Filter inputs fail closed instead of silently behaving as ALL.
assert.equal(context.normalizeListEnum_('', 'ALL', context.ITEM_LIST_STATUSES_, 'status', 'status'), 'ALL');
assert.equal(context.normalizeListEnum_('low', 'ALL', context.ITEM_LIST_STATUSES_, 'status', 'status'), 'LOW');
expectWarehouseError('VALIDATION_ERROR', () => context.normalizeListEnum_('nonsense', 'ALL', context.ITEM_LIST_STATUSES_, 'status', 'status'));
expectWarehouseError('VALIDATION_ERROR', () => context.normalizeListEnum_('receipt', 'ALL', context.MOVEMENT_LIST_TYPES_, 'type', 'type'));
context.validateDocumentDateRange_('2026-07-01', '2026-07-31');
expectWarehouseError('VALIDATION_ERROR', () => context.validateDocumentDateRange_('2026-08-01', '2026-07-31'));

// Future business dates are rejected while historical dates remain valid.
context.assertDocumentDateNotFuture_(new Date('2020-01-01T12:00:00Z'), 'documentDate');
expectWarehouseError('FUTURE_DOCUMENT_DATE', () => context.assertDocumentDateNotFuture_(new Date('2099-01-01T12:00:00Z'), 'documentDate'));

// A unit cannot relabel existing stock/history, and stock cannot be hidden by
// deactivating a non-zero item.
const stockedItem = { id: 'ITM-1', unit: 'kg', openingQuantity: 10, active: true };
expectWarehouseError('ITEM_UNIT_IMMUTABLE', () => context.validateItemLifecycleChange_(stockedItem, 'box', true, []));
expectWarehouseError('ITEM_HAS_STOCK', () => context.validateItemLifecycleChange_(stockedItem, 'kg', false, []));
const zeroOpeningItem = { id: 'ITM-2', unit: 'piece', openingQuantity: 0, active: true };
const settledMovements = [
  { itemId: 'ITM-2', netChange: 5 },
  { itemId: 'ITM-2', netChange: -5 }
];
expectWarehouseError('ITEM_UNIT_IMMUTABLE', () => context.validateItemLifecycleChange_(zeroOpeningItem, 'box', true, settledMovements));
context.validateItemLifecycleChange_(zeroOpeningItem, 'piece', false, settledMovements);
context.validateNewItemLifecycle_(true, 10);
context.validateNewItemLifecycle_(false, 0);
expectWarehouseError('ITEM_INACTIVE_WITH_STOCK', () => context.validateNewItemLifecycle_(false, 1));
expectWarehouseError('ITEM_INACTIVE_WITH_STOCK', () => context.validateNewItemLifecycle_(false, 0.000001));
expectWarehouseError('ITEM_INACTIVE', () => context.validateReversalItemState_({ id: 'ITM-OFF', active: false }));
context.validateReversalDocumentDate_(new Date('2026-07-10T12:00:00Z'), { documentDate: new Date('2026-07-10T12:00:00Z') });
expectWarehouseError('REVERSAL_DATE_BEFORE_ORIGINAL', () => context.validateReversalDocumentDate_(
  new Date('2026-07-09T12:00:00Z'),
  { documentDate: new Date('2026-07-10T12:00:00Z') }
));

// Idempotency succeeds only for the same normalized payload and actor.
const originalRequest = {
  itemId: 'ITM-1',
  type: 'IN',
  quantity: 2.5,
  documentDate: new Date('2026-07-20T12:00:00Z'),
  party: 'Supplier',
  reference: 'INV-1',
  notes: 'ok'
};
const storedMovement = {
  ...originalRequest,
  actorId: 'USR-1'
};
assert.equal(context.movementRequestMatches_(storedMovement, originalRequest, 'USR-1'), true);
assert.equal(context.movementRequestMatches_(storedMovement, { ...originalRequest, quantity: 3 }, 'USR-1'), false);
assert.equal(context.movementRequestMatches_(storedMovement, originalRequest, 'USR-2'), false);

const reversalRequest = { originalMovementId: 'MOV-1', reason: 'duplicate', documentDate: '' };
const storedReversal = { type: 'REVERSAL', originalMovementId: 'MOV-1', notes: 'duplicate', documentDate: null, actorId: 'USR-1' };
assert.equal(context.reversalRequestMatches_(storedReversal, reversalRequest, 'USR-1'), true);
assert.equal(context.reversalRequestMatches_(storedReversal, { ...reversalRequest, reason: 'other' }, 'USR-1'), false);

// Report quantities are separated by unit. Current balances use the complete
// ledger, while flow values use the complete filtered set passed to summary.
const items = [
  { id: 'ITM-KG', code: 'KG-1', name: 'Powder', owner: 'مصلحة المياه', unit: 'kg', openingQuantity: 10, reorderLevel: 0, active: true },
  { id: 'ITM-PC', code: 'PC-1', name: 'Valve', owner: 'سلطة المياه', unit: 'piece', openingQuantity: 20, reorderLevel: 0, active: true }
];
const movements = [
  { id: 'M1', type: 'IN', itemId: 'ITM-KG', itemCode: 'KG-1', itemName: 'Powder', quantity: 5, netChange: 5 },
  { id: 'M2', type: 'OUT', itemId: 'ITM-KG', itemCode: 'KG-1', itemName: 'Powder', quantity: 2, netChange: -2 },
  { id: 'M3', type: 'REVERSAL', itemId: 'ITM-KG', itemCode: 'KG-1', itemName: 'Powder', quantity: 1, netChange: -1 },
  { id: 'M4', type: 'OUT', itemId: 'ITM-PC', itemCode: 'PC-1', itemName: 'Valve', quantity: 4, netChange: -4 }
];
const summary = context.movementReportSummary_(movements, items, movements);
assert.equal(summary.movementCount, 4);
assert.equal(Object.hasOwn(summary, 'incoming'), false, 'Top-level cross-unit quantity totals must not exist');
assert.equal(summary.byUnit.length, 2);
const kg = summary.byUnit.find((entry) => entry.unit === 'kg');
const piece = summary.byUnit.find((entry) => entry.unit === 'piece');
assert.deepEqual(JSON.parse(JSON.stringify(kg)), { unit: 'kg', incoming: 5, outgoing: 2, reversalNet: -1, net: 2, currentBalance: 12 });
assert.deepEqual(JSON.parse(JSON.stringify(piece)), { unit: 'piece', incoming: 0, outgoing: 4, reversalNet: 0, net: -4, currentBalance: 16 });
assert.equal(summary.byItem.find((entry) => entry.itemId === 'ITM-KG').currentBalance, 12);
assert.equal(summary.byItem.find((entry) => entry.itemId === 'ITM-PC').currentBalance, 16);
const summaryCallPosition = inventorySource.indexOf('var reportSummary = movementReportSummary_');
const paginationPosition = inventorySource.indexOf('movements.slice(', summaryCallPosition);
assert.ok(summaryCallPosition !== -1 && paginationPosition > summaryCallPosition, 'Movement summary must be computed before pagination');
assert.match(inventorySource, /itemCode:\s*original\.itemCode\s*\|\|\s*item\.code/);
assert.match(inventorySource, /itemName:\s*original\.itemName\s*\|\|\s*item\.name/);

// The movement item filter searches the complete item set by snapshot/current
// code, name, or owner; it is not limited to bootstrap's first 50 options.
const originalRequireSession = context.requireSession_;
const originalEnsureSchema = context.ensureRepositorySchemaCurrent_;
const originalAllItems = context.allItemRecords_;
const originalAllMovements = context.allMovementRecords_;
const originalInventorySnapshot = context.inventorySnapshot_;
const originalDashboardFromSnapshot = context.dashboardFromSnapshot_;
context.requireSession_ = () => ({ user: { id: 'USR-1', role: 'ADMIN' } });
context.ensureRepositorySchemaCurrent_ = () => false;
context.allItemRecords_ = () => items;
context.allMovementRecords_ = () => movements;
const ownerFiltered = context.listMovements('token', { itemQuery: 'سلطة المياه', page: 1, pageSize: 25 });
assert.equal(ownerFiltered.ok, true);
assert.equal(ownerFiltered.data.total, 1);
assert.equal(ownerFiltered.data.movements[0].itemId, 'ITM-PC');
const explicitOwnerFiltered = context.listMovements('token', { owner: 'مصلحة المياه', page: 1, pageSize: 25 });
assert.equal(explicitOwnerFiltered.ok, true);
assert.equal(explicitOwnerFiltered.data.total, 3);
assert.ok(explicitOwnerFiltered.data.movements.every((movement) => movement.itemId === 'ITM-KG'));

// Full CSV/PDF exports use the same filters as the table, but never inherit
// its pagination limit.
context.inventorySnapshot_ = () => ({
  items,
  movements,
  recentRows: movements.slice(0, 2),
  balances: { 'ITM-KG': 12, 'ITM-PC': 16 },
  itemStats: {
    'ITM-KG': { totalIncoming: 5, totalOutgoing: 2, reversalNet: -1, movementCount: 3 },
    'ITM-PC': { totalIncoming: 0, totalOutgoing: 4, reversalNet: 0, movementCount: 1 }
  }
});
context.dashboardFromSnapshot_ = () => ({ summary: { totalItems: 2, actionNeededCount: 0, movementCount: 4 } });
const pagedItems = context.listItems('token', { page: 1, pageSize: 1 });
const completeInventoryReport = context.getInventoryReport('token', {});
assert.equal(pagedItems.ok, true);
assert.equal(pagedItems.data.items.length, 1);
assert.equal(completeInventoryReport.ok, true);
assert.equal(completeInventoryReport.data.items.length, 2, 'Inventory report must not inherit table pagination');
assert.equal(completeInventoryReport.data.items[0].totalIncoming, 5);
const completeMovementExport = context.getMovementExport('token', { page: 1, pageSize: 1 });
assert.equal(completeMovementExport.ok, true);
assert.equal(completeMovementExport.data.movements.length, 4, 'Movement export must not inherit table pagination');
assert.equal(completeMovementExport.data.summary.movementCount, 4);

// A correction validates both halves before one batch append. Retrying the
// same client request returns the same reversal/replacement without new rows.
context.requireSession_ = () => ({ user: { id: 'USR-1', username: 'admin', displayName: 'Admin', role: 'ADMIN' } });
context.preflightInventoryMutation_ = () => {};
context.withScriptLock_ = (callable) => callable();
context.appendCommittedInventoryAudit_ = () => null;
context.appendMovementRecords_ = (records) => {
  records.forEach((record, index) => {
    record.rowNumber = movements.length + index + 2;
    movements.push(record);
  });
  return records;
};
const correctionPayload = {
  movementId: 'M4',
  reason: 'Correct quantity',
  clientRequestId: 'correction_test_001',
  itemId: 'ITM-PC',
  type: 'OUT',
  quantity: 3,
  documentDate: '2026-07-20',
  party: 'Maintenance',
  reference: 'OUT-CORRECTED',
  notes: 'Replacement for M4'
};
const corrected = context.correctMovement('token', correctionPayload);
assert.equal(corrected.ok, true);
assert.equal(corrected.data.reversal.type, 'REVERSAL');
assert.equal(corrected.data.movement.type, 'OUT');
assert.equal(corrected.data.reversal.balanceAfter, 20);
assert.equal(corrected.data.movement.balanceBefore, 20);
assert.equal(corrected.data.movement.balanceAfter, 17);
assert.equal(movements.length, 6);
const correctedRetry = context.correctMovement('token', correctionPayload);
assert.equal(correctedRetry.ok, true);
assert.equal(correctedRetry.data.deduplicated, true);
assert.equal(movements.length, 6);
context.requireSession_ = originalRequireSession;
context.ensureRepositorySchemaCurrent_ = originalEnsureSchema;
context.allItemRecords_ = originalAllItems;
context.allMovementRecords_ = originalAllMovements;
context.inventorySnapshot_ = originalInventorySnapshot;
context.dashboardFromSnapshot_ = originalDashboardFromSnapshot;

// Rows containing only template/default values never become domain records.
function makeTable(schema, rowObjects) {
  const values = schema.order.map((key) => schema.columns[key]);
  const byLabel = Object.fromEntries(values.map((label, index) => [label, index + 1]));
  return {
    schema,
    headers: { values, byLabel },
    rows: rowObjects.map((rowObject, index) => ({
      rowNumber: index + 2,
      values: schema.order.map((key) => rowObject[key] ?? '')
    }))
  };
}

const itemTable = makeTable(context.REPOSITORY_SCHEMA_.ITEMS, [
  { active: false, openingQuantity: 0 },
  { id: 'ITM-REAL', code: 'REAL', name: 'Real', unit: 'piece', active: true }
]);
context.schemaTable_ = () => itemTable;
assert.equal(context.allItemRecords_().length, 1);
assert.equal(context.allItemRecords_()[0].id, 'ITM-REAL');

const movementTable = makeTable(context.REPOSITORY_SCHEMA_.MOVEMENTS, [
  { quantity: 0, netChange: 0 },
  { id: 'MOV-REAL', type: 'IN', itemId: 'ITM-REAL', quantity: 1, netChange: 1 }
]);
context.schemaTable_ = () => movementTable;
assert.equal(context.allMovementRecords_().length, 1);
assert.equal(context.allMovementRecords_()[0].id, 'MOV-REAL');

// The one-micro-unit resolution remains representable at the supported cap.
assert.notEqual(context.roundQuantity_(context.MAX_QUANTITY_ - 0.000001), context.MAX_QUANTITY_);
expectWarehouseError('STOCK_LIMIT_EXCEEDED', () => context.assertBalanceWithinLimit_(context.MAX_QUANTITY_ + 1));

console.log('inventory validation/idempotency: ok');
console.log('inventory lifecycle guards: ok');
console.log('movement report unit grouping: ok');
console.log('movement item search across the complete catalog: ok');
console.log('complete filtered inventory and movement exports: ok');
console.log('atomic correction and retry deduplication: ok');
console.log('template-row filtering: ok');
console.log('quantity safety bound: ok');
