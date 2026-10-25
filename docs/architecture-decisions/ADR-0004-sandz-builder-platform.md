# ADR-0004: Sandz Builder Platform

**Status:** Proposed  
**Decision date:** 25 October 2026  
**Owners:** Ember product and architecture  
**Scope:** How internal and external builders develop and deploy their own apps on Sandz infrastructure, using shared services  
**Related:** [ADR-0001](ADR-0001-dedicated-instance-first-deployment.md), [ADR-0002](ADR-0002-ember-sandz-as-a-domain-module.md), [ADR-0003](ADR-0003-source-hosting-and-zadara-deployment.md)

## Context

Sandz intends to grow a **builder community**. Internal builders (Sandz staff) and external builders (partners and schools) will develop apps and deploy them on Sandz's Zadara infrastructure. Their apps will use shared modules that Sandz provides: Supabase, AI model calls, speech-to-text, web search and other tools.

The first two Sandz apps are both built from the Ember codebase (ADR-0002):

1. **Sandz SLI** (first): internal, holds customer and commercial records.
2. **Sandz Builders** (second): Ember's builder programme, for agencies and builders.

Ember's builder programme already covers much of the organisational side of a builder community (`docs/CURRENT-ARCHITECTURE.md`, "Builders and agencies"):

| Need | What Ember has |
|---|---|
| Builders and the agencies that supervise them | Platform roles (consultant = builder, curator = agency), `agency_builders` rosters, `/agency` supervision |
| A place to start work | A `builder_lab` workspace Project per builder, with a workstream limit |
| Approval before work becomes real | Project creation approval; workstream promotion to a client Project, decided by the builder's agency |
| AI usage control | Per-builder metering against monthly allowances and credit grants (`src/lib/ai/metering.ts`), agency-set budgets, bring-your-own LLM credentials |
| Commercial terms | Who found the client, and the fee split (`client_project_fees`) |
| Reviewing third-party capabilities | External agent registry with certification status and capability evaluations; builder-integrations registry |
| Calling external tools safely | MCP gateway with propose-confirm-execute, risk and spending checks, audited invocations |
| AI policy | Provider abstraction, sensitivity gate (`src/lib/ai/sensitivity.ts`), self-hosted provider support |

What Ember does not have is the **hosting** side. Today a builder's work lives inside Ember (workstreams, knowledge, proposals). In this platform a builder's output is a separate app with its own code, database and deployment.

## Decision

The platform has three parts, delivered in phases. This ADR fixes the boundaries and the order; each phase gets its own design before it is built.

### 1. Builders portal: the Sandz Builders instance

The Sandz Builders instance of Ember (ADR-0002) is the portal. It keeps its current role (agencies, builders, approval, promotion, metering, fees) and gains an **App** record: what a builder's app is, who owns it, which agency supervises it, its lifecycle stage, its resources and its keys to shared services.

Approving or promoting an app in the portal is what triggers provisioning. Provisioning starts as an ops runbook and becomes automation as volume grows.

### 2. Shared-services gateway

Apps reach shared capabilities through one gateway, with a key per app issued by the portal. Apps never hold provider keys.

| Capability | Built from | Interface for builders |
|---|---|---|
| Chat and embeddings | `src/lib/ai/` provider abstraction, model registry, self-hosted providers | OpenAI-compatible endpoints, so builders use standard SDKs |
| Speech-to-text | New provider type in the same abstraction (cloud provider, or self-hosted on Zadara GPU) | Whisper-compatible transcription endpoint |
| Web search | Ember's Tavily integration (`src/lib/chat/web-search-tool.ts`) | Search endpoint, if offered to builders (open decision) |
| External tools | MCP gateway (`src/lib/mcp-gateway/`), builder-integrations registry | Gateway-mediated tool calls with the same propose-confirm rules for writes |
| Usage control | `src/lib/ai/metering.ts`, agency budgets | Per-app, per-builder and per-agency quotas; usage visible in the portal |
| Policy | Sensitivity gate, provider maximum sensitivity | Each app declares its data sensitivity; the gateway refuses ineligible providers |

**First implementation:** API routes inside the Builders instance (for example `/api/v1/...`), reusing Ember's code directly, in line with the modular-monolith approach. Extract it into its own service when load, availability or release cadence require it. Until then the Builders instance is a runtime dependency for every community app, and must be monitored and backed up as one.

