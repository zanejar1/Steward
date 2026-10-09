import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Contract, Networks, rpc, SorobanDataBuilder, StrKey, Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { FailedTransactionError, PendingTransactionError, RpcTransport, StewardClient } from './client';
import { readConfig } from './config';
import { WalletAdapter } from './wallet';
const account = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(1));
const contractId = StrKey.encodeContract(new Uint8Array(32).fill(2));
const config = readConfig({ NEXT_PUBLIC_STEWARD_CONTRACT_ID:contractId });
function setup() {
 const calls = { signs:0,sends:0,simulations:0,network:Networks.TESTNET,account,status:'SUCCESS',simError:'',restore:false,sendStatus:'PENDING',transportError:false };
 let simulationTransaction: Transaction | null = null;
 const transport: RpcTransport = {
  async getNetwork() { return { passphrase:calls.network,protocolVersion:'28',friendbotUrl:'' }; },
  async getAccount(key) { return new Account(key,'123'); },
  async simulateTransaction(tx) {
   calls.simulations++; simulationTransaction = tx as Transaction;
   if(calls.simError) return { id:'1',latestLedger:100,events:[],_parsed:true,error:calls.simError };
   const data = new SorobanDataBuilder();
   const success: rpc.Api.SimulateTransactionSuccessResponse = { id:'1',latestLedger:100,events:[],_parsed:true,transactionData:data,minResourceFee:'1000',result:{ auth:[],retval:xdr.ScVal.scvU64(9n) } };
   if(calls.restore) return { ...success,result:success.result!,restorePreamble:{ minResourceFee:'100',transactionData:data } };
   return success;
  },
  async sendTransaction() {
   calls.sends++; if(calls.transportError) throw new Error('Network timeout');
   return { status:calls.sendStatus,hash:'a'.repeat(64),latestLedger:100,latestLedgerCloseTime:100 } as rpc.Api.SendTransactionResponse;
  },
  async getTransaction(hash) {
   return { status:calls.status,txHash:hash,ledger:101,returnValue:xdr.ScVal.scvU64(9n),resultXdr:new xdr.TransactionResult({ feeCharged:100n,result:xdr.TransactionResultResult.txBadAuth(),ext:xdr.TransactionResultExt.v0() }) } as unknown as rpc.Api.GetTransactionResponse;
  },
 };
 const wallet: WalletAdapter = {
  async connect() { return this.inspect(); },
  async inspect() { return { address:calls.account,network:'TESTNET',networkPassphrase:calls.network }; },
  async sign(xdr) { calls.signs++; return xdr; }, // mocked wallet transport, no private keys
 };
 const client = new StewardClient(config,wallet,transport,async () => {});
 return { calls,transport,wallet,client,getSimulation:() => simulationTransaction };
}
test('reads use simulation only, with no account lookup/signing/submission', async () => {
 const { calls,client,transport,getSimulation } = setup(); transport.getAccount = async () => { throw new Error('Read must not require a funded source'); };
 const result = await client.read('get_expense',[xdr.ScVal.scvU64(9n)]);
 assert.equal(result.type,'scvU64'); assert.equal(calls.simulations,1); assert.equal(calls.signs,0); assert.equal(calls.sends,0); assert.ok(getSimulation());
});
test('writes simulate, assemble resource fees, sign, submit once and confirm', async () => {
 const { calls,client } = setup(); const stages: string[] = [];
 const result = await client.request_expense(account,199n,'ff'.repeat(32),account,stage => stages.push(stage));
 assert.equal(result.ledger,101); assert.equal(calls.signs,1); assert.equal(calls.sends,1); assert.deepEqual(stages,['simulating','signing','submitting','confirming']); assert.equal(result.hash.length,64);
});
test('RPC mismatch, wallet account change and failed simulation stop before signing', async () => {
 const rpcMismatch = setup(); rpcMismatch.calls.network = Networks.PUBLIC;
 await assert.rejects(() => rpcMismatch.client.pause(account),/RPC network/); assert.equal(rpcMismatch.calls.signs,0);
 const switched = setup(); switched.calls.account = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(3));
 await assert.rejects(() => switched.client.pause(account),/account changed/); assert.equal(switched.calls.sends,0);
 const sim = setup(); sim.calls.simError = 'Error(Contract, #8)';
 await assert.rejects(() => sim.client.pause(account),/paused/); assert.equal(sim.calls.signs,0); assert.equal(sim.calls.sends,0);
});
test('wallet network mismatch and declined signature never submit', async () => {
 const mismatch = setup(); mismatch.wallet.inspect = async () => ({ address:account,network:'PUBLIC',networkPassphrase:Networks.PUBLIC });
 await assert.rejects(() => mismatch.client.pause(account),/testnet/); assert.equal(mismatch.calls.sends,0);
 const declined = setup(); declined.wallet.sign = async () => { throw new Error('User declined'); };
 await assert.rejects(() => declined.client.pause(account),/declined/); assert.equal(declined.calls.sends,0);
});
test('archival is explicit and does not silently send a restore transaction', async () => {
 const { calls,client } = setup(); calls.restore = true;
 await assert.rejects(() => client.pause(account),/archived/); assert.equal(calls.signs,0); assert.equal(calls.sends,0);
});
test('RPC submission uncertainty retains a real computed hash and never auto-resends', async () => {
 const { calls,client } = setup(); calls.transportError = true;
 await assert.rejects(() => client.pause(account),e => e instanceof PendingTransactionError && /^[a-f0-9]{64}$/.test(e.hash));
 assert.equal(calls.sends,1);
});
test('unresolved confirmation stays pending; on-chain failure is terminal', async () => {
 const { calls,client } = setup(); calls.status = 'NOT_FOUND';
 await assert.rejects(() => client.waitForConfirmation('b'.repeat(64),2),PendingTransactionError); assert.equal(calls.sends,0);
 calls.status = 'FAILED'; await assert.rejects(() => client.waitForConfirmation('b'.repeat(64)),FailedTransactionError);
});
test('RPC rejection is terminal while busy and duplicate responses are not resent', async () => {
 const rejected = setup(); rejected.calls.sendStatus = 'ERROR'; await assert.rejects(() => rejected.client.pause(account),FailedTransactionError); assert.equal(rejected.calls.sends,1);
 const busy = setup(); busy.calls.sendStatus = 'TRY_AGAIN_LATER'; await assert.rejects(() => busy.client.pause(account),PendingTransactionError); assert.equal(busy.calls.sends,1);
 const duplicate = setup(); duplicate.calls.sendStatus = 'DUPLICATE'; await duplicate.client.pause(account); assert.equal(duplicate.calls.sends,1);
});

test('a wallet-modified transaction is rejected before submission', async () => {
 const { calls,client,wallet } = setup();
 wallet.sign = async () => new TransactionBuilder(new Account(account,'999'),{ fee:'100',networkPassphrase:Networks.TESTNET }).addOperation(new Contract(contractId).call('pause')).setTimeout(30).build().toXDR();
 await assert.rejects(() => client.pause(account),/different transaction/); assert.equal(calls.sends,0);
});
test('encoded contract error result stops before signing', async () => {
 const { calls,client,transport } = setup(); const simulate = transport.simulateTransaction;
 transport.simulateTransaction = async tx => { const result = await simulate(tx); if(rpc.Api.isSimulationSuccess(result)) result.result!.retval = xdr.ScVal.scvError(xdr.ScError.sceContract(5)); return result; };
 await assert.rejects(() => client.pause(account),/Vendor is not approved/); assert.equal(calls.signs,0);
});
test('non-source authorization is not silently left unsigned', async () => {
 const { calls,client,transport } = setup(); const simulate = transport.simulateTransaction;
 transport.simulateTransaction = async tx => { const result = await simulate(tx); if(rpc.Api.isSimulationSuccess(result)) result.result!.auth = [{ credentials:{ type:'sorobanCredentialsAddress' } }] as unknown as xdr.SorobanAuthorizationEntry[]; return result; };
 await assert.rejects(() => client.pause(account),/additional authorization/); assert.equal(calls.signs,0); assert.equal(calls.sends,0);
});
