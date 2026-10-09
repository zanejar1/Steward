import { ContractConfig } from './config';
import { address, u64 } from './codec';
export interface Catalog {
 expenseIds: string[];
 vendors: Record<string,{ name: string; category: string }>;
 expenses: Record<string,{ description: string; date: string; category: string; reference: string }>;
}
export function emptyCatalog(config: ContractConfig): Catalog {
 return { expenseIds: config.expenseIds.map(String), vendors: Object.fromEntries(config.vendorAddresses.map(a => [a,{ name: shortAddress(a), category: 'On-chain vendor' }])), expenses: {} };
}
export function shortAddress(value: string) { return value.length > 16 ? `${value.slice(0,6)}…${value.slice(-6)}` : value; }
export function storageKey(config: ContractConfig) { return `steward:testnet:${config.contractId}`; }
export function readCatalog(config: ContractConfig): Catalog {
 const seeds = emptyCatalog(config);
 try {
  const raw = localStorage.getItem(storageKey(config)); if(!raw) return seeds;
  const saved: Catalog = JSON.parse(raw);
  if(!Array.isArray(saved.expenseIds) || !saved.vendors || !saved.expenses) return seeds;
  if(saved.expenseIds.some(id => typeof id !== 'string' || !/^\d+$/.test(id))) return seeds;
  const expenseIds = [...new Set([...seeds.expenseIds,...saved.expenseIds])];
  expenseIds.forEach(id => u64(BigInt(id)));
  const vendors = { ...seeds.vendors,...saved.vendors }; Object.keys(vendors).forEach(address);
  if(Object.values(vendors).some(v => !v || typeof v.name !== 'string' || typeof v.category !== 'string')) return seeds;
  if(Object.values(saved.expenses).some(e => !e || typeof e.description !== 'string' || typeof e.date !== 'string' || typeof e.category !== 'string' || typeof e.reference !== 'string')) return seeds;
  if(expenseIds.length > 200 || Object.keys(vendors).length > 200) return seeds;
  // Cached metadata is presentation only; never treat cached statuses/amounts as live.
  return { expenseIds, vendors, expenses: saved.expenses };
 } catch { return seeds; }
}
export function saveCatalog(config: ContractConfig,catalog: Catalog) {
 if(catalog.expenseIds.length > 200 || Object.keys(catalog.vendors).length > 200) throw new Error('This browser can track up to 200 expense IDs and vendor addresses.');
 try { localStorage.setItem(storageKey(config),JSON.stringify(catalog)); } catch { /* Reads still work without browser storage; tracking lasts for the session. */ }
}
