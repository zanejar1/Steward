import { Address, nativeToScVal, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import { Balances, Expense, Policy, Status } from '../types';
export function address(value: string) {
 if (!StrKey.isValidEd25519PublicKey(value) && !StrKey.isValidContract(value)) throw new Error('Enter a valid Stellar G… account or C… contract address.');
 return new Address(value).toScVal();
}
export function i128(value: bigint) {
 if(value < -(1n << 127n) || value >= (1n << 127n)) throw new Error('Amount is outside the contract i128 range.');
 return nativeToScVal(value, { type: 'i128' });
}
export function u64(value: bigint) {
 if(value < 0n || value >= (1n << 64n)) throw new Error('Expense ID is outside the contract u64 range.');
 return nativeToScVal(value, { type: 'u64' });
}
export function optional(value: xdr.ScVal | null) { return value ?? xdr.ScVal.scvVoid(); }
export function bytes32(hex: string) {
 if(!/^[a-fA-F0-9]{64}$/.test(hex)) throw new Error('Reference must be exactly 32 bytes (64 hexadecimal characters).');
 return nativeToScVal(Uint8Array.from(hex.match(/.{2}/g)!, byte => parseInt(byte,16)), { type: 'bytes' });
}
export function constructorArgs(owner: string, agent: string | null, cap: bigint, limit: bigint) {
 if(cap < 0n || limit < 0n || limit > cap) throw new Error('Invalid budget policy.');
 return [address(owner), optional(agent ? address(agent) : null), i128(cap), i128(limit)];
}
function record(value: xdr.ScVal): Record<string, unknown> {
 const decoded: unknown = scValToNative(value);
 if(!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Unexpected contract response.');
 return decoded as Record<string, unknown>;
}
function bigint(value: unknown) { if(typeof value !== 'bigint') throw new Error('Expected a contract integer.'); return value; }
function text(value: unknown) { if(typeof value !== 'string') throw new Error('Expected a contract address.'); address(value); return value; }
export function decodePolicy(value: xdr.ScVal): Policy {
 const p = record(value); if(typeof p.paused !== 'boolean') throw new Error('Unexpected policy pause value.');
 return { owner: text(p.owner), agent: p.agent == null ? null : text(p.agent), budget_cap: bigint(p.budget_cap), expense_limit: bigint(p.expense_limit), paused: p.paused };
}
export function decodeBalances(value: xdr.ScVal): Balances {
 const b = record(value); return { reserved: bigint(b.reserved), approved: bigint(b.approved), available: bigint(b.available) };
}
export function decodeExpense(value: xdr.ScVal): Expense {
 const e = record(value); const status = Array.isArray(e.status) ? e.status[0] : undefined;
 if(!['Pending','Approved','Rejected','Cancelled'].includes(status)) throw new Error('Unexpected expense status.');
 if(!(e.reference instanceof Uint8Array) || e.reference.length !== 32) throw new Error('Unexpected expense reference.');
 return { id: bigint(e.id), agent: text(e.agent), vendor: text(e.vendor), amount: bigint(e.amount), status: status as Status, reference: Array.from(e.reference).map(b => b.toString(16).padStart(2,'0')).join('') };
}
export const errorMessages: Record<number,string> = {
 1:'Contract state is missing or archived. Restore it before retrying.', 2:'Amount must be greater than zero.',
 3:'Invalid spending policy.', 4:'No authorized agent is configured.', 5:'Vendor is not approved.',
 6:'The expense exceeds the current per-expense limit.', 7:'The budget cannot cover this request or policy change.',
 8:'Requests and approvals are paused.', 9:'Expense not found (it may be archived).',
 10:'This expense is no longer pending.', 11:'The contract rejected an arithmetic operation.',
};
export function errorMessage(error: unknown): string {
 const raw = error instanceof Error ? error.message : String(error);
 const code = raw.match(/Error\(Contract,\s*#?(\d+)\)/i);
 if(code) return errorMessages[Number(code[1])] ?? `Contract error ${code[1]}.`;
 if(/Error\(Auth|host.*auth|invalid.*signature|unauthorized/i.test(raw)) return 'Authorization failed. Use the contract owner for administration, the configured agent for requests, or the original requesting agent for cancellation.';
 if(/account.*not found|account.*does not exist/i.test(raw)) return 'Source account is not funded on Stellar testnet. Fund the connected public address before transacting.';
 return raw.length > 700 ? `${raw.slice(0,700)}…` : raw;
}

export function transactionFailure(result?: xdr.TransactionResult): string {
 const code = result?.result.type;
 const messages: Record<string,string> = {
  txBadAuth:'Transaction authorization failed. Check the connected signer and account signing requirements.',
  txBadAuthExtra:'The transaction has unexpected signatures.',
  txNoAccount:'The source account is not funded on testnet.',
  txInsufficientBalance:'The source account has insufficient testnet XLM for fees and reserves.',
  txInsufficientFee:'The transaction fee is too low. Refresh and prepare a new transaction.',
  txBadSeq:'The account sequence changed. Refresh before preparing a new transaction.',
  txTooLate:'The transaction expired before submission. Prepare a new transaction.',
  txSorobanInvalid:'Soroban validation failed. Refresh contract state and simulate again.',
  txFailed:'The contract operation failed. Recheck authorization, current policy, vendor approval and budget.',
 };
 return code ? messages[code] ?? `Transaction rejected: ${code}.` : 'Transaction was rejected. Check authorization, policy and testnet XLM fees.';
}
