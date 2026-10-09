import { DemoState } from './types';
export const initialState: DemoState = {
 policy: { owner: 'demo:owner:acme', agent: 'demo:agent:operations', budget_cap: 5000000n, expense_limit: 1000000n, paused: false },
 vendors: [
 { address: 'demo:vendor:aws', name: 'Amazon Web Services', category: 'Infrastructure', approved: true },
 { address: 'demo:vendor:figma', name: 'Figma', category: 'Design tools', approved: true },
 { address: 'demo:vendor:notion', name: 'Notion', category: 'Productivity', approved: true },
 { address: 'demo:vendor:linear', name: 'Linear', category: 'Engineering', approved: true },
 { address: 'demo:vendor:vercel', name: 'Vercel', category: 'Infrastructure', approved: true },
 ],
 expenses: [
 [8, 'aws', 248000, 'Pending', 'Cloud infrastructure · October', '2026-10-09', 'Infrastructure'],
 [7, 'figma', 45000, 'Pending', 'Design team annual seats', '2026-10-08', 'Software'],
 [6, 'notion', 18000, 'Pending', 'Workspace subscription', '2026-10-08', 'Software'],
 [5, 'aws', 920000, 'Approved', 'Compute capacity reservation', '2026-10-06', 'Infrastructure'],
 [4, 'vercel', 640000, 'Approved', 'Production hosting allocation', '2026-10-04', 'Infrastructure'],
 [3, 'linear', 36000, 'Approved', 'Engineering team subscription', '2026-10-03', 'Software'],
 [2, 'figma', 78000, 'Rejected', 'Additional contractor seats', '2026-10-02', 'Software'],
 [1, 'notion', 24000, 'Cancelled', 'Duplicate workspace request', '2026-10-01', 'Software'],
 ].map(([id, vendor, amount, status, description, date, category]) => ({ id: BigInt(id), vendor: `demo:vendor:${vendor}`, amount: BigInt(amount), status, description, date, category, agent: 'demo:agent:operations', reference: BigInt(id).toString(16).padStart(64, '0') })) as DemoState['expenses'],
};
