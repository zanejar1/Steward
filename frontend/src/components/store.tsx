'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { scValToNative } from '@stellar/stellar-sdk';
import { Balances, Command, WorkspaceState } from '@/lib/types';
import { config } from '@/lib/stellar/config';
import { Confirmation, FailedTransactionError, PendingTransactionError, StewardClient, TxStage } from '@/lib/stellar/client';
import { errorMessage } from '@/lib/stellar/codec';
import { Catalog, emptyCatalog, readCatalog, saveCatalog, shortAddress, storageKey } from '@/lib/stellar/tracking';
import { wallet, restoreWallet, WalletInfo } from '@/lib/stellar/wallet';
const client = config.contractId && !config.error ? new StewardClient(config,wallet) : null;
const empty: WorkspaceState = { policy: { owner: '', agent: null, budget_cap: 0n, expense_limit: 0n, paused: false }, expenses: [], vendors: [] };
const zero: Balances = { reserved: 0n, approved: 0n, available: 0n };
interface Pending { hash: string; command: Command }
interface Store {
 state: WorkspaceState; balances: Balances; ready: boolean; loading: boolean; loadError: string | null; warnings: string[];
 walletInfo: WalletInfo | null; walletBusy: boolean; networkOk: boolean; owner: boolean; agent: boolean;
 busy: boolean; stage: TxStage | null; pending: Pending | null; canWrite: boolean;
 notice: { text: string; error: boolean } | null; clearNotice: () => void;
 connect: () => Promise<void>; disconnect: () => void; refresh: () => Promise<void>;
 dispatch: (command: Command) => Promise<boolean>; checkPending: () => Promise<void>;
 trackExpense: (id: bigint) => Promise<boolean>; trackVendor: (address: string) => Promise<boolean>;
}
const Context = createContext<Store | null>(null);
export function StewardProvider({ children }: { children: ReactNode }) {
 const [state,setState] = useState(empty);
 const [balances,setBalances] = useState(zero); const [ready,setReady] = useState(false);
 const [loading,setLoading] = useState(false); const [loadError,setLoadError] = useState<string | null>(null);
 const [warnings,setWarnings] = useState<string[]>([]);
 const [walletInfo,setWalletInfo] = useState<WalletInfo | null>(null); const [walletBusy,setWalletBusy] = useState(false);
 const [busy,setBusy] = useState(false); const [stage,setStage] = useState<TxStage | null>(null);
 const [pending,setPending] = useState<Pending | null>(null); const pendingRef = useRef<Pending | null>(null);
 const [notice,setNotice] = useState<{ text: string; error: boolean } | null>(null);
 const clearNotice = useCallback(() => setNotice(null),[]);
 const catalog = useRef<Catalog>(emptyCatalog(config)); const operation = useRef(false); const reading = useRef(false);
 const walletConnected = !!walletInfo;
 const walletSession = useRef(0);
 const networkOk = walletInfo?.networkPassphrase === config.networkPassphrase;
 const canWrite = ready && !!walletInfo && networkOk && !busy && !pending && !loading;
 const owner = !!walletInfo && walletInfo.address === state.policy.owner;
 const agent = !!walletInfo && walletInfo.address === state.policy.agent;
 const updatePending = useCallback((value: Pending | null) => {
  pendingRef.current = value; setPending(value);
  try { if(value) sessionStorage.setItem(`${storageKey(config)}:pending`,JSON.stringify(value,(_,v) => typeof v === 'bigint' ? { bigint: String(v) } : v)); else sessionStorage.removeItem(`${storageKey(config)}:pending`); } catch { /* Pending is still locked in memory. */ }
 },[]);
 const refresh = useCallback(async () => {
  if(!client || reading.current) return;
  reading.current = true; setLoading(true);
  try {
   const [policy,b] = await Promise.all([client.get_policy(),client.get_balances()]);
   // Aggregates come from the contract, never from the incomplete tracked list.
   if(b.reserved < 0n || b.approved < 0n || b.available < 0n) throw new Error('Contract returned invalid balances.');
   if(policy.budget_cap !== b.reserved + b.approved + b.available) throw new Error('Policy changed between reads. Refresh to get consistent balances.');
   const issues: string[] = []; const expenses: WorkspaceState['expenses'] = []; const vendors: WorkspaceState['vendors'] = [];
   // Limit concurrency to avoid flooding a public RPC endpoint.
   for(let offset=0;offset<catalog.current.expenseIds.length;offset+=5) {
    const ids = catalog.current.expenseIds.slice(offset,offset+5);
    const results = await Promise.allSettled(ids.map(id => client.get_expense(BigInt(id))));
    results.forEach((r,i) => { if(r.status === 'fulfilled') { const e = r.value; const metadata = catalog.current.expenses[String(e.id)]; const m = metadata?.reference === e.reference ? metadata : null; expenses.push({ ...e, description: m?.description || `Expense #${e.id}`, date: m?.date || '', category: m?.category || 'Not stored on-chain' }); } else issues.push(`Expense #${ids[i]}: ${errorMessage(r.reason)}`); });
   }
   const addresses = Object.keys(catalog.current.vendors);
   for(let offset=0;offset<addresses.length;offset+=5) {
    const batch = addresses.slice(offset,offset+5); const results = await Promise.allSettled(batch.map(a => client.is_vendor(a)));
    results.forEach((r,i) => { if(r.status === 'fulfilled') vendors.push({ address: batch[i], ...catalog.current.vendors[batch[i]], approved: r.value }); else issues.push(`Vendor ${shortAddress(batch[i])}: ${errorMessage(r.reason)}`); });
   }
   expenses.sort((a,b) => a.id === b.id ? 0 : a.id > b.id ? -1 : 1);
   const next = { policy,expenses,vendors }; setState(next); setBalances(b); setWarnings(issues); setLoadError(null); setReady(true);
  } catch(e) { setLoadError(errorMessage(e)); setReady(false); }
  finally { reading.current = false; setLoading(false); }
 },[]);
 useEffect(() => {
  let cancelled = false;
  async function initialize() {
   catalog.current = readCatalog(config);
   try { const raw = sessionStorage.getItem(`${storageKey(config)}:pending`); if(raw) { const saved: Pending = JSON.parse(raw,(_,v) => v && typeof v === 'object' && 'bigint' in v ? BigInt(v.bigint) : v); if(/^[a-f0-9]{64}$/.test(saved.hash) && saved.command?.function && !cancelled) updatePending(saved); } } catch { /* Invalid saved pending data is ignored. */ }
   if(!cancelled) await refresh();
  }
  void initialize(); return () => { cancelled = true; };
 },[refresh,updatePending]);
 useEffect(() => {
  let stopped = false;
  const session = walletSession.current;
  void restoreWallet().then(info => {
   if(!stopped && walletSession.current === session) setWalletInfo(info);
  }).catch(() => { /* Locked or unavailable wallets require an explicit connection. */ });
  return () => { stopped = true; };
 },[]);
 useEffect(() => {
  if(!walletConnected) return;
  let stopped = false;
  async function check() { try { const info = await wallet.inspect(); if(!stopped) setWalletInfo(info); } catch(e) { if(!stopped) { setWalletInfo(null); setNotice({ text: errorMessage(e),error:true }); } } }
  const interval = setInterval(() => void check(),10000);
  window.addEventListener('focus',check);
  return () => { stopped = true; clearInterval(interval); window.removeEventListener('focus',check); };
 },[walletConnected]); // Checks again before every signature as well.
 async function connect() { walletSession.current++; setWalletBusy(true); try { const info = await wallet.connect(); setWalletInfo(info); setNotice({ text: info.networkPassphrase === config.networkPassphrase ? 'Freighter connected to testnet.' : 'Wallet connected. Switch Freighter to Stellar testnet to enable transactions.',error:info.networkPassphrase !== config.networkPassphrase }); } catch(e) { setNotice({ text:errorMessage(e),error:true }); } finally { setWalletBusy(false); } }
 function disconnect() { walletSession.current++; setWalletInfo(null); setNotice({ text:'Wallet disconnected from this app. Site permissions remain in Freighter’s Allow List.',error:false }); }
 function persist() { saveCatalog(config,catalog.current); }
 function confirmed(command: Command,result: Confirmation) {
  if(command.function === 'request_expense' && result.value) {
   const id: unknown = scValToNative(result.value);
   if(typeof id === 'bigint') { const key = String(id); catalog.current.expenseIds = [...new Set([...catalog.current.expenseIds,key])]; catalog.current.expenses[key] = { description:command.description,date:command.date,category:command.category,reference:command.reference }; }
  }
  if(command.function === 'set_vendor') catalog.current.vendors[command.vendor.address] = { name:command.vendor.name,category:command.vendor.category };
  persist();
 }
 async function finish(command: Command,result: Confirmation) {
  // Clear the submission lock only after a terminal result. Refresh failures
  // must not turn a successful on-chain write into a retryable write failure.
  updatePending(null);
  let extra = ''; try { confirmed(command,result); } catch(e) { extra = ` Tracking could not be saved: ${errorMessage(e)}`; }
  await refresh();
  setNotice({ text:`Transaction confirmed in ledger ${result.ledger}. ${result.hash}.${extra}`,error:false });
 }
 async function dispatch(command: Command) {
  if(!client || !walletInfo || !ready || !networkOk || reading.current) { setNotice({ text:'Configure the contract, load its state and connect Freighter on testnet first.',error:true }); return false; }
  if(operation.current || pendingRef.current) { setNotice({ text:'A transaction is already in progress. Check its confirmation before sending another.',error:true }); return false; }
  operation.current = true; setBusy(true); clearNotice();
  try {
   const policy = await client.get_policy();
   const required = command.function === 'request_expense' ? policy.agent : command.function === 'cancel_expense' ? (await client.get_expense(command.id)).agent : policy.owner;
   if(!required || required !== walletInfo.address) throw new Error('Authorization failed: the connected account is not authorized for this action.');
   if(command.function === 'request_expense' && catalog.current.expenseIds.length >= 200) throw new Error('The browser tracking limit is 200 requests. Use an indexer for a larger history.');
   if(command.function === 'set_vendor' && !catalog.current.vendors[command.vendor.address] && Object.keys(catalog.current.vendors).length >= 200) throw new Error('The browser tracking limit is 200 vendors.');
   const result = await client.execute(command,walletInfo.address,(next,hash) => { setStage(next); if(hash) updatePending({ hash,command }); });
   await finish(command,result); return true;
  } catch(e) {
   if(e instanceof PendingTransactionError) updatePending({ hash:e.hash,command });
   else updatePending(null);
   setNotice({ text:errorMessage(e),error:true }); return false;
  } finally { operation.current = false; setBusy(false); setStage(null); }
 }
 async function checkPending() {
  const tracked = pendingRef.current; if(!client || !tracked || operation.current) return;
  operation.current = true; setBusy(true); setStage('confirming');
  try { const result = await client.waitForConfirmation(tracked.hash); await finish(tracked.command,result); }
  catch(e) { if(e instanceof FailedTransactionError) updatePending(null); setNotice({ text:errorMessage(e),error:true }); }
  finally { operation.current = false; setBusy(false); setStage(null); }
 }
 async function trackExpense(id: bigint) {
  if(!client || operation.current || reading.current) return false;
  try { if(!catalog.current.expenseIds.includes(String(id)) && catalog.current.expenseIds.length >= 200) throw new Error('Tracking is limited to 200 expenses in this browser.'); await client.get_expense(id); catalog.current.expenseIds = [...new Set([...catalog.current.expenseIds,String(id)])]; persist(); await refresh(); return true; }
  catch(e) { setNotice({ text:errorMessage(e),error:true }); return false; }
 }
 async function trackVendor(address: string) {
  if(!client || operation.current || reading.current) return false;
  try { if(!catalog.current.vendors[address] && Object.keys(catalog.current.vendors).length >= 200) throw new Error('Tracking is limited to 200 vendors in this browser.'); await client.is_vendor(address); catalog.current.vendors[address] ??= { name:shortAddress(address),category:'On-chain vendor' }; persist(); await refresh(); return true; }
  catch(e) { setNotice({ text:errorMessage(e),error:true }); return false; }
 }
 return <Context.Provider value={{ state,balances,ready,loading,loadError,warnings,walletInfo,walletBusy,networkOk,owner,agent,busy,stage,pending,canWrite,notice,clearNotice,connect,disconnect,refresh,dispatch,checkPending,trackExpense,trackVendor }}>{children}</Context.Provider>;
}
export function useSteward() { const context = useContext(Context); if(!context) throw new Error('StewardProvider is required.'); return context; }