### 3. Community zone: where builders' apps run

Builders' apps run in a **community zone** separate from the Sandz internal zone (ADR-0003):

- **Separate VMs and network segment.** Code written by partners and students is untrusted. It never runs on the VMs, or reaches the network, that hold SLI data.
- **One container per app** with CPU and memory limits, built from a GitLab CI template that Sandz provides.
- **Data tiers by lifecycle stage:**

  | Stage | Data | Rule |
  |---|---|---|
  | **Sandbox** (learning, prototypes) | A shared Supabase stack per agency or cohort (for example one per school class), with a schema per app | No real personal data. Cheap: one stack serves many apps. |
  | **Pilot** | As sandbox, or a dedicated stack when the app handles real users | Agency approval |
  | **Production** | A dedicated Supabase stack per app | Promotion approved by the agency; app review passed (below) |

  A stack per app for every sandbox would not scale: each stack uses about 2–3 GB of RAM when idle. Promotion between stages maps onto the workstream promotion Ember already has.
- **Container platform.** Docker Compose is enough for the first internal apps. A lightweight Kubernetes distribution (such as k3s) or a similar scheduler becomes worthwhile once external builders deploy on their own. Decide when phase B3 is designed.

### App review before production

An app reaches production only after a review: security basics (dependencies, secrets, authentication, RLS on its tables), data handling, and its use of shared services. Ember's capability evaluations and certification status for external agents are the model to extend for app review.

## Phases

| Phase | Delivers | Users |
|---|---|---|
| **B0** | Sandz SLI in the internal zone (ADR-0002, ADR-0003) | Sandz staff |
| **B1** | Sandz Builders instance live with Ember's current builder programme: workspaces, proposals, knowledge, agencies, metering. No app hosting. | Internal builders |
| **B2** | App record in the portal; GitLab app template and CI; community zone VMs; ops-provisioned Supabase (sandbox stack and dedicated stacks); gateway v1 (chat, embeddings, speech-to-text, optionally web search) | Internal builders |
| **B3** | External builders: onboarding and agreements, self-service provisioning, quotas, app review, abuse controls, container platform | Partners, then schools |
| **B4** | Community: catalogue of apps and connectors, showcase, shared templates | Everyone |

Each phase starts only when the previous one is in use. B2 is sized and designed after B1 shows what internal builders actually build.

## Consequences

### Positive

- Most of the organisational machinery (agencies, approval, promotion, metering, fees, certification) already exists and is reused rather than rebuilt.
- One gateway keeps provider keys, policy and metering in one place, and lets Sandz change providers (for example moving speech-to-text to a self-hosted model) without changing apps.
- The internal zone and SLI data stay isolated from external builders' code by infrastructure, not only by policy.

### Negative

- Sandz becomes an app-hosting operator for third parties: capacity, abuse, support and incident response for code it did not write.
- The Builders instance becomes critical infrastructure once the gateway runs inside it.
- Schools bring additional obligations: students may be minors, and personal data processed by student apps falls under the Philippine Data Privacy Act. Sandbox stages must forbid real personal data, and onboarding for schools needs legal review before B3.

## Open decisions

- Is Tavily offered to builders through the gateway, and on what quota? Each search has a per-call cost, so it needs per-app metering if offered. (Tavily for SLI is decided separately: ADR-0002, "Web search".)
- Speech-to-text provider: cloud, or self-hosted on Zadara GPU? This also decides whether audio leaves Sandz infrastructure.
- Sandbox data model: shared stack per agency or per cohort, schema per app (proposed), or another arrangement?
- Where builders' code lives: a GitLab group per agency on Sandz's GitLab, or builders' own repositories with Sandz CI templates?
- Domain scheme for community apps (for example `<app>.<agency>.apps.<domain>`).
- Single sign-on: one builder identity across the portal, GitLab and their apps?
- Service levels for community apps compared with Sandz's own apps.
- Fees and billing for external builders' hosting and shared-service use, building on `client_project_fees`.

## Review triggers

- Phase B1 shows builders need something other than app hosting first.
- Gateway load or availability needs exceed what the Builders instance can provide.
- A partner or school requires dedicated infrastructure or data residency beyond the community zone.
