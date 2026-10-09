import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './mock-data';
import { getBalances, transition, parseMoney, money } from './ledger';

test('approval moves reserved to committed without changing available budget', () => {
 const before = getBalances(initialState); const expense = initialState.expenses[0];
 const after = getBalances(transition(initialState, { function: 'approve_expense', id: expense.id }));
 assert.equal(after.reserved, before.reserved - expense.amount);
 assert.equal(after.approved, before.approved + expense.amount);
 assert.equal(after.available, before.available);
});
test('rejection and cancellation release reservations even while paused', () => {
 const paused = transition(initialState, { function: 'pause' });
 for(const fn of ['reject_expense','cancel_expense'] as const) {
  const after = transition(paused, { function: fn, id: 8n });
  assert.equal(getBalances(after).available, getBalances(paused).available + 248000n);
 }
 assert.throws(() => transition(paused, { function: 'approve_expense', id: 8n }), /paused/);
});
test('cap cannot be reduced below allocations and expense limit cannot exceed cap', () => {
 assert.throws(() => transition(initialState, { function: 'configure_budget', budget_cap: 1800000n, expense_limit: 10000n }), /below/);
 assert.throws(() => transition(initialState, { function: 'configure_budget', budget_cap: 5000000n, expense_limit: 5000001n }), /limit/);
});
test('removing a vendor preserves reservations but blocks approvals', () => {
 const removed = transition(initialState, { function: 'set_vendor', vendor: initialState.vendors[0], approved: false });
 assert.deepEqual(getBalances(removed), getBalances(initialState));
 assert.throws(() => transition(removed, { function: 'approve_expense', id: 8n }), /Vendor/);
});
test('lowering current limit blocks an existing pending approval', () => {
 const lowered = transition(initialState, { function: 'configure_budget', budget_cap: 5000000n, expense_limit: 10000n });
 assert.throws(() => transition(lowered, { function: 'approve_expense', id: 8n }), /limit/);
});
test('request reserves cents and validates agent, vendor, amount and available budget', () => {
 const request = { function: 'request_expense' as const, vendor: initialState.vendors[0].address, amount: 10000n, reference: 'a'.repeat(64), description: 'Test', date: '2026-10-09', category: 'Operations' };
 const next = transition(initialState, request);
 assert.equal(next.expenses[0].id, 9n); assert.equal(getBalances(next).reserved, getBalances(initialState).reserved + 10000n);
 assert.throws(() => transition(initialState, { ...request, amount: 0n }), /greater/);
 assert.throws(() => transition(initialState, { ...request, amount: 1000001n }), /limit/);
 assert.throws(() => transition(initialState, { ...request, vendor: 'unknown' }), /Vendor/);
 assert.throws(() => transition(transition(initialState, { function: 'set_agent', agent: null }), request), /agent/);
 const full = transition(initialState, { function: 'configure_budget', budget_cap: getBalances(initialState).reserved + getBalances(initialState).approved, expense_limit: 1000000n });
 assert.throws(() => transition(full, request), /budget/);
 assert.throws(() => transition(transition(initialState, { function: 'pause' }), request), /paused/);
});
test('terminal requests cannot be processed twice', () => {
 const approved = transition(initialState, { function: 'approve_expense', id: 8n });
 assert.throws(() => transition(approved, { function: 'reject_expense', id: 8n }), /pending/);
});
test('USD conversion is exact beyond JavaScript number precision', () => {
 assert.equal(parseMoney('0.01'), 1n); assert.equal(parseMoney('123.4'), 12340n);
 assert.equal(money(900719925474099301n), '$9,007,199,254,740,993.01');
 assert.throws(() => parseMoney('1.001')); assert.throws(() => parseMoney('-1'));
});
