import { StrKey } from '@stellar/stellar-sdk';
import * as freighter from '@stellar/freighter-api';
export interface WalletInfo { address: string; network: string; networkPassphrase: string }
export interface WalletAdapter {
 connect(): Promise<WalletInfo>; inspect(): Promise<WalletInfo>;
 sign(xdr: string, address: string, networkPassphrase: string): Promise<string>;
}
function checkError(result: { error?: { message?: string } }) { if(result.error) throw new Error(result.error.message || 'Freighter declined the request.'); }
export type FreighterApi = Pick<typeof freighter,'isConnected' | 'requestAccess' | 'getAddress' | 'getNetworkDetails' | 'signTransaction'>;
export function createWallet(api: FreighterApi = freighter): WalletAdapter { return {
 async connect() {
  const installed = await api.isConnected(); checkError(installed);
  if(!installed.isConnected) throw new Error('Install and unlock the Freighter browser extension to connect.');
  const access = await api.requestAccess(); checkError(access);
  if(!StrKey.isValidEd25519PublicKey(access.address)) throw new Error('Freighter did not return a valid account address.');
  const info = await this.inspect();
  if(info.address !== access.address) throw new Error('The wallet account changed during connection. Reconnect.');
  return info;
 },
 async inspect() {
  const [account, network] = await Promise.all([api.getAddress(), api.getNetworkDetails()]);
  checkError(account); checkError(network);
  if(!StrKey.isValidEd25519PublicKey(account.address)) throw new Error('Unlock Freighter and reconnect your account.');
  return { address: account.address, network: network.network, networkPassphrase: network.networkPassphrase };
 },
 async sign(transactionXdr, account, networkPassphrase) {
  const info = await this.inspect();
  if(info.networkPassphrase !== networkPassphrase) throw new Error('Switch Freighter to Stellar testnet before signing.');
  if(info.address !== account) throw new Error('The wallet account changed. Reconnect before signing.');
  const signed = await api.signTransaction(transactionXdr, { address: account, networkPassphrase }); checkError(signed);
  if(!signed.signedTxXdr || signed.signerAddress !== account) throw new Error('Freighter did not sign with the connected account.');
  const after = await this.inspect();
  if(after.address !== account || after.networkPassphrase !== networkPassphrase) throw new Error('Wallet account or network changed during signing. Transaction was not submitted.');
  return signed.signedTxXdr;
 },
}; }
export const wallet = createWallet();
// Restore only an already authorized site, without opening an access prompt.
// Always read the current account and network; cached addresses are not authority.
export async function restoreWallet(api: FreighterApi & Pick<typeof freighter, 'isAllowed'> = freighter): Promise<WalletInfo | null> {
 const installed = await api.isConnected();
 if(installed.error || !installed.isConnected) return null;
 const allowed = await api.isAllowed();
 if(allowed.error || !allowed.isAllowed) return null;
 return createWallet(api).inspect();
}
// Freighter has no revoke/disconnect API. The provider disconnects locally;
// users can remove the site's permission in Freighter's Allow List themselves.
