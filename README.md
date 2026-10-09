# Steward

**AI-powered expense management. Enforced by Stellar.**

Steward is an AI-powered financial management platform designed to help businesses automate expenses while maintaining full control over how their money is spent.

As AI agents become capable of handling real business operations, Steward aims to solve a critical problem: **how can businesses delegate financial tasks to AI without giving it unrestricted spending authority?**

Our approach combines AI-driven automation with Stellar smart contracts that independently enforce budgets, spending limits, vendor permissions, and approval rules.

**Built for HackMeridian 2026 | Stellar Testnet**

---

## The Problem

Businesses spend significant time managing invoices, approving expenses, tracking budgets, and coordinating payments.

AI agents have the potential to automate much of this work. However, allowing autonomous software to make financial decisions introduces new risks.

An AI agent could exceed its assigned budget, pay an unauthorized recipient, or execute an expense without the necessary approval.

Traditional financial software relies primarily on application-level permissions and centralized controls. For autonomous financial systems, we believe spending restrictions should be enforced independently of the AI making decisions.

**AI should be able to manage expenses, but it should never have unlimited authority over company funds.**

## Our Solution

Steward introduces a financial control layer between AI agents and business spending.

Business owners define their spending policies, while a Soroban smart contract enforces those rules independently of the agent.

The platform is designed around four core capabilities:

**1. Intelligent expense management**

AI agents will be able to analyze invoices, identify payment obligations, organize expenses, and propose financial actions.

**2. Enforceable spending policies**

Businesses establish budgets, individual expense limits, and approved recipients. These constraints are enforced through Stellar smart contracts rather than relying solely on AI instructions.

**3. Human oversight**

Business owners retain control over sensitive financial decisions, with approval workflows for expenses requiring authorization.

**4. Transparent financial activity**

Expense requests, approvals, and policy enforcement can be verified through on-chain activity, providing a foundation for auditable autonomous spending.

### How It Works

```text
Business Owner
      |
      v
Defines Budget & Spending Rules
      |
      v
Steward AI Agent (planned)
      |
      v
Creates Expense Request
      |
      v
Soroban Smart Contract
      |
      +---- Validates Budget
      +---- Checks Vendor Permissions
      +---- Enforces Spending Limits
      +---- Verifies Authorization
      |
      v
Approval / Rejection
      |
      v
Payment Execution (planned)
```

The central principle is simple: **the AI proposes actions, but the smart contract enforces the rules.**

---

## Why Stellar?

Stellar is central to Steward's architecture, not simply an additional payment option.

### Soroban: Programmable financial controls

Soroban enables us to implement spending policies directly on-chain, making authorization and budget enforcement independent of the AI agent and frontend.

### Fast and affordable transactions

Stellar's efficient transaction infrastructure makes it suitable for frequent financial operations, including smaller automated payments.

### Stablecoin payments

Stellar's USDC ecosystem provides a path toward real-world stablecoin payments, allowing Steward to evolve beyond expense tracking into financial execution.

### Agentic payments and x402

Stellar's support for x402 creates opportunities for AI agents to purchase digital services through standardized payment requests.

This aligns with our long-term vision of autonomous agents operating within enforceable financial boundaries.

### Financial accessibility

Stellar's broader payment ecosystem, including integrations such as MoneyGram Ramps, also creates opportunities to connect digital payments with traditional financial infrastructure.

---

## What We've Built

Steward currently has two primary components: a deployed Soroban smart contract and a connected web dashboard.

### Soroban Smart Contract

Developed in Rust, the contract implements the core financial policy and expense-management logic.

Its capabilities include:

- Owner and authorized-agent roles
- Configurable spending budgets
- Per-expense spending limits
- Approved vendor management
- Expense creation, approval, rejection, and cancellation
- Budget reservation and approved-commitment accounting
- Emergency pause and resume controls
- On-chain authorization and validation
- Contract events and persistent state management

The contract has been deployed to **Stellar Testnet** and successfully invoked on-chain.

**Contract address:** `CDC7AM3KVYGI6VNP5NPE7W7CHXM4V5H7UREUZEPKJL4EITXSGJBGPKBX`

**Explorer:** `https://stellar.expert/explorer/testnet/contract/CDC7AM3KVYGI6VNP5NPE7W7CHXM4V5H7UREUZEPKJL4EITXSGJBGPKBX`

### Steward Dashboard

We have developed a web application that provides a central interface for managing business spending.

The dashboard includes four main sections:

| Section | Purpose |
|---|---|
| Dashboard | Budget overview and spending activity |
| Expenses | Expense requests and approval workflows |
| Vendors | Approved recipient management |
| Settings | Spending policies and contract configuration |

The frontend integrates with Stellar through the Stellar JavaScript SDK and supports Freighter wallet connectivity.

---

## Technical Architecture

Steward is being developed as a hybrid system, combining on-chain financial enforcement with off-chain application intelligence.

| Component | Technology | Responsibility |
|---|---|---|
| Smart contract | Rust, Soroban | Spending policies, authorization, expense lifecycle |
| Blockchain | Stellar | Contract execution and future payment settlement |
| Frontend | Next.js, TypeScript, Tailwind CSS | Business dashboard |
| Wallet | Freighter | Wallet connection and transaction signing |
| Blockchain integration | Stellar SDK | Contract reads and transactions |
| AI backend (planned) | Python, Agno, Gemini | Invoice processing and autonomous expense workflows |
| Database (planned) | PostgreSQL | Business data, documents, and operational history |
| Payments (planned) | Stellar USDC, x402 | Authorized payments and digital-service purchases |

### Current Architecture

```text
         Steward Web Dashboard
                   |
              Freighter
                   |
             Stellar SDK
                   |
                   v
          Stellar Blockchain
                   |
             Soroban Contract
                   |
       +-----------+-----------+
       |           |           |
     Budget      Vendor      Expense
     Policies    Controls    Management
```

### Future Architecture

```text
             Business Owner
                   |
                   v
             Steward Platform
                   |
          +--------+--------+
          |                 |
      AI Agent         Web Dashboard
          |                 |
          +--------+--------+
                   |
          Spending Authorization
                   |
                   v
           Soroban Contract
                   |
          Approved Payments
                   |
          +--------+--------+
          |                 |
     Stellar USDC         x402
          |                 |
       Vendors        Digital Services
```

The future architecture will ensure that AI agents cannot independently bypass financial policies when initiating payments.

---

## Current Development Status

Steward is currently a **working spending-policy MVP**, rather than a fully autonomous payment platform.

**Implemented**
- Soroban smart contract with spending controls
- Expense and vendor management logic
- Contract authorization and budget accounting
- Automated contract tests
- Deployment and invocation on Stellar Testnet
- Web dashboard with Stellar and Freighter integration

**In progress**
- End-to-end validation of frontend transactions
- Improvements to expense and vendor discovery

**Planned**
- AI-powered invoice and expense processing
- Autonomous expense proposals
- Real USDC transfers
- x402 payments for supported digital services
- Multi-business architecture
- Off-chain database and event indexing

At this stage, budget amounts represent spending commitments, not actual USDC held or transferred by the contract.

---

## Roadmap

### Phase 1 — Establish the Financial Control Layer

Build and validate the Soroban smart contract, spending policies, expense lifecycle, and connected dashboard.

This phase establishes the foundation for independently enforced financial permissions.

### Phase 2 — Introduce the AI Agent

Integrate an AI backend capable of understanding invoices, identifying vendors, and generating expense requests.

The agent will operate within the spending rules defined by the business owner.

### Phase 3 — Enable Real Payments

Extend the contract and supporting infrastructure to authorize and execute Stellar USDC payments.

This will turn approved expense requests into actual financial transactions while preserving spending controls.

### Phase 4 — Integrate x402

Allow Steward's AI agent to interact with x402-compatible services.

An agent could discover a paid API, receive a payment request, check its spending permissions, complete an authorized payment, and continue its task automatically.

This creates a practical use case for machine-to-machine commerce.

### Phase 5 — Build a Scalable Business Platform

Expand Steward to support multiple independent businesses through a shared platform architecture.

Move nonessential business data off-chain while keeping critical financial authorization and payment enforcement on Stellar.

Introduce more advanced reporting, transaction indexing, and financial automation workflows.

---

## Our Vision

We believe AI agents will increasingly become active participants in the economy.

They will purchase digital services, coordinate business operations, manage subscriptions, and execute financial tasks on behalf of individuals and organizations.

But autonomous spending cannot depend on trusting an AI model to always make the correct decision.

**Steward is building the financial boundaries that make autonomous spending practical.**

Our vision is a platform where businesses can delegate financial operations to intelligent agents while retaining enforceable control over budgets, permissions, and payments.

With Stellar providing the financial infrastructure and Soroban enforcing the rules, Steward aims to make autonomous business spending safer, more transparent, and more accessible.

---

**Steward — Give AI the ability to act, without giving it unlimited authority to spend.**