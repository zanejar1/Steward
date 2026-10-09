// Mirrors contracts/steward/src/lib.rs. bigint preserves Soroban i128/u64 precision.
export type Address = string;
export type UsdCents = bigint;
export type Bytes32 = string; // 64 hexadecimal characters; encoded as BytesN<32> at integration.
export type Status = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export interface Policy { owner: Address; agent: Address | null; budget_cap: UsdCents; expense_limit: UsdCents; paused: boolean }
export interface Balances { reserved: UsdCents; approved: UsdCents; available: UsdCents }
export interface Expense { id: bigint; agent: Address; vendor: Address; amount: UsdCents; reference: Bytes32; status: Status }
// Presentation metadata is not stored by the contract.
export interface ExpenseView extends Expense { description: string; date: string; category: string }
export interface Vendor { address: Address; name: string; category: string; approved: boolean }
export interface WorkspaceState { policy: Policy; expenses: ExpenseView[]; vendors: Vendor[] }
// Retained for the isolated accounting fixtures; live UI uses WorkspaceState.
export type DemoState = WorkspaceState;
export type Command =
 | { function: 'maintain_ttl'; expense_id: bigint | null; vendor: Address | null }
 | { function: 'configure_budget'; budget_cap: bigint; expense_limit: bigint }
 | { function: 'set_agent'; agent: Address | null }
 | { function: 'set_vendor'; vendor: Vendor; approved: boolean }
 | { function: 'pause' | 'resume' }
 | { function: 'approve_expense' | 'reject_expense' | 'cancel_expense'; id: bigint }
 | { function: 'request_expense'; vendor: Address; amount: bigint; reference: Bytes32; description: string; date: string; category: string };

// Contract signatures. Constructor arguments are handled by deployment, not invocation.
export interface StewardContractApi {
 __constructor(owner: Address, agent: Address | null, budget_cap: UsdCents, expense_limit: UsdCents): Promise<void>;
 configure_budget(budget_cap: UsdCents, expense_limit: UsdCents): Promise<void>;
 set_agent(agent: Address | null): Promise<void>;
 set_vendor(vendor: Address, approved: boolean): Promise<void>;
 pause(): Promise<void>;
 resume(): Promise<void>;
 request_expense(vendor: Address, amount: UsdCents, reference: Bytes32): Promise<bigint>;
 approve_expense(id: bigint): Promise<void>;
 reject_expense(id: bigint): Promise<void>;
 cancel_expense(id: bigint): Promise<void>;
 get_policy(): Promise<Policy>;
 get_balances(): Promise<Balances>;
 is_vendor(vendor: Address): Promise<boolean>;
 get_expense(id: bigint): Promise<Expense>;
 maintain_ttl(expense_id: bigint | null, vendor: Address | null): Promise<void>;
}
export enum ContractError { MissingState = 1, InvalidAmount, InvalidPolicy, NoAgent, VendorNotApproved, LimitExceeded, BudgetExceeded, Paused, ExpenseNotFound, NotPending, Arithmetic }
