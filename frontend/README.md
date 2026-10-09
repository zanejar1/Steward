# Steward frontend

Next.js App Router, TypeScript, Tailwind CSS and Lucide UI with the official `@stellar/stellar-sdk` and `@stellar/freighter-api`. The existing visual design is preserved. The active application uses real contract reads and signed writes; mock fixtures remain only for isolated accounting tests.

## Run and configure

Requires Node.js 20.9+ and npm. From the workspace root:

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The contract has not been deployed: leaving `NEXT_PUBLIC_STEWARD_CONTRACT_ID` blank displays the unconfigured screen and makes no contract RPC calls. Wallet connection can still be tested. Deploy the contract separately, then set its C… address in `.env.local` and restart the dev server. Public environment values are embedded at build time; rebuild for production after changing them.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_STEWARD_CONTRACT_ID` | Deployed Steward C… contract address; blank is supported |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` only |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | HTTPS RPC, default `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_STEWARD_EXPENSE_IDS` | Optional comma-separated u64 IDs to track |
| `NEXT_PUBLIC_STEWARD_VENDOR_ADDRESSES` | Optional comma-separated G…/C… vendor addresses to track |

All values are public. Never put private keys, mnemonic phrases, CLI secrets or the `me` identity secret into frontend configuration. No secret key is read, generated or shipped by this integration. Writes need a funded testnet Freighter account; there is no automatic funding or deployment.

## Checks

```sh
npm run lint
npm test
npm run build
```

`npm start` runs the production build locally. Tests exercise XDR codecs, wallet checks, transaction sequencing, RPC rejection/uncertainty, confirmation and local accounting with mocked transports. They do not contact testnet.

## Contract behavior and UI

- Dashboard reads `get_policy` and `get_balances` via unsigned RPC simulation. Reserved, approved (called committed in the UI) and available balances come directly from the contract, independently of the tracked expense list. Amounts remain bigint USD cents.
- Expenses reads `get_expense(id)`, supports manual ID lookup, and signs `request_expense`, `approve_expense`, `reject_expense` and `cancel_expense` using the appropriate wallet role.
- Vendors checks `is_vendor(address)` and signs `set_vendor(address, approved)`. Address lookup supports existing vendors without changing approval.
- Settings signs `configure_budget`, `set_agent`, `pause`, `resume` and `maintain_ttl`. Policy drafts update only after confirmed contract data reloads.
- `StewardClient` in `src/lib/stellar/client.ts` exposes every runtime contract function. `__constructor` is deployment-only, so its argument encoder and `deploymentOperation` helper construct the create-contract operation with constructor arguments; it is never invoked on an existing contract. No deployment UI or automatic deployment is included.

Reads do not ask for a wallet signature or submit a transaction. They use a public zero-address simulation source, as the SDK supports for unsigned queries. Writes verify the configured RPC passphrase and wallet testnet passphrase, load a fresh source-account sequence, simulate, assemble Soroban resources/auth, ask Freighter to sign, verify that the wallet returned the same transaction, submit once and poll a terminal ledger result. Simulation errors, role failures and rejected signatures stop before submission. Only confirmed success refreshes state and records local request/vendor metadata.

The owner handles administration and approvals/rejections. Requests require the currently authorized agent. Cancellation requires the original requesting agent, including after revocation. The single-authority account is used as transaction source, so transaction signing satisfies source-account authorization. Extra non-source authorization is rejected explicitly. The contract remains the final authority for accounting and policy, including reserved + approved <= budget cap; the UI does not optimistically alter balances.

On page load, the frontend restores an existing Freighter site permission without prompting, then reads the current wallet address and network. Previously, wallet state always started as disconnected after a reload, so an already connected extension could coexist with disabled owner controls. Explicit connection and disconnection take priority over an in-flight restoration. Owner controls require an exact match with `get_policy().owner`; all writes also require loaded contract state, the exact testnet passphrase, and no active read, transaction, or unresolved confirmation. New requests additionally require the configured agent and unpaused processing; owner status alone does not grant permission to request expenses.

## Tracking and metadata gaps

The contract has **no expense-list, vendor-list or next-ID getter**. This UI intentionally does not invent a full registry, scan arbitrary IDs or claim that the RPC's limited event history is complete. Look up known IDs/addresses, seed them with the optional environment variables, or create requests/vendors through the app. An indexer or contract enumeration API is needed for complete cross-browser history and discovery.

Tracked IDs/addresses and local labels are stored in browser localStorage, scoped by network/contract, with a limit of 200 expenses and 200 vendors and bounded read concurrency. Statuses, policy, amounts and vendor approval are always re-read, never trusted from cached metadata. Failed entry reads are displayed as incomplete-list warnings. Vendor spending totals are explicitly limited to tracked expenses. Names, categories, descriptions and dates are absent from the contract; they are labeled local metadata, and absent dates show “Not recorded.” Local request metadata is associated with the confirmed expense reference. Browser storage is not encrypted; avoid sensitive business descriptions on shared devices. If storage is unavailable, tracking lasts only in memory.

Submission uncertainty and confirmation timeouts retain the computed transaction hash and lock writes to prevent duplicate submission. The “Check confirmation” action only polls; it never resubmits. Pending hash/command information survives reload in sessionStorage in the same tab. If storage is unavailable it survives only in memory. If a hash remains unavailable beyond RPC history retention, resolve it against a trusted transaction history source before clearing that tab's pending record; the UI does not assume that NOT_FOUND means failure.

Freighter disconnect is local to the application, because the extension API has no revoke-permission method. The user can remove the site in Freighter's Allow List. Network/account changes are checked on focus, periodically while connected and before/after signing.

## Remaining integration limits

- No deployed contract was available for an end-to-end wallet/ledger check. Actual deployment compatibility, owner/agent accounts, account funding and browser Freighter approval still need validation after deployment.
- Archived ledger state is detected and reported, but restore-footprint transactions are not automated. TTL maintenance is supported for live entries.
- Contract-account owners/agents and multi-party or multisig authorization require a dedicated signing flow; this implementation supports a single Freighter G… account acting as invocation authority/source.
- No token transfers, USDC payments, AI behavior, indexer, backend metadata service or encrypted metadata storage is implemented. Approvals record budget commitments only.

## Source layout and documentation

- `src/lib/stellar/`: configuration, XDR codecs, wallet adapter, reusable client, browser tracking and integration tests.
- `src/components/store.tsx`: live read/transaction orchestration and wallet/confirmation state.
- `src/app/` and `src/components/`: existing page design, connected forms and shared status/notification views.
- `.env.example`: public environment template; `.env.local` remains ignored.

Stellar Raven MCP was consulted for current official Freighter, dapp and simulation documentation. Reference sources: [Stellar frontend guide](https://developers.stellar.org/docs/build/guides/dapps/frontend-guide), [simulation guide](https://developers.stellar.org/docs/build/guides/transactions/simulateTransaction-Deep-Dive), [SDK RPC reference](https://stellar.github.io/js-stellar-sdk/reference/network-rpc/) and [Freighter connection documentation](https://github.com/stellar/freighter-developer-docs/blob/main/extension/connecting.md). Installed official SDK/Freighter type definitions were checked for the current API signatures.
