# ADR-0005: Ember SLI Is Tenant-Ready from Day One

**Status:** Proposed  
**Decision date:** 29 October 2026  
**Owners:** Ember product and architecture  
**Scope:** Tenancy model for Ember SLI (Solution Lifecycle Intelligence), its first deployment, and the path to offering it commercially  
**Related:** [ADR-0001](ADR-0001-dedicated-instance-first-deployment.md), [ADR-0002](ADR-0002-ember-sandz-as-a-domain-module.md), [ADR-0003](ADR-0003-source-hosting-and-zadara-deployment.md)

## Context

- SLI is being built first for Sandz, presented as **Ember Sandz**. Sandz may later offer it to other companies, so the product is named **Ember SLI** and its first deployment is the Vercel project **`ember-sli`**.
- ADR-0001 chose dedicated customer instances first, but required a **SaaS-ready architecture**: organisation identity explicit even when one deployment serves one customer.
- Ember today has **no native Organization record** (`docs/CURRENT-ARCHITECTURE.md`, "What's explicitly not built yet"). Several things are instance-wide: AI providers and models, branding, platform roles, the platform admin's access to everything, global knowledge base categories, MCP access allowlists.
- SLI builds on Ember Core features: Projects (the Discovery Project, department workspaces), Workstreams, knowledge bases, the assistant and evaluations (ADR-0002).
- No SLI tables exist yet, so adding a tenant now costs almost nothing. Adding one later, across tables with data, policies and functions, is expensive and risky.

## Decision

1. **Every SLI record belongs to a tenant from the start.** A new Core table, `organizations` (the tenant: name, slug, status, branding), is added. Every `sli_` table has `organization_id not null` referencing it. The tenant is part of unique keys (for example a Trigger code is unique per organisation) and of every index used for lookups.
2. **People belong to tenants.** `organization_members` links users to organisations with a tenant role (`owner`, `admin`, `member`). SLI department membership is per organisation. A person can belong to more than one organisation (for example a Sandz consultant helping a client).
3. **Access checks the tenant first.** Every SLI access helper (`sli_can_view_customer` and the rest) first checks that the caller is an active member of the record's organisation, then applies department and record rules. Writes go through functions that set `organization_id` from the caller's active organisation, never from client input.
4. **Ember Core objects used by SLI belong to the tenant.** The Discovery Project, department workspaces and their knowledge bases are created per organisation and carry `organization_id` (nullable on Core tables, so existing builder Projects are unaffected). Access to them still works through Project membership, which Ember already enforces.
5. **First deployment: one instance, one tenant.** `ember-sli` serves Sandz as its only organisation. Instance-wide settings (AI providers, branding, sensitivity limits) are Sandz's settings.
6. **Shared multi-tenant hosting is a later, separate decision.** Running several companies in one instance needs the work listed under "Before a shared instance", and is decided in its own ADR when a second customer is real. Until then, a second customer gets its own instance (ADR-0001), running the same tenant-ready code.

## Considered options

| Option | Assessment |
|---|---|
| Single-tenant SLI tables, add tenancy later | Cheapest today. Retrofitting `organization_id`, policies, functions and data later is expensive and easy to get wrong |
| **Tenant-ready SLI, one tenant per instance for now** | **Selected.** Small cost now; keeps both dedicated instances and a later shared SaaS edition open |
| Fully multi-tenant now, including Ember Core | Correct for SaaS, but means reworking Core's instance-wide settings, platform admin access and retrieval functions before Sandz has used SLI at all |

## Before a shared instance

A later ADR must cover at least:

- **Platform admin vs tenant admin:** today's platform admin sees everything. A shared instance needs a tenant admin role, and operator access to tenant data that is explicit, limited and logged.
- **Tenant-scoped settings:** AI providers and keys, sensitivity limits, branding, Tavily and other service keys, email sender.
- **Tenant-scoped Core data:** knowledge bases, Wiki categories, evaluation datasets, Methods, MCP access allowlists, storage paths.
- **Retrieval:** search functions (`match_documents`, `match_wiki_vectors` and Project search) filtered by tenant as well as by Project.
- **Metering and billing per tenant**, building on Ember's metering.
- **Tenant export and deletion**, for offboarding and Data Privacy Act requests.
- **Behavioural cross-tenant tests:** every SLI and Core table tested on PGlite to prove one tenant cannot read or write another's data.

## Consequences

### Positive

- Sandz's data is tenant-scoped from its first row, so a later move to a shared instance needs no data reshaping.
- The same code serves dedicated instances and a possible SaaS edition.
- A person working across two companies is modelled correctly from the start.

### Negative

- Every SLI table, function and policy carries a tenant column and check, and tests must cover it.
- Until the shared-instance work is done, "multi-tenant" means "tenant-ready". The product must not be sold as a shared SaaS before then.

## Effect on the existing designs

The Discovery, customer registry and knowledge foundation designs add `organization_id` to every `sli_` table, and their access helpers check organisation membership first. The setup scripts create the Sandz organisation and its members. These changes are made when each stage is built.
