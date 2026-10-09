import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { address, bytes32, constructorArgs, decodeBalances, decodeExpense, decodePolicy, errorMessage, i128, optional, u64 } from './codec';
import { readConfig } from './config';
const account = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(1));
const contract = StrKey.encodeContract(new Uint8Array(32).fill(2));
function map(fields: Record<string,xdr.ScVal>) { return xdr.ScVal.scvMap(Object.keys(fields).sort().map(key => new xdr.ScMapEntry({ key:xdr.ScVal.scvSymbol(key),val:fields[key] }))); }
test('contract integer codecs preserve cents and IDs without floating point', () => {
 const cents = (1n << 100n) + 19n; assert.equal(scValToNative(i128(cents)),cents);
 assert.equal(scValToNative(u64((1n << 64n) - 1n)),(1n << 64n) - 1n);
 assert.throws(() => i128(1n << 127n)); assert.throws(() => u64(-1n)); assert.throws(() => u64(1n << 64n));
});
test('Soroban Option is void for None and the inner value for Some', () => {
 assert.equal(scValToNative(optional(null)),null);
 assert.equal(scValToNative(optional(address(account))),account);
 assert.equal(constructorArgs(account,null,100n,10n).length,4);
 assert.throws(() => constructorArgs(account,null,10n,11n));
});
test('real Soroban structs and symbol-vector status decode correctly', () => {
 assert.deepEqual(decodePolicy(map({ owner:address(account),agent:optional(null),budget_cap:i128(10000n),expense_limit:i128(1000n),paused:xdr.ScVal.scvBool(false) })),{ owner:account,agent:null,budget_cap:10000n,expense_limit:1000n,paused:false });
 assert.deepEqual(decodeBalances(map({ reserved:i128(100n),approved:i128(200n),available:i128(9700n) })),{ reserved:100n,approved:200n,available:9700n });
 const reference = 'aa'.repeat(32);
 const expense = decodeExpense(map({ id:u64(12n),agent:address(account),vendor:address(contract),amount:i128(199n),reference:bytes32(reference),status:xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Pending')]) }));
 assert.equal(expense.status,'Pending'); assert.equal(expense.reference,reference); assert.equal(expense.id,12n);
 assert.throws(() => bytes32('aa')); assert.throws(() => address('demo:agent'));
});
test('unconfigured state is valid; invalid contract, network, RPC and seeds fail closed', () => {
 assert.equal(readConfig({}).contractId,null); assert.equal(readConfig({}).error,null);
 assert.equal(readConfig({ NEXT_PUBLIC_STEWARD_CONTRACT_ID:contract }).error,null);
 assert.ok(readConfig({ NEXT_PUBLIC_STEWARD_CONTRACT_ID:account }).error);
 assert.ok(readConfig({ NEXT_PUBLIC_STELLAR_NETWORK:'mainnet' }).error);
 assert.ok(readConfig({ NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:'wrong' }).error);
 assert.ok(readConfig({ NEXT_PUBLIC_STELLAR_RPC_URL:'http://unsafe.example' }).error);
 assert.ok(readConfig({ NEXT_PUBLIC_STEWARD_EXPENSE_IDS:'-1' }).error);
 assert.ok(readConfig({ NEXT_PUBLIC_STEWARD_VENDOR_ADDRESSES:'demo:vendor' }).error);
});
test('contract errors and authorization failures have actionable messages', () => {
 assert.match(errorMessage(new Error('HostError: Error(Contract, #7)')),/budget/);
 assert.match(errorMessage(new Error('HostError: Error(Auth, InvalidAction)')),/Authorization/);
 assert.match(errorMessage(new Error('Account not found')),/funded/);
});
