import { Account, Address as ContractAddress, BASE_FEE, Contract, Operation, rpc, scValToNative, StrKey, Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { Command } from '../types';
import { ContractConfig } from './config';
import { address, bytes32, constructorArgs, decodeBalances, decodeExpense, decodePolicy, errorMessage, errorMessages, transactionFailure, i128, optional, u64 } from './codec';
import { WalletAdapter } from './wallet';
export type TxStage = 'simulating' | 'signing' | 'submitting' | 'confirming';
export type Progress = (stage: TxStage, hash?: string) => void;
export class PendingTransactionError extends Error {
 constructor(public readonly hash: string, message = 'Confirmation is still pending. Check this transaction before sending another.') { super(message); }
}
export class FailedTransactionError extends Error {}
export interface Confirmation { hash: string; ledger: number; value?: xdr.ScVal }
export type RpcTransport = Pick<rpc.Server, 'getNetwork' | 'getAccount' | 'simulateTransaction' | 'sendTransaction' | 'getTransaction'>;
// Public zero-address simulation source; no private key is created or used.
const READ_SOURCE = StrKey.encodeEd25519PublicKey(new Uint8Array(32));
export class StewardClient {
 readonly server: RpcTransport; readonly contract: Contract;
 constructor(readonly config: ContractConfig, readonly wallet: WalletAdapter, server?: RpcTransport, private readonly sleep: (ms:number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve,ms))) {
  if(config.error) throw new Error(config.error);
  if(!config.contractId) throw new Error('Steward contract is not configured.');
  this.contract = new Contract(config.contractId);
  this.server = server ?? new rpc.Server(config.rpcUrl, { timeout: 20 });
 }
 async verifyNetwork() { const network = await this.server.getNetwork(); if(network.passphrase !== this.config.networkPassphrase) throw new Error('RPC network does not match Stellar testnet. No transaction was sent.'); }
 private build(source: Account, method: string, args: xdr.ScVal[]) {
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.config.networkPassphrase }).addOperation(this.contract.call(method,...args)).setTimeout(180).build();
 }
 private async simulate(tx: Transaction) {
  const simulation = await this.server.simulateTransaction(tx);
  if(rpc.Api.isSimulationError(simulation)) throw new Error(errorMessage(new Error(simulation.error)));
  if(rpc.Api.isSimulationRestore(simulation)) throw new Error('Contract state is archived. A restoration transaction is required before this operation.');
  if(!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) throw new Error('RPC returned no contract result.');
  if(simulation.result.retval.type === 'scvError') { const err = simulation.result.retval.error; throw new Error(err.type === 'sceContract' ? errorMessages[err.contractCode] ?? `Contract error ${err.contractCode}.` : 'The contract returned a system error.'); }
  return simulation;
 }
 async read(method: 'get_policy' | 'get_balances' | 'get_expense' | 'is_vendor', args: xdr.ScVal[] = []) {
  await this.verifyNetwork();
  const sim = await this.simulate(this.build(new Account(READ_SOURCE,'0'), method,args));
  return sim.result!.retval;
 }
 get_policy = async () => decodePolicy(await this.read('get_policy'));
 get_balances = async () => decodeBalances(await this.read('get_balances'));
 get_expense = async (id: bigint) => decodeExpense(await this.read('get_expense',[u64(id)]));
 is_vendor = async (vendor: string) => { const result: unknown = scValToNative(await this.read('is_vendor',[address(vendor)])); if(typeof result !== 'boolean') throw new Error('Unexpected vendor response.'); return result; };
 async invoke(method: string, args: xdr.ScVal[], signer: string, progress: Progress = () => {}) {
  progress('simulating'); await this.verifyNetwork();
  const info = await this.wallet.inspect();
  if(info.address !== signer) throw new Error('The wallet account changed. Reconnect.');
  if(info.networkPassphrase !== this.config.networkPassphrase) throw new Error('Switch Freighter to Stellar testnet.');
  const tx = this.build(await this.server.getAccount(signer),method,args);
  const simulation = await this.simulate(tx);
  // Every mutator has one authority; using that account as transaction source
  // means transaction signing authorizes the source-account invocation.
  if(simulation.result!.auth.some(entry => entry.credentials.type !== 'sorobanCredentialsSourceAccount')) throw new Error('This call requires additional authorization. Contract-account and multi-party signing are not supported by this wallet flow.');
  const prepared = rpc.assembleTransaction(tx,simulation).build();
  progress('signing'); const signedXdr = await this.wallet.sign(prepared.toXDR(),signer,this.config.networkPassphrase);
  const signed = TransactionBuilder.fromXDR(signedXdr,this.config.networkPassphrase);
  if(!(signed instanceof Transaction) || hex(signed.hash()) !== hex(prepared.hash())) throw new Error('Wallet returned a different transaction. Nothing was submitted.');
  const hash = hex(signed.hash()); progress('submitting',hash);
  let sent: Awaited<ReturnType<RpcTransport['sendTransaction']>>;
  try { sent = await this.server.sendTransaction(signed); }
  catch(e) { throw new PendingTransactionError(hash,`Submission outcome is unknown: ${errorMessage(e)} Check the transaction before retrying.`); }
  if(sent.status === 'ERROR') throw new FailedTransactionError(transactionFailure(sent.errorResult));
  if(sent.status === 'TRY_AGAIN_LATER') throw new PendingTransactionError(hash,'RPC is busy. Check this hash before submitting another transaction.');
  progress('confirming',hash); return this.waitForConfirmation(hash);
 }
 async waitForConfirmation(hash: string, attempts = 45): Promise<Confirmation> {
  for(let i=0;i<attempts;i++) {
   let result: Awaited<ReturnType<RpcTransport['getTransaction']>>;
   try { result = await this.server.getTransaction(hash); }
   catch(e) { throw new PendingTransactionError(hash,`Unable to check confirmation: ${errorMessage(e)}`); }
   if(result.status === rpc.Api.GetTransactionStatus.SUCCESS) return { hash, ledger: result.ledger, value: result.returnValue };
   if(result.status === rpc.Api.GetTransactionStatus.FAILED) throw new FailedTransactionError(`Transaction failed on-chain. ${transactionFailure(result.resultXdr)} No contract changes were confirmed.`);
   if(i + 1 < attempts) await this.sleep(2000);
  }
  throw new PendingTransactionError(hash);
 }
 configure_budget = (cap: bigint, limit: bigint, signer: string, p?: Progress) => this.invoke('configure_budget',[i128(cap),i128(limit)],signer,p);
 set_agent = (agent: string | null, signer: string, p?: Progress) => this.invoke('set_agent',[optional(agent ? address(agent) : null)],signer,p);
 set_vendor = (vendor: string, approved: boolean, signer: string, p?: Progress) => this.invoke('set_vendor',[address(vendor),xdr.ScVal.scvBool(approved)],signer,p);
 pause = (signer: string,p?: Progress) => this.invoke('pause',[],signer,p);
 resume = (signer: string,p?: Progress) => this.invoke('resume',[],signer,p);
 request_expense = (vendor: string,amount: bigint,reference: string,signer: string,p?: Progress) => this.invoke('request_expense',[address(vendor),i128(amount),bytes32(reference)],signer,p);
 approve_expense = (id: bigint,signer: string,p?: Progress) => this.invoke('approve_expense',[u64(id)],signer,p);
 reject_expense = (id: bigint,signer: string,p?: Progress) => this.invoke('reject_expense',[u64(id)],signer,p);
 cancel_expense = (id: bigint,signer: string,p?: Progress) => this.invoke('cancel_expense',[u64(id)],signer,p);
 maintain_ttl = (id: bigint | null,vendor: string | null,signer: string,p?: Progress) => this.invoke('maintain_ttl',[optional(id === null ? null : u64(id)),optional(vendor ? address(vendor) : null)],signer,p);
 // __constructor is reserved for deployment and cannot be invoked on an
 // existing contract. Expose its arguments and deployment operation explicitly.
 static constructorArgs = constructorArgs;
 static deploymentOperation(wasmHash: Uint8Array,salt: Uint8Array,owner: string,agent: string | null,cap: bigint,limit: bigint) {
  return Operation.createCustomContract({ address: new ContractAddress(owner), wasmHash, salt, constructorArgs: constructorArgs(owner,agent,cap,limit) });
 }
 async execute(command: Command,signer: string,p?: Progress) {
  switch(command.function) {
   case 'configure_budget': return this.configure_budget(command.budget_cap,command.expense_limit,signer,p);
   case 'set_agent': return this.set_agent(command.agent,signer,p);
   case 'set_vendor': return this.set_vendor(command.vendor.address,command.approved,signer,p);
   case 'pause': return this.pause(signer,p);
   case 'resume': return this.resume(signer,p);
   case 'request_expense': return this.request_expense(command.vendor,command.amount,command.reference,signer,p);
   case 'approve_expense': return this.approve_expense(command.id,signer,p);
   case 'reject_expense': return this.reject_expense(command.id,signer,p);
   case 'cancel_expense': return this.cancel_expense(command.id,signer,p);
   case 'maintain_ttl': return this.maintain_ttl(command.expense_id,command.vendor,signer,p);
  }
 }
}
function hex(bytes: Uint8Array) { return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(''); }
