# ADR-0003: Move Source Hosting to GitLab and Production Hosting to Zadara

**Status:** Proposed  
**Decision date:** 23 October 2026  
**Owners:** Ember product and architecture  
**Scope:** Source repository, CI, application hosting, Supabase hosting and VM topology for Ember, Ember Sandz and future Supabase-based apps  
**Related:** [ADR-0001](ADR-0001-dedicated-instance-first-deployment.md), [ADR-0002](ADR-0002-ember-sandz-as-a-domain-module.md), [Moving guide](../guides/moving-to-gitlab-and-zadara.md), [Zadara resource request](../Deployment/zadara-resource-request.md), [Ember on self-hosted Supabase](../guides/ember-on-self-hosted-supabase.md)

## Decision

1. **Source and CI move from GitHub to GitLab.** The existing `ember` repository moves with its full history. It is not replaced by a new Ember Sandz repository (ADR-0002). GitHub stays as a read-only mirror during the overlap and is then **archived, not deleted**.
2. **Hosting moves from Vercel and Supabase Cloud to Zadara zCompute** (Philippines), in three separate phases: source first, then Supabase, then the application. Each phase can be rolled back on its own and none waits for Ember Sandz work.
3. **Zadara hosting uses separate tiers:**
   - an **app tier** (reverse proxy plus application containers),
   - a **data tier** (Supabase stacks),
   - a small **ops tier** (monitoring, CI runner, backup checks).

   Lab runs everything on one VM. Production keeps the tiers on separate VMs.
4. **Each app gets its own Supabase stack in each environment.** Future apps do not share Ember's Supabase stack. Several stacks may share one data-tier VM.
5. **AI inference stays outside this topology.** It runs on external providers, or on a separately sized GPU host if one is added later. It is not part of the app or data VM sizing.

## Context

- Ember is on GitHub (`mikeA911/ember`), deployed by Vercel's GitHub integration in region `sin1`, with Supabase Cloud. `docs/guides/ember-on-self-hosted-supabase.md` already plans the move of Supabase to Zadara VMs (`sandz-ember-lab`, `sandz-ember-prod`), with the app staying on Vercel.
- The organisation intends to standardise on GitLab and on its own Zadara infrastructure. Future internal apps will also use Supabase.
- Coupling to the current platforms is small:
  - There is no `.github/` directory, so no GitHub Actions to port.
  - `vercel.json` holds one cron (`/api/cron/presentations`, every 15 minutes, `Authorization: Bearer <CRON_SECRET>`) and the region.
  - `src/lib/chat/feedback-tool.ts` reads `VERCEL_ENV` with a `NODE_ENV` fallback.
  - `next.config.ts` already supports a self-hosted Supabase Storage URL.
  - `next build` succeeds without environment variables, and lint, typecheck and the full Vitest suite need no database. CI can therefore run on any runner.
- ADR-0001 requires one versioned product, immutable release artifacts and a recorded version per installation. `docs/Deployment/ManagingMultipleClientDeployments.md` requires short-lived branches, tagged releases and shared migrations.

## Decision drivers

- Keep one product codebase and one migration history (ADR-0001, ADR-0002).
- Change one platform at a time so a failure has one cause and one rollback.
- Keep Supabase data isolated per app, since each Supabase stack is one Auth user pool and one Postgres database.
- Let the data tier be patched, backed up and resized without redeploying apps, and the reverse.
- Size for the Ember and Ember Sandz pilot now, with a clear path for two or three more apps.

## Considered options

### Source hosting

| Option | Assessment |
|---|---|
| Stay on GitHub | Works today, but conflicts with the organisation's direction and keeps two places to manage access. |
| **GitLab.com (SaaS)** | **Selected for the move.** Least operational work, built-in CI and container registry, GitHub importer for issues and PRs. A self-hosted runner on the ops VM can deploy into Zadara's private network. |
| Self-managed GitLab on Zadara | Possible later if data residency requires it. Not part of this move: running GitLab is a sizeable service in itself (8 GB RAM minimum) and would add to an infrastructure change already in flight. |

### Supabase for multiple apps

| Option | Assessment |
|---|---|
| One shared Supabase stack for all apps | Rejected. All apps would share one `auth.users` pool, one `public` schema and one migration history. Upgrades and restores would affect every app, and one app's RLS defect could expose another's data. This conflicts with ADR-0001's isolation rules. |
| **One stack per app per environment, several stacks per data VM** | **Selected.** Data, users, keys, backups and upgrades are isolated per app. Each stack adds about 2–3 GB of RAM when idle, which is affordable. |
| One VM per stack | Strongest isolation but the most VMs to patch. Use it for a stack that outgrows a shared data VM, or when a client requires dedicated hardware. |

