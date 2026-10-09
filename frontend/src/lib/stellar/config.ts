import { Networks, StrKey } from '@stellar/stellar-sdk';
export interface ContractConfig {
 contractId: string | null; rpcUrl: string; networkPassphrase: string;
 expenseIds: bigint[]; vendorAddresses: string[]; error: string | null;
}
export function readConfig(env: Record<string, string | undefined>): ContractConfig {
 const contractId = env.NEXT_PUBLIC_STEWARD_CONTRACT_ID?.trim() || null;
 const rpcUrl = env.NEXT_PUBLIC_STELLAR_RPC_URL?.trim() || 'https://soroban-testnet.stellar.org';
 const networkPassphrase = env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
 let error: string | null = null; let expenseIds: bigint[] = []; let vendorAddresses: string[] = [];
 try {
  if ((env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet') !== 'testnet' || networkPassphrase !== Networks.TESTNET) throw new Error('This integration supports Stellar testnet only.');
  if (contractId && !StrKey.isValidContract(contractId)) throw new Error('NEXT_PUBLIC_STEWARD_CONTRACT_ID must be a valid C… contract address.');
  const url = new URL(rpcUrl); if (url.protocol !== 'https:') throw new Error('The testnet RPC URL must use HTTPS.');
  expenseIds = [...new Set((env.NEXT_PUBLIC_STEWARD_EXPENSE_IDS || '').split(',').map(s => s.trim()).filter(Boolean))].map(id => { if(!/^\d+$/.test(id) || BigInt(id) > (1n << 64n) - 1n) throw new Error('Expense IDs must be unsigned u64 integers.'); return BigInt(id); });
  vendorAddresses = [...new Set((env.NEXT_PUBLIC_STEWARD_VENDOR_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean))];
  if(vendorAddresses.some(a => !StrKey.isValidEd25519PublicKey(a) && !StrKey.isValidContract(a))) throw new Error('Seed vendor addresses must be valid G… or C… addresses.');
  if(expenseIds.length > 200 || vendorAddresses.length > 200) throw new Error('Configure at most 200 tracked expenses and vendors.');
 } catch(e) { error = e instanceof Error ? e.message : 'Invalid contract configuration.'; }
 return { contractId, rpcUrl, networkPassphrase, expenseIds, vendorAddresses, error };
}
// Explicit accesses are required for Next.js to inline public build-time variables.
export const config = readConfig({
 NEXT_PUBLIC_STEWARD_CONTRACT_ID: process.env.NEXT_PUBLIC_STEWARD_CONTRACT_ID,
 NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
 NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
 NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
 NEXT_PUBLIC_STEWARD_EXPENSE_IDS: process.env.NEXT_PUBLIC_STEWARD_EXPENSE_IDS,
 NEXT_PUBLIC_STEWARD_VENDOR_ADDRESSES: process.env.NEXT_PUBLIC_STEWARD_VENDOR_ADDRESSES,
});
