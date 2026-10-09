#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::Event;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Events, Ledger, MockAuth, MockAuthInvoke,
    },
    IntoVal,
};

struct Fixture {
    env: Env,
    id: Address,
    owner: Address,
    agent: Address,
    vendor: Address,
}
impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let owner = Address::generate(&env);
        let agent = Address::generate(&env);
        let vendor = Address::generate(&env);
        let id = env.register(Steward, (&owner, Some(agent.clone()), 1000_i128, 200_i128));
        StewardClient::new(&env, &id).set_vendor(&vendor, &true);
        Self {
            env,
            id,
            owner,
            agent,
            vendor,
        }
    }
    fn client(&self) -> StewardClient<'_> {
        StewardClient::new(&self.env, &self.id)
    }
    fn reference(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[7; 32])
    }
    fn request(&self, amount: i128) -> u64 {
        self.client()
            .request_expense(&self.vendor, &amount, &self.reference())
    }
    fn assert_balances(&self, reserved: i128, approved: i128, available: i128) {
        assert_eq!(
            self.client().get_balances(),
            Balances {
                reserved,
                approved,
                available
            }
        );
    }
}

#[test]
fn lifecycle_and_accounting() {
    let f = Fixture::new();
    let c = f.client();
    let a = f.request(200);
    let b = f.request(150);
    let d = f.request(100);
    assert_eq!((a, b, d), (1, 2, 3));
    f.assert_balances(450, 0, 550);
    c.approve_expense(&a);
    f.assert_balances(250, 200, 550);
    c.reject_expense(&b);
    f.assert_balances(100, 200, 700);
    c.cancel_expense(&d);
    f.assert_balances(0, 200, 800);
    assert_eq!(c.get_expense(&a).status, Status::Approved);
    assert_eq!(c.get_expense(&b).status, Status::Rejected);
    assert_eq!(c.get_expense(&d).status, Status::Cancelled);
    assert_eq!(c.get_expense(&a).reference, f.reference());
    for id in [a, b, d] {
        assert_eq!(c.try_approve_expense(&id), Err(Ok(Error::NotPending)));
        assert_eq!(c.try_reject_expense(&id), Err(Ok(Error::NotPending)));
        assert_eq!(c.try_cancel_expense(&id), Err(Ok(Error::NotPending)));
    }
    f.assert_balances(0, 200, 800);
}
#[test]
fn limits_and_budget_exhaustion() {
    let f = Fixture::new();
    let c = f.client();
    for amount in [0, -1, i128::MIN] {
        assert_eq!(
            c.try_request_expense(&f.vendor, &amount, &f.reference()),
            Err(Ok(Error::InvalidAmount))
        );
    }
    assert_eq!(
        c.try_request_expense(&f.vendor, &201, &f.reference()),
        Err(Ok(Error::LimitExceeded))
    );
    for _ in 0..5 {
        f.request(200);
    }
    f.assert_balances(1000, 0, 0);
    assert_eq!(
        c.try_request_expense(&f.vendor, &1, &f.reference()),
        Err(Ok(Error::BudgetExceeded))
    );
    c.approve_expense(&1);
    f.assert_balances(800, 200, 0);
    c.cancel_expense(&2);
    f.assert_balances(600, 200, 200);
    assert_eq!(f.request(200), 6);
}
#[test]
fn policy_changes_preserve_commitments_and_recheck_limits() {
    let f = Fixture::new();
    let c = f.client();
    let id = f.request(200);
    c.approve_expense(&id);
    let pending = f.request(150);
    assert_eq!(
        c.try_configure_budget(&349, &100),
        Err(Ok(Error::BudgetExceeded))
    );
    for (cap, limit) in [(-1, 0), (100, -1), (100, 101)] {
        assert_eq!(
            c.try_configure_budget(&cap, &limit),
            Err(Ok(Error::InvalidPolicy))
        );
    }
    c.configure_budget(&350, &100);
    f.assert_balances(150, 200, 0);
    assert_eq!(
        c.try_approve_expense(&pending),
        Err(Ok(Error::LimitExceeded))
    );
    c.reject_expense(&pending);
    c.configure_budget(&200, &0);
    f.assert_balances(0, 200, 0);
    assert_eq!(
        c.try_configure_budget(&0, &0),
        Err(Ok(Error::BudgetExceeded))
    );
}
#[test]
fn vendors_are_checked_at_request_and_approval() {
    let f = Fixture::new();
    let c = f.client();
    let other = Address::generate(&f.env);
    assert!(!c.is_vendor(&other));
    assert_eq!(
        c.try_request_expense(&other, &1, &f.reference()),
        Err(Ok(Error::VendorNotApproved))
    );
    let id = f.request(100);
    c.set_vendor(&f.vendor, &false);
    assert_eq!(
        c.try_approve_expense(&id),
        Err(Ok(Error::VendorNotApproved))
    );
    f.assert_balances(100, 0, 900);
    c.set_vendor(&f.vendor, &true);
    c.approve_expense(&id);
    c.set_vendor(&f.vendor, &false);
    c.set_vendor(&f.vendor, &false);
    f.assert_balances(0, 100, 900);
}
#[test]
fn pause_blocks_commitments_but_allows_releases() {
    let f = Fixture::new();
    let c = f.client();
    let a = f.request(100);
    let b = f.request(100);
    c.pause();
    assert!(c.get_policy().paused);
    assert_eq!(
        c.try_request_expense(&f.vendor, &1, &f.reference()),
        Err(Ok(Error::Paused))
    );
    assert_eq!(c.try_approve_expense(&a), Err(Ok(Error::Paused)));
    c.reject_expense(&a);
    c.cancel_expense(&b);
    f.assert_balances(0, 0, 1000);
    c.resume();
    assert!(!c.get_policy().paused);
    c.approve_expense(&f.request(100));
}
#[test]
fn revocation_rotation_and_original_requester_cancellation() {
    let f = Fixture::new();
    let c = f.client();
    let id = f.request(100);
    c.set_agent(&None);
    assert_eq!(
        c.try_request_expense(&f.vendor, &1, &f.reference()),
        Err(Ok(Error::NoAgent))
    );
    c.cancel_expense(&id);
    f.assert_balances(0, 0, 1000);
    let replacement = Address::generate(&f.env);
    c.set_agent(&Some(replacement.clone()));
    let id = f.request(100);
    assert_eq!(f.env.auths()[0].0, replacement);
    assert_eq!(c.get_expense(&id).agent, replacement);
}
#[test]
fn owner_methods_require_owner_not_another_signer() {
    let f = Fixture::new();
    let c = f.client();
    let id = f.request(100);
    // Exact mocks for the wrong principal cannot satisfy stored-owner require_auth.
    f.env.mock_auths(&[MockAuth {
        address: &f.agent,
        invoke: &MockAuthInvoke {
            contract: &f.id,
            fn_name: "pause",
            args: ().into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(c.try_pause().is_err());
    f.env.mock_auths(&[]);
    assert!(c.try_resume().is_err());
    assert!(c.try_configure_budget(&1000, &200).is_err());
    assert!(c.try_set_agent(&None).is_err());
    assert!(c.try_set_vendor(&f.vendor, &false).is_err());
    assert!(c.try_approve_expense(&id).is_err());
    assert!(c.try_reject_expense(&id).is_err());
    assert!(c.try_maintain_ttl(&None, &None).is_err());
    f.assert_balances(100, 0, 900);
    assert!(c.is_vendor(&f.vendor));
    c.mock_auths(&[MockAuth {
        address: &f.owner,
        invoke: &MockAuthInvoke {
            contract: &f.id,
            fn_name: "pause",
            args: ().into_val(&f.env),
            sub_invokes: &[],
        },
    }])
    .pause();
    assert!(c.get_policy().paused);
}
#[test]
fn request_and_cancel_require_correct_agent() {
    let f = Fixture::new();
    let c = f.client();
    let id = f.request(100);
    let replacement = Address::generate(&f.env);
    c.set_agent(&Some(replacement.clone()));
    f.env.mock_auths(&[]);
    assert!(c
        .try_request_expense(&f.vendor, &1, &f.reference())
        .is_err());
    assert!(c.try_cancel_expense(&id).is_err());
    c.mock_auths(&[MockAuth {
        address: &f.agent,
        invoke: &MockAuthInvoke {
            contract: &f.id,
            fn_name: "request_expense",
            args: (&f.vendor, 1_i128, f.reference()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(c
        .try_request_expense(&f.vendor, &1, &f.reference())
        .is_err());
    assert!(c
        .mock_auths(&[MockAuth {
            address: &replacement,
            invoke: &MockAuthInvoke {
                contract: &f.id,
                fn_name: "cancel_expense",
                args: (id,).into_val(&f.env),
                sub_invokes: &[],
            }
        }])
        .try_cancel_expense(&id)
        .is_err());
    c.mock_auths(&[MockAuth {
        address: &f.agent,
        invoke: &MockAuthInvoke {
            contract: &f.id,
            fn_name: "cancel_expense",
            args: (id,).into_val(&f.env),
            sub_invokes: &[],
        },
    }])
    .cancel_expense(&id);
    f.assert_balances(0, 0, 1000);
}
#[test]
fn unknown_records_and_missing_accounting_fail_closed() {
    let f = Fixture::new();
    let c = f.client();
    assert_eq!(c.try_get_expense(&999), Err(Ok(Error::ExpenseNotFound)));
    assert_eq!(c.try_approve_expense(&999), Err(Ok(Error::ExpenseNotFound)));
    assert_eq!(c.try_reject_expense(&999), Err(Ok(Error::ExpenseNotFound)));
    assert_eq!(c.try_cancel_expense(&999), Err(Ok(Error::ExpenseNotFound)));
    f.env
        .as_contract(&f.id, || f.env.storage().instance().remove(&Key::Reserved));
    assert_eq!(c.try_get_balances(), Err(Ok(Error::MissingState)));
    assert_eq!(
        c.try_request_expense(&f.vendor, &1, &f.reference()),
        Err(Ok(Error::MissingState))
    );
}
#[test]
fn maximum_amounts_and_id_overflow_are_safe() {
    let f = Fixture::new();
    let c = f.client();
    c.configure_budget(&i128::MAX, &i128::MAX);
    let id = f.request(i128::MAX);
    c.approve_expense(&id);
    f.assert_balances(0, i128::MAX, 0);
    assert_eq!(
        c.try_request_expense(&f.vendor, &1, &f.reference()),
        Err(Ok(Error::BudgetExceeded))
    );
    let f = Fixture::new();
    let c = f.client();
    f.env.as_contract(&f.id, || {
        f.env.storage().instance().set(&Key::NextId, &u64::MAX)
    });
    assert_eq!(
        c.try_request_expense(&f.vendor, &1, &f.reference()),
        Err(Ok(Error::Arithmetic))
    );
    f.assert_balances(0, 0, 1000);
}
#[test]
fn events_and_ttl_maintenance_and_reads() {
    let f = Fixture::new();
    let c = f.client();
    let id = f.request(100);
    let events = f.env.events().all();
    let actual = events.events().last().unwrap();
    let expense = c.get_expense(&id);
    let expected = ExpenseChanged { id, expense };
    assert_eq!(actual, &expected.to_xdr(&f.env, &f.id));
    let before = f.env.as_contract(&f.id, || {
        (
            f.env.storage().instance().get_ttl(),
            f.env.storage().persistent().get_ttl(&Key::Expense(id)),
        )
    });
    assert!(before.0 > 0 && before.1 > 0);
    f.env.ledger().with_mut(|l| l.sequence_number += 300_000);
    let ttl = f.env.as_contract(&f.id, || {
        f.env.storage().persistent().get_ttl(&Key::Expense(id))
    });
    c.get_policy();
    c.get_balances();
    c.get_expense(&id);
    c.is_vendor(&f.vendor);
    assert_eq!(
        ttl,
        f.env.as_contract(&f.id, || f
            .env
            .storage()
            .persistent()
            .get_ttl(&Key::Expense(id)))
    );
    c.maintain_ttl(&Some(id), &Some(f.vendor.clone()));
    assert!(
        f.env.as_contract(&f.id, || f
            .env
            .storage()
            .persistent()
            .get_ttl(&Key::Expense(id)))
            > ttl
    );
    assert_eq!(
        c.try_maintain_ttl(&Some(999), &None),
        Err(Ok(Error::ExpenseNotFound))
    );
    f.assert_balances(100, 0, 900);
}
#[test]
fn zero_budget_is_valid_and_blocks_spending() {
    let f = Fixture::new();
    let c = f.client();
    c.configure_budget(&0, &0);
    f.assert_balances(0, 0, 0);
    assert_eq!(
        c.try_request_expense(&f.vendor, &1, &f.reference()),
        Err(Ok(Error::LimitExceeded))
    );
}

#[test]
#[should_panic]
fn constructor_rejects_negative_budget() {
    let env = Env::default();
    let owner = Address::generate(&env);
    env.register(Steward, (&owner, None::<Address>, -1_i128, 0_i128));
}
#[test]
#[should_panic]
fn constructor_rejects_limit_above_budget() {
    let env = Env::default();
    let owner = Address::generate(&env);
    env.register(Steward, (&owner, None::<Address>, 100_i128, 101_i128));
}

// Actual WASM constructor auth: native Env::register mocks constructor auth.
// Run after `stellar contract build`: cargo test -- --include-ignored
#[test]
#[ignore = "requires stellar contract build first"]
fn wasm_constructor_requires_owner_authorization() {
    use soroban_sdk::ContractExecutable;
    let env = Env::default();
    let wasm = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/wasm32v1-none/release/steward.wasm"),
    )
    .unwrap();
    let hash = env.deployer().upload_contract_wasm(wasm.as_slice());
    let deployer_owner = Address::generate(&env);
    let deployer = env.register(Steward, (&deployer_owner, None::<Address>, 0_i128, 0_i128));
    let owner = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[42; 32]);
    let expected_id = env.as_contract(&deployer, || {
        env.deployer()
            .with_current_contract(salt.clone())
            .deployed_address()
    });
    // The currently executing deployer contract implicitly authorizes creation;
    // the distinct owner still must explicitly authorize its constructor.
    env.mock_auths(&[]);
    let failure = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&deployer, || {
            env.deployer()
                .with_current_contract(salt.clone())
                .deploy_contract(
                    ContractExecutable::Wasm(hash.clone()),
                    (&owner, None::<Address>, 1000_i128, 200_i128),
                )
        });
    }));
    assert!(failure.is_err());
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &expected_id,
            fn_name: "__constructor",
            args: (&owner, None::<Address>, 1000_i128, 200_i128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let id = env.as_contract(&deployer, || {
        env.deployer().with_current_contract(salt).deploy_contract(
            ContractExecutable::Wasm(hash),
            (&owner, None::<Address>, 1000_i128, 200_i128),
        )
    });
    assert_eq!(id, expected_id);
    let c = StewardClient::new(&env, &id);
    assert_eq!(c.get_policy().owner, owner);
    assert_eq!(
        c.get_balances(),
        Balances {
            reserved: 0,
            approved: 0,
            available: 1000
        }
    );
}