Apps that genuinely need shared sign-in should solve it with an identity provider (SAML or OIDC into each stack's Auth), not by sharing a stack.

### VM layout

| Option | Assessment |
|---|---|
| Everything on one VM | Fine for **lab**. For production it ties app deploys, Postgres memory and patching together. |
| **App tier, data tier, ops tier** | **Selected for production.** It matches how the parts scale: apps are stateless and scale on CPU, Postgres needs memory, ops needs little. |
| Kubernetes | Not justified at this scale. Docker Compose on each VM, deployed by GitLab CI, is enough until high availability is required (`DeploymentServerOptions.md`, "Availability profiles"). |

## Target topology

```text
                       Internet
                          │ HTTPS :443 (only public entry)
                ┌─────────▼──────────────────────────┐
                │ prod-app-01  (app tier)            │
                │  Caddy: TLS, routing, timeouts     │
                │   ├─ ember.<domain>   → Ember      │
                │   ├─ <app2>.<domain>  → App 2      │
                │   └─ api.*.<domain>   → data tier  │
                │  Cron: curl /api/cron/... (15 min) │
                └─────────┬──────────────────────────┘
                          │ private network
                ┌─────────▼──────────────────────────┐
                │ prod-data-01  (data tier)          │
                │  Supabase stack: ember-prod  :8000 │
                │  Supabase stack: app2-prod   :8001 │
                │  (no public IP)                    │
                └─────────┬──────────────────────────┘
                          │                       Zadara S3:
                ┌─────────▼──────────┐            storage buckets (versioned),
                │ prod-ops-01        │──────────▶ database dumps
                │  monitoring, logs, │
                │  GitLab runner,    │
                │  backup checks     │
                └────────────────────┘

lab-01: Caddy + app containers + lab Supabase stacks on one VM.
```

Browsers call Supabase Auth directly (sign-in, password reset), so each stack's API needs a public HTTPS name. In this topology Caddy on the app VM proxies `api.<app>.<domain>` to the data VM over the private network, and the data VM needs no public IP. This differs from `ember-on-self-hosted-supabase.md`, where Caddy runs on the Supabase VM. That arrangement remains correct while the app is still on Vercel (Phase 2), and moves to the app VM in Phase 3.

## What "common functions" means here

Shared **infrastructure** goes on the ops and app tiers: the reverse proxy and TLS, monitoring and alerting, log collection, the CI runner, backup checks, and the container registry (GitLab's).

Shared **application code** (UI components, auth helpers, the AI provider layer) should become versioned packages or a template that each app builds in. It should not become a shared runtime service on its own VM. A shared service would be a new single point of failure and a new cross-app security boundary.

## Required consequences

### Phase 1: source (GitLab)

- Import the repository, issues and pull requests. Protect `main`; merge requests require a green pipeline.
- Run `.gitlab-ci.yml` (lint, typecheck, test, build) on every merge request and on `main`.
- Reconnect Vercel to the GitLab project. Hosting is unchanged.
- Push-mirror GitLab to GitHub during the overlap. Archive GitHub after at least two weeks of clean pipelines and deploys from GitLab.
- Tag the last GitHub-era commit, and from then on tag every production release (ADR-0001).

### Phase 2: Supabase on Zadara

- Follow `docs/guides/ember-on-self-hosted-supabase.md` and the per-client stack runbook. Sizing in [the resource request](../Deployment/zadara-resource-request.md) replaces that guide's single-stack VM table for the data tier.

### Phase 3: application on Zadara

- Add a production container build (Next.js `output: 'standalone'`, Node 22) and push images to the GitLab registry, tagged with the release version and commit.
- Replace the Vercel cron with a scheduled call carrying `CRON_SECRET` on the app VM.
- Set reverse-proxy timeouts to at least 180 seconds and the request body limit to at least 6 MB. Routes declare `maxDuration` up to 120 seconds, and Server Actions accept 6 MB bodies (`next.config.ts`).
- Replace `VERCEL_ENV` with a platform-neutral variable (`APP_ENV`), keeping the fallback.
- Confirm outbound access from Zadara Philippines to every configured AI provider before cut-over. The `hkg1` incident in `ember-on-self-hosted-supabase.md` §9 shows that provider region restrictions break embedding and search.
- Keep Vercel deployable until the Zadara app has run cleanly for two weeks. DNS is the rollback switch.

## Consequences

### Positive

- One organisation-standard platform for source, CI and hosting.
- Data stays on Zadara infrastructure in the Philippines.
- Per-app Supabase stacks isolate users, data, upgrades and restores.
- Tiers scale and are maintained independently.
- Each phase is small and reversible.

### Negative

- The team now operates Postgres, Supabase upgrades, TLS, backups and monitoring that Vercel and Supabase Cloud handled.
- No high availability at first. A VM failure means restoring from backups within the documented recovery time.
- Preview deployments per merge request, which Vercel provided, are lost when Vercel is retired unless CI recreates them on lab.
- Claude Code cloud sessions and PR monitoring used in this project are wired to GitHub today. Check GitLab support before archiving GitHub if that workflow is still needed. The Claude Code CLI works with any git remote.

## Open questions

- GitLab.com or self-managed GitLab long term (data residency, cost)?
- Domain names and TLS certificate approach (ACME through Caddy, or organisation certificates)?
- Recovery objectives (RPO and RTO) for production. These decide whether a standby data VM is needed in year one.
- Does Zadara offer volume snapshots and private networking between VMs in the target zone? The topology assumes both.
- Will a self-hosted LLM run on Zadara GPU capacity, and on what timeline?

## Review triggers

- A production app needs high availability or zero-downtime upgrades.
- The data VM passes about 70% sustained memory use, or a single stack's vector index no longer fits in memory.
- More than four apps, or a client requiring dedicated hardware.
