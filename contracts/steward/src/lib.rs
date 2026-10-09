#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
};

// Roughly 30 days at 5 seconds/ledger; always capped to the network maximum.
const TTL_TARGET: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    MissingState = 1,
    InvalidAmount = 2,
    InvalidPolicy = 3,
    NoAgent = 4,
    VendorNotApproved = 5,
    LimitExceeded = 6,
    BudgetExceeded = 7,
    Paused = 8,
    ExpenseNotFound = 9,
    NotPending = 10,
    Arithmetic = 11,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    pub owner: Address,
    pub agent: Option<Address>,
    pub budget_cap: i128,
    pub expense_limit: i128,
    pub paused: bool,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Balances {
    pub reserved: i128,
    pub approved: i128,
    pub available: i128,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Pending,
    Approved,
    Rejected,
    Cancelled,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Expense {
    pub id: u64,
    pub agent: Address,
    pub vendor: Address,
    pub amount: i128,
    pub reference: BytesN<32>,
    pub status: Status,
}
#[contracttype]
#[derive(Clone)]
enum Key {
    Policy,
    Reserved,
    Approved,
    NextId,
    Vendor(Address),
    Expense(u64),
}
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyChanged {
    pub policy: Policy,
}
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VendorChanged {
    #[topic]
    pub vendor: Address,
    pub approved: bool,
}
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpenseChanged {
    #[topic]
    pub id: u64,
    pub expense: Expense,
}
#[contract]
pub struct Steward;

fn extend_instance(env: &Env) {
    let target = TTL_TARGET.min(env.storage().max_ttl());
    env.storage().instance().extend_ttl(target / 2, target);
}
fn extend_entry(env: &Env, key: &Key) {
    let target = TTL_TARGET.min(env.storage().max_ttl());
    env.storage()
        .persistent()
        .extend_ttl(key, target / 2, target);
}
fn policy(env: &Env) -> Result<Policy, Error> {
    env.storage()
        .instance()
        .get(&Key::Policy)
        .ok_or(Error::MissingState)
}
fn owner_policy(env: &Env) -> Result<Policy, Error> {
    let p = policy(env)?;
    p.owner.require_auth();
    Ok(p)
}
fn balances(env: &Env, p: &Policy) -> Result<Balances, Error> {
    let reserved: i128 = env
        .storage()
        .instance()
        .get(&Key::Reserved)
        .ok_or(Error::MissingState)?;
    let approved: i128 = env
        .storage()
        .instance()
        .get(&Key::Approved)
        .ok_or(Error::MissingState)?;
    let committed = reserved.checked_add(approved).ok_or(Error::Arithmetic)?;
    let available = p
        .budget_cap
        .checked_sub(committed)
        .ok_or(Error::Arithmetic)?;
    if reserved < 0 || approved < 0 || available < 0 {
        return Err(Error::BudgetExceeded);
    }
    Ok(Balances {
        reserved,
        approved,
        available,
    })
}
fn validate_policy(cap: i128, limit: i128) -> Result<(), Error> {
    if cap < 0 || limit < 0 || limit > cap {
        return Err(Error::InvalidPolicy);
    }
    Ok(())
}
fn save_policy(env: &Env, p: &Policy) {
    env.storage().instance().set(&Key::Policy, p);
    extend_instance(env);
    PolicyChanged { policy: p.clone() }.publish(env);
}
fn vendor_allowed(env: &Env, vendor: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&Key::Vendor(vendor.clone()))
        .unwrap_or(false)
}
fn pending(env: &Env, id: u64) -> Result<Expense, Error> {
    let e: Expense = env
        .storage()
        .persistent()
        .get(&Key::Expense(id))
        .ok_or(Error::ExpenseNotFound)?;
    if e.status != Status::Pending {
        return Err(Error::NotPending);
    }
    Ok(e)
}
fn save_expense(env: &Env, e: &Expense) {
    let key = Key::Expense(e.id);
    env.storage().persistent().set(&key, e);
    extend_entry(env, &key);
    extend_instance(env);
    ExpenseChanged {
        id: e.id,
        expense: e.clone(),
    }
    .publish(env);
}
fn release(env: &Env, p: &Policy, e: &mut Expense, status: Status) -> Result<(), Error> {
    let b = balances(env, p)?;
    let reserved = b.reserved.checked_sub(e.amount).ok_or(Error::Arithmetic)?;
    if reserved < 0 {
        return Err(Error::Arithmetic);
    }
    env.storage().instance().set(&Key::Reserved, &reserved);
    e.status = status;
    save_expense(env, e);
    Ok(())
}
#[contractimpl]
impl Steward {
    /// All amounts are USD cents: 100 units = USD 1.00. No tokens or payments.
    pub fn __constructor(
        env: Env,
        owner: Address,
        agent: Option<Address>,
        budget_cap: i128,
        expense_limit: i128,
    ) -> Result<(), Error> {
        owner.require_auth();
        validate_policy(budget_cap, expense_limit)?;
        env.storage().instance().set(&Key::Reserved, &0_i128);
        env.storage().instance().set(&Key::Approved, &0_i128);
        env.storage().instance().set(&Key::NextId, &1_u64);
        save_policy(
            &env,
            &Policy {
                owner,
                agent,
                budget_cap,
                expense_limit,
                paused: false,
            },
        );
        Ok(())
    }
    pub fn configure_budget(env: Env, budget_cap: i128, expense_limit: i128) -> Result<(), Error> {
        let mut p = owner_policy(&env)?;
        validate_policy(budget_cap, expense_limit)?;
        let b = balances(&env, &p)?;
        if budget_cap
            < b.reserved
                .checked_add(b.approved)
                .ok_or(Error::Arithmetic)?
        {
            return Err(Error::BudgetExceeded);
        }
        p.budget_cap = budget_cap;
        p.expense_limit = expense_limit;
        save_policy(&env, &p);
        Ok(())
    }
    pub fn set_agent(env: Env, agent: Option<Address>) -> Result<(), Error> {
        let mut p = owner_policy(&env)?;
        p.agent = agent;
        save_policy(&env, &p);
        Ok(())
    }
    pub fn set_vendor(env: Env, vendor: Address, approved: bool) -> Result<(), Error> {
        owner_policy(&env)?;
        let key = Key::Vendor(vendor.clone());
        if approved {
            env.storage().persistent().set(&key, &true);
            extend_entry(&env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
        extend_instance(&env);
        VendorChanged { vendor, approved }.publish(&env);
        Ok(())
    }
    pub fn pause(env: Env) -> Result<(), Error> {
        Self::set_paused(&env, true)
    }
    pub fn resume(env: Env) -> Result<(), Error> {
        Self::set_paused(&env, false)
    }
    pub fn request_expense(
        env: Env,
        vendor: Address,
        amount: i128,
        reference: BytesN<32>,
    ) -> Result<u64, Error> {
        let p = policy(&env)?;
        let agent = p.agent.clone().ok_or(Error::NoAgent)?;
        agent.require_auth();
        if p.paused {
            return Err(Error::Paused);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if !vendor_allowed(&env, &vendor) {
            return Err(Error::VendorNotApproved);
        }
        if amount > p.expense_limit {
            return Err(Error::LimitExceeded);
        }
        let b = balances(&env, &p)?;
        if amount > b.available {
            return Err(Error::BudgetExceeded);
        }
        let id: u64 = env
            .storage()
            .instance()
            .get(&Key::NextId)
            .ok_or(Error::MissingState)?;
        let next_id = id.checked_add(1).ok_or(Error::Arithmetic)?;
        let reserved = b.reserved.checked_add(amount).ok_or(Error::Arithmetic)?;
        env.storage().instance().set(&Key::NextId, &next_id);
        env.storage().instance().set(&Key::Reserved, &reserved);
        extend_entry(&env, &Key::Vendor(vendor.clone()));
        save_expense(
            &env,
            &Expense {
                id,
                agent,
                vendor,
                amount,
                reference,
                status: Status::Pending,
            },
        );
        Ok(id)
    }
    pub fn approve_expense(env: Env, id: u64) -> Result<(), Error> {
        let p = owner_policy(&env)?;
        if p.paused {
            return Err(Error::Paused);
        }
        let mut e = pending(&env, id)?;
        if !vendor_allowed(&env, &e.vendor) {
            return Err(Error::VendorNotApproved);
        }
        if e.amount > p.expense_limit {
            return Err(Error::LimitExceeded);
        }
        let b = balances(&env, &p)?;
        let approved = b.approved.checked_add(e.amount).ok_or(Error::Arithmetic)?;
        release(&env, &p, &mut e, Status::Approved)?;
        env.storage().instance().set(&Key::Approved, &approved);
        extend_entry(&env, &Key::Vendor(e.vendor));
        Ok(())
    }
    pub fn reject_expense(env: Env, id: u64) -> Result<(), Error> {
        let p = owner_policy(&env)?;
        let mut e = pending(&env, id)?;
        release(&env, &p, &mut e, Status::Rejected)
    }
    /// Original requester can cancel after revocation, releasing budget only.
    pub fn cancel_expense(env: Env, id: u64) -> Result<(), Error> {
        let p = policy(&env)?;
        let mut e = pending(&env, id)?;
        e.agent.require_auth();
        release(&env, &p, &mut e, Status::Cancelled)
    }
    pub fn get_policy(env: Env) -> Result<Policy, Error> {
        policy(&env)
    }
    pub fn get_balances(env: Env) -> Result<Balances, Error> {
        balances(&env, &policy(&env)?)
    }
    pub fn is_vendor(env: Env, vendor: Address) -> bool {
        vendor_allowed(&env, &vendor)
    }
    pub fn get_expense(env: Env, id: u64) -> Result<Expense, Error> {
        env.storage()
            .persistent()
            .get(&Key::Expense(id))
            .ok_or(Error::ExpenseNotFound)
    }
    /// Refresh shared state and selected entries; reads never extend TTL.
    pub fn maintain_ttl(
        env: Env,
        expense_id: Option<u64>,
        vendor: Option<Address>,
    ) -> Result<(), Error> {
        owner_policy(&env)?;
        if let Some(id) = expense_id {
            Self::get_expense(env.clone(), id)?;
            extend_entry(&env, &Key::Expense(id));
        }
        if let Some(v) = vendor {
            if !vendor_allowed(&env, &v) {
                return Err(Error::VendorNotApproved);
            }
            extend_entry(&env, &Key::Vendor(v));
        }
        extend_instance(&env);
        Ok(())
    }
}
impl Steward {
    fn set_paused(env: &Env, paused: bool) -> Result<(), Error> {
        let mut p = owner_policy(env)?;
        p.paused = paused;
        save_policy(env, &p);
        Ok(())
    }
}
mod test;
