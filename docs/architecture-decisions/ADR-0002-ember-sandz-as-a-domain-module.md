# ADR-0002: Build Ember Sandz as a Domain Module in the Ember Codebase

**Status:** Proposed  
**Decision date:** 23 October 2026  
**Owners:** Ember product and architecture  
**Scope:** Code organisation, deployment and data boundaries for Ember Sandz (Solution Lifecycle Intelligence)  
**Related:** [ADR-0001](ADR-0001-dedicated-instance-first-deployment.md), [Ember Sandz concept paper v0.1](../ember-sandz/Ember_Sandz_Development_Concept_v0.1.md), [S1 codebase assessment](../ember-sandz/S1-EMBER-CODEBASE-ASSESSMENT.md)

## Decision

Ember Sandz will be built **inside this repository** as a domain module: its own service layer, routes, migrations and tests, sharing Ember's identity, authorization, knowledge, retrieval, assistant, evaluation and governance services. It will **not** be a separate `ember-sandz` repository or long-lived fork.

Sandz is delivered as a **dedicated instance** of the same product, per ADR-0001, with the lifecycle module switched on by configuration. Other Ember deployments run the same code with the module off.

This decision can be summarized as:

> One codebase, one schema history; Sandz is an edition enabled by configuration and deployed as its own instance.

This resolves the concept paper's first open decision ("Separate Ember Sandz instance or initially shared deployment?"): separate instance, shared codebase.

## Context

The concept paper (§4) recommends creating an `ember-sandz` repository from the existing Ember application and extracting reusable services incrementally.

Three facts weigh against that:

1. **ADR-0001 already rejects customer forks.** It selects "one product with dedicated customer instances" and rejects "independently customised product for every customer" because forks make upgrades, security patches, migrations and support progressively harder. A Sandz repository would be exactly that fork, created on day one.
2. **Ember is changing quickly in the areas Sandz depends on.** In October 2026 alone, migrations landed for solution requirements, verification, baselines, re-verification, Ember-drafted requirements, shared sessions, knowledge-gap detection and builder rules. Every one of those touches RLS helpers, the assistant loop or the AI policy gate. A fork would have to re-port each change or fall behind on security fixes.
3. **The intended product is Ember with a new personality, not a different product.** The lifecycle capabilities Sandz needs most in its later stages (requirements, verification, baselines, re-verification) were built in Ember and are generic. Keeping them in one codebase lets both editions improve them.

The concept paper's other architectural recommendation, a modular monolith rather than microservices, is retained.

## Decision drivers

- One security and RLS model, reviewed and fixed once.
- Reuse of the Ember assistant, retrieval, evidence access, sensitivity gate and MCP server without copying.
- Clear separation between operational records (Sandz) and approved knowledge (Ember Core), as the concept paper requires.
- No impact on existing Ember deployments when the module is off.
- A path to offering lifecycle intelligence to other customers later without merging two codebases.

## Considered options

### Option 1: Separate `ember-sandz` repository (concept paper §4)

**Advantages**

- Freedom to change shared code without considering other deployments.
- Simple mental model for a Sandz-only team.

**Disadvantages**

- Contradicts ADR-0001.
- Two schema histories that diverge from the first new migration; ports become manual merges.
- Security and RLS fixes must be applied twice.
- Commercialising Sandz later means re-merging or maintaining two products.

Rejected.

### Option 2: Shared deployment with Sandz data in the existing Ember instance

**Advantages**

- No new infrastructure.

**Disadvantages**

- Mixes Sandz customer and commercial records with the builder programme's client Projects and knowledge.
- Ember has no native Organization or tenant boundary yet (`docs/CURRENT-ARCHITECTURE.md`, "What's explicitly not built yet"), so isolation would rest entirely on new RLS.

Rejected for production. Acceptable for a non-production demo with synthetic data only.

### Option 3: Domain module in this repository, dedicated Sandz instance

**Advantages**

- Consistent with ADR-0001.
- Shared services are used directly, not extracted first.
- Ember Core improvements reach Sandz automatically.
- The module is generic enough to ship to future customers.

**Disadvantages**

- Shared migrations run on every deployment, including those that leave the module off.
- Contributors must keep the module boundary disciplined.
- Feature-flag and navigation logic grows.

Selected.

## Required architectural consequences

### Code layout

- Service layer under `src/lib/sli/` (customers, contacts, campaigns, activities, leads, handoffs, solutions, assets, service cases). Server Actions and pages call these services; assistant and MCP tools call the same services, following the existing rule "one authorization model, enforced once" (`src/lib/mcp/tools.ts`).
- Routes in their own segment under `src/app/(app)/` (for example `customers/`, `marketing/`), hidden from navigation when the module is off.
- Ember Core code must not import from `src/lib/sli/`. Sandz may call Core services. Where Sandz needs Core to know about Sandz records (for example, a knowledge reference pointing at a lead), Core exposes a generic reference type rather than importing Sandz types.

### Configuration

- An environment switch in `src/lib/env.ts` alongside existing ones such as `mcpEnabled()` (for example `EMBER_SLI_ENABLED`) controls routes, navigation, assistant tools and MCP tools.
- Department names, campaign types, telemarketing outcomes and similar vocabularies are data (seeded per instance), not code, so another customer can configure them without a branch.

### Database

- Sandz tables live in the shared migration sequence under `supabase/migrations/`, with a recognisable prefix (`sli_`) or naming convention, and are created on every deployment.
- Tables are inert when the module is off: no triggers fire on Core tables, and Core RLS is unchanged.
- The customer entity is named `customers` (or `accounts`), **not** `organizations`. "Organization" is reserved for the future tenant record that ADR-0001 and the Platform backlog describe.
- New `SECURITY DEFINER` helpers follow the existing pattern (`is_project_member`, `can_curate_project`, `has_evidence_access`): platform-admin bypass built in, execute granted only as needed.

### Workflow

- Business state transitions use the established Ember pattern: a status column, a history table, and `SECURITY DEFINER` transition functions that validate the caller and the transition (as in the Project status pipeline and `decide_solution_conformance_decision()`).
- LangGraph (`src/lib/graph/`) remains for AI orchestration and is not used to hold business workflow state.

### Relationship to Ember Projects

- Customers, contacts, solutions and installed assets persist outside any Ember Project.
- A delivery engagement, presales pursuit or maintenance contract may **link** to an Ember Project to gain its workspace, knowledge bases, workstreams and solution requirements. The Project is a workspace for that engagement, not the customer record.

## Consequences

### Positive

- Sandz inherits RLS, evidence access, the sensitivity gate, assistant provenance and MCP auditing without re-implementation.
- Presales, Delivery and Maintenance can build on the existing solution requirements, verification, baseline and re-verification model.
- Ember remains one product with one upgrade path.

### Negative

- Every deployment carries Sandz tables even when unused.
- Module boundaries must be enforced by review (and, if needed, a lint rule), not by repository separation.
- Ember Core changes must now consider Sandz consumers.

## Open questions

- Should module boundaries be enforced mechanically (an ESLint `no-restricted-imports` rule from Core to `src/lib/sli/`)?
- Is a single environment switch enough, or should individual departments (Marketing, Sales, Presales, Delivery, Maintenance) be switchable per instance?
- Where does the Organization Home Project fit for Sandz staff accounts?

## Review triggers

Revisit this decision if:

- Sandz requirements diverge so far from Ember Core that most shared code becomes conditional on the module;
- a second customer requires lifecycle modules with incompatible behaviour that cannot be expressed as configuration;
- a shared multi-tenant SaaS edition is pursued, which would require the Organization boundary first.
