import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { createWallet, restoreWallet, FreighterApi } from './wallet';
const account = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(4));
function setup() {
 const state = { installed:true,network:Networks.TESTNET,address:account,signs:0 };
 const api: FreighterApi = {
  async isConnected() { return { isConnected:state.installed }; },
  async requestAccess() { return { address:state.address }; },
  async getAddress() { return { address:state.address }; },
  async getNetworkDetails() { return { network:'TESTNET',networkPassphrase:state.network,networkUrl:'https://horizon-testnet.stellar.org' }; },
  async signTransaction() { state.signs++; return { signedTxXdr:'signed',signerAddress:state.address }; },
 };
 return { state,api,wallet:createWallet(api) };
}
test('connection handles missing extension and returns only public wallet data', async () => {
 const { state,wallet } = setup(); assert.equal((await wallet.connect()).address,account);
 state.installed = false; await assert.rejects(() => wallet.connect(),/Install/);
});
test('signing checks selected network and account before prompting Freighter', async () => {
 const { state,wallet } = setup(); state.network = Networks.PUBLIC;
 await assert.rejects(() => wallet.sign('unsigned',account,Networks.TESTNET),/testnet/); assert.equal(state.signs,0);
 state.network = Networks.TESTNET; state.address = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(5));
 await assert.rejects(() => wallet.sign('unsigned',account,Networks.TESTNET),/account changed/); assert.equal(state.signs,0);
});
test('signing rejects account/network changes during wallet approval', async () => {
 const { state,api,wallet } = setup(); api.signTransaction = async () => { state.network = Networks.PUBLIC; return { signedTxXdr:'signed',signerAddress:account }; };
 await assert.rejects(() => wallet.sign('unsigned',account,Networks.TESTNET),/changed during signing/);
});
test('reload restores an authorized wallet from live account and network without requesting access', async () => {
 const { state,api } = setup();
 api.requestAccess = async () => { throw new Error('Restoration must not prompt'); };
 const authorized = { ...api, async isAllowed() { return { isAllowed:true }; } };
 assert.deepEqual(await restoreWallet(authorized), { address:account,network:'TESTNET',networkPassphrase:Networks.TESTNET });
 state.address = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(5));
 state.network = Networks.PUBLIC;
 const restored = await restoreWallet(authorized);
 assert.equal(restored?.address,state.address);
 assert.equal(restored?.networkPassphrase,Networks.PUBLIC);
 state.installed = false;
 assert.equal(await restoreWallet(authorized),null);
});
test('restoration never connects an unauthorized site or trusts an invalid account', async () => {
 const { state,api } = setup();
 assert.equal(await restoreWallet({ ...api, async isAllowed() { return { isAllowed:false }; } }),null);
 state.address = '';
 await assert.rejects(() => restoreWallet({ ...api, async isAllowed() { return { isAllowed:true }; } }),/Unlock Freighter/);
});
