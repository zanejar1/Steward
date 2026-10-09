import { Balances, Command, DemoState } from './types';
export function getBalances(s: DemoState): Balances {
 const reserved = s.expenses.filter(e => e.status === 'Pending').reduce((sum, e) => sum + e.amount, 0n);
 const approved = s.expenses.filter(e => e.status === 'Approved').reduce((sum, e) => sum + e.amount, 0n);
 return { reserved, approved, available: s.policy.budget_cap - reserved - approved };
}
export function money(cents: bigint) { const negative = cents < 0n; const n = negative ? -cents : cents; return `${negative ? '-' : ''}$${(n / 100n).toLocaleString('en-US')}.${(n % 100n).toString().padStart(2, '0')}`; }
export function parseMoney(value: string) { if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a non-negative USD amount with up to two decimal places.'); const [dollars, cents = ''] = value.trim().split('.'); return BigInt(dollars) * 100n + BigInt(cents.padEnd(2, '0')); }
export function dollars(cents: bigint) { return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`; }
const I128_MAX = (1n << 127n) - 1n;
const U64_MAX = (1n << 64n) - 1n;
export function transition(s: DemoState, c: Command): DemoState {
 let next = s;
 const b = getBalances(s);
 switch(c.function) {
 case 'maintain_ttl': return s;
 case 'configure_budget':
  if (c.budget_cap > I128_MAX || c.expense_limit > I128_MAX) throw new Error('Amount exceeds the contract i128 range.');
  if (c.budget_cap < 0n || c.expense_limit < 0n || c.expense_limit > c.budget_cap) throw new Error('The expense limit must be between zero and the budget cap.');
  if (c.budget_cap < b.reserved + b.approved) throw new Error('Budget cap cannot be below reserved and committed spending.');
  next = { ...s, policy: { ...s.policy, budget_cap: c.budget_cap, expense_limit: c.expense_limit } }; break;
 case 'set_agent': next = { ...s, policy: { ...s.policy, agent: c.agent } }; break;
 case 'pause': case 'resume': next = { ...s, policy: { ...s.policy, paused: c.function === 'pause' } }; break;
 case 'set_vendor':
  if (!c.vendor.address.trim() || !c.vendor.name.trim()) throw new Error('Vendor name and demo identifier are required.');
  next = { ...s, vendors: [...s.vendors.filter(v => v.address !== c.vendor.address), { ...c.vendor, approved: c.approved }] }; break;
 case 'request_expense': {
  if (!s.policy.agent) throw new Error('Configure an authorized agent first.');
  if (s.policy.paused) throw new Error('Requests are paused. Resume in Settings.');
  if (c.amount > I128_MAX) throw new Error('Amount exceeds the contract i128 range.');
  if (c.amount <= 0n) throw new Error('Amount must be greater than zero.');
  if (!s.vendors.some(v => v.address === c.vendor && v.approved)) throw new Error('Vendor is not approved.');
  if (c.amount > s.policy.expense_limit) throw new Error('Amount exceeds the per-expense limit.');
  if (c.amount > b.available) throw new Error('Insufficient available budget.');
  if (!/^[a-fA-F0-9]{64}$/.test(c.reference)) throw new Error('Reference must be 32 bytes.');
  const id = s.expenses.reduce((max, e) => e.id > max ? e.id : max, 0n) + 1n;
  if (id >= U64_MAX) throw new Error('Expense ID exceeds the contract u64 range.');
  next = { ...s, expenses: [{ id, agent: s.policy.agent, vendor: c.vendor, amount: c.amount, reference: c.reference, status: 'Pending', description: c.description, date: c.date, category: c.category }, ...s.expenses] }; break;
 }
 default: {
  const e = s.expenses.find(e => e.id === c.id);
  if (!e) throw new Error('Expense not found.');
  if (e.status !== 'Pending') throw new Error('Only pending requests can be changed.');
  if (c.function === 'approve_expense') {
   if (s.policy.paused) throw new Error('Approvals are paused. Resume in Settings.');
   if (!s.vendors.some(v => v.address === e.vendor && v.approved)) throw new Error('Vendor approval was removed.');
   if (e.amount > s.policy.expense_limit) throw new Error('This request exceeds the current expense limit.');
  }
  const status = c.function === 'approve_expense' ? 'Approved' : c.function === 'reject_expense' ? 'Rejected' : 'Cancelled';
  next = { ...s, expenses: s.expenses.map(x => x.id === e.id ? { ...x, status } : x) }; break;
 }
 }
 if (getBalances(next).available < 0n) throw new Error('Budget invariant violated.');
 return next;
}
