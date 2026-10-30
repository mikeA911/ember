# ADR-0002: Build Ember Sandz as a Domain Module in the Ember Codebase

**Status:** Proposed  
**Decision date:** 23 October 2026  
**Owners:** Ember product and architecture  
**Scope:** Code organisation, deployment and data boundaries for Ember Sandz (Solution Lifecycle Intelligence)  
**Related:** [ADR-0001](ADR-0001-dedicated-instance-first-deployment.md), [ADR-0004](ADR-0004-sandz-builder-platform.md), [Ember Sandz concept paper v0.1](../ember-sandz/Ember_Sandz_Development_Concept_v0.1.md), [S1 codebase assessment](../ember-sandz/S1-EMBER-CODEBASE-ASSESSMENT.md)

## Decision

Ember Sandz will be built **inside this repository** as a domain module: its own service layer, routes, migrations and tests, sharing Ember's identity, authorization, knowledge, retrieval, assistant, evaluation and governance services. It will **not** be a separate `ember-sandz` repository or long-lived fork.

Sandz is delivered as a **dedicated instance** of the same product, per ADR-0001, with the lifecycle module switched on by configuration. Other Ember deployments run the same code with the module off.

This decision can be summarized as:

> One codebase, one schema history; Sandz is an edition enabled by configuration and deployed as its own instance.

This resolves the concept paper's first open decision ("Separate Ember Sandz instance or initially shared deployment?"): separate instance, shared codebase.

### Two Sandz instances: SLI and Builders

Sandz will run **two instances** of the same codebase, each with its own Supabase stack and its own user pool:

| Instance | Users | Modules on | Order |
|---|---|---|---|
| **Sandz SLI** | Sandz staff | SLI, knowledge, assistant | First |
| **Sandz Builders** | Agencies and builders: Sandz staff, partners, schools | Ember's builder programme (agencies, approval, promotion, metering, fees) | Later |

They are not combined in one instance because SLI holds Sandz customer and commercial records, and Builders admits external users. In a shared instance, row-level security would be the only barrier between a partner or student account and Sandz's sales pipeline. Separate instances make that boundary infrastructure, not a policy bug away. Sandz staff who also build apps hold an account on each until single sign-on is added.

The Builders instance is the starting point for the Sandz builder platform described in [ADR-0004](ADR-0004-sandz-builder-platform.md).

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

### Discovery and the SLI shell

Added 26 October 2026, with [the Discovery design](../dev-request-sandz-sli-discovery-and-triggers.md):

- **Discovery is part of the SLI module**, as its first stage. Its records are "Triggers" (a management idea, market event, customer problem and so on), so "opportunity" stays free for Sales.
- **Name:** the module is presented as **Ember Sandz**, with **Solution Lifecycle Intelligence** as its byline, and the assistant keeps the name Ember. Because SLI may later be sold to other customers, names and vocabularies are instance configuration and data.
- **UI per audience.** Ember Core's UI was built for builders and app developers, and Sandz staff found its terms confusing. The Builders instance uses Ember Core's UI. Discovery and Marketing get purpose-built screens in business language; later SLI stages may reuse Core screens where they suit a technical audience. A chat-first calm workspace is proposed for the purpose-built screens ([design note](../design-notes/ember-sli-calm-workspace.md)).
- **SLI users see an SLI shell only.** On an SLI instance, users whose access comes through SLI departments get SLI navigation (Home, Discovery, and later Customers, Marketing, Sales). Ember features such as Workstreams, Methods and the assistant are used underneath and presented in SLI terms. Core routes are not linked, and opening one sends an SLI-only user back to SLI Home. Platform admins and knowledge curators keep the full Ember navigation.
- **One handoff mechanism for the whole lifecycle.** Moving work between stages uses one design with three kinds: promote (forward), return (refused before acceptance) and send back (reopened after acceptance). Discovery builds it first, and later stages reuse it.

### Assistant and MCP tools: framework in Core, tools in modules

Ember has three MCP-related parts. Each splits differently:

| Part | Today | Stays in Core | Moves to modules |
|---|---|---|---|
| **External MCP server** (`/api/mcp`, `src/lib/mcp/server.ts`, `access.ts`, `consent.ts`, `sensitivity.ts`) | One server, one static read-only allowlist in `external-tools.ts`, instructions describing "an AI engineering workbench" | OAuth, allowlists, rate limits, call logging, the database-level read-only policies, sensitivity ceilings | The tool list and the server instructions. Each module contributes its own read-only tools (for example `get_customer_summary` from SLI), registered only when the module is on. Core keeps its knowledge and Project tools. |
| **Internal tool registry** (`src/lib/mcp/tools.ts`, plus tools intercepted in `src/lib/chat/loop.ts`) | One file mixing Project, Workstream, Wiki and builder tools | The registry, dispatch and the rule "one authorization model, enforced once" | Module tools, in the same way |
| **MCP gateway** (`src/lib/mcp-gateway/`: outbound calls to registered external MCP servers, propose-confirm-execute, risk, spending, credentials) | Core | All of it, except demo-specific code: `orderlunch-confirmation.ts` belongs with its demo, not in Core | — |

So the answer to "should MCP move to the modules?" is: the **server and gateway machinery stays in Core**, because every instance needs the same authentication, audit and read-only guarantees. The **tools move to the modules that own the data**. A module's external tools still live in their own allowlist file, so a write tool can never become externally reachable by accident, which is the reason `external-tools.ts` is separate from `tools.ts` today.

For the builder platform, the MCP gateway and Tavily web search are also candidates for the shared-services gateway in ADR-0004, where apps other than Ember would call them.

### Web search (Tavily)

Ember's `search_web` tool already uses Tavily (`src/lib/chat/web-search-tool.ts`, `TAVILY_API_KEY`). It is outside the sensitivity gate, so the tool restricts queries to public names and topics (`WEB_QUERY_RULE`), and results are never citable evidence until a curator approves a research dossier.

For Sandz SLI, enabling it is a configuration decision. Before enabling it, Marketing and Sales should agree whether prospect and customer **company names** may appear in queries (the current rule allows company names), since those queries leave Sandz for Tavily. Contact names and deal details are already excluded by the rule.

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
- The builder programme is on in every deployment today ("one product configuration", `docs/CURRENT-ARCHITECTURE.md`). The SLI instance needs it off: no `builder_lab` workspace provisioning, metering or fees. Does that become a module switch like SLI's?
- Single sign-on between the SLI and Builders instances: which identity provider, and when?

## Review triggers

Revisit this decision if:

- Sandz requirements diverge so far from Ember Core that most shared code becomes conditional on the module;
- a second customer requires lifecycle modules with incompatible behaviour that cannot be expressed as configuration;
- a shared multi-tenant SaaS edition is pursued, which would require the Organization boundary first.
