# ADR-0003: Move Supabase and Hosting to Zadara, and Source Hosting to GitLab

**Status:** Proposed  
**Decision date:** 23 October 2026 (revised 25 October 2026: Supabase first, clean install, shared services)  
**Owners:** Ember product and architecture  
**Scope:** Supabase hosting, application hosting, source repository, CI and VM topology for the Sandz internal zone (Ember, Ember Sandz SLI and the Sandz Builders instance)  
**Related:** [ADR-0001](ADR-0001-dedicated-instance-first-deployment.md), [ADR-0002](ADR-0002-ember-sandz-as-a-domain-module.md), [ADR-0004](ADR-0004-sandz-builder-platform.md), [Moving guide](../guides/moving-to-gitlab-and-zadara.md), [Zadara resource request](../Deployment/zadara-resource-request.md), [Ember on self-hosted Supabase](../guides/ember-on-self-hosted-supabase.md)

## Decision

1. **Order of moves.** Five phases, each finished and stable before the next:
   1. **Supabase → Zadara, as a clean install.** New stacks get Ember's migrations and an admin account. Existing data is **not** copied. The app stays on Vercel and the code on GitHub.
   2. **App container preparation** on GitHub (Dockerfile, standalone build, cron replacement), tested on the lab VM by hand.
   3. **Source and CI → GitLab.** Vercel is reconnected to GitLab.
   4. **App hosting → Zadara**, deployed by GitLab CI.
   5. **Retire** Vercel, Supabase Cloud and GitHub (archived, not deleted).
2. **GitLab.com** hosts the moved `ember` repository with its full history. It is not replaced by a new Sandz repository (ADR-0002).
3. **Zadara hosting uses separate tiers** in production: an **app tier** (reverse proxy plus app containers), a **data tier** (Supabase stacks) and a small **ops tier** (monitoring, CI runner, backup checks). Lab runs everything on one VM.
4. **Each instance gets its own Supabase stack in each environment.** In the internal zone that means `sli-lab`, `sli-prod` now, and `builders-lab`, `builders-prod` when the Builders instance starts (ADR-0002). Several stacks may share one data VM. Apps built by the builder community follow the data tiers in ADR-0004, not this rule.
5. **Shared services are services, shared code is packages.** Paid or sensitive capabilities that many apps call (AI models, speech-to-text, web search, outbound MCP tools) are provided through a gateway service. UI components and helpers are shared as packages. See "Shared services and shared code" below.
6. **AI inference stays outside the VM sizing.** It runs on external providers or a separately sized GPU host.

## Context

- Ember is on GitHub (`mikeA911/ember`), deployed by Vercel's GitHub integration in region `sin1`, with Supabase Cloud. `docs/guides/ember-on-self-hosted-supabase.md` already plans moving Supabase to Zadara VMs with the app staying on Vercel.
- The current Supabase Cloud database holds test and demonstration data. Sandz wants a **clean copy** before the SLI module is added. This removes the data copy, the read-only window and most of the rollback risk from the Supabase phase.
- Claude Code cloud sessions, used to develop this project, clone, push and open pull requests only through GitHub. Moving the code last keeps that workflow available while the Supabase move and container preparation happen. See "Claude Code after the move" below.
- Coupling to the current platforms is small:
  - There is no `.github/` directory, so no GitHub Actions to port.
  - `vercel.json` holds one cron (`/api/cron/presentations`, every 15 minutes, `Authorization: Bearer <CRON_SECRET>`) and the region.
  - `src/lib/chat/feedback-tool.ts` reads `VERCEL_ENV` with a `NODE_ENV` fallback.
  - `next.config.ts` already supports a self-hosted Supabase Storage URL.
  - `next build` succeeds without environment variables, and lint, typecheck and the full Vitest suite need no database.
- Sandz intends to host a builder community (Sandz staff, partners, schools) that develops and deploys its own apps on Sandz infrastructure using shared services. That is ADR-0004. This ADR covers the internal zone that comes first.

## Decision drivers

- Keep one product codebase and one migration history (ADR-0001, ADR-0002).
- Change one platform at a time so a failure has one cause and one rollback.
- Move the data first, because data residency is the main business reason for the move.
- Keep Supabase data isolated per instance, since each stack is one user pool and one database.
- Avoid building the deployment pipeline twice (once for GitHub, once for GitLab).

## Considered options

### Order of moves

| Option | Assessment |
|---|---|
| GitHub → GitLab first (original revision of this ADR) | Low risk, but loses Claude Code cloud sessions before the migration work that they could help with. |
| **Supabase first, then code preparation, then GitLab, then app hosting** | **Selected.** Data moves first, code preparation uses the existing GitHub workflow, and the deployment pipeline is built once, on GitLab. |
| App to Zadara before GitLab | Rejected. The deployment pipeline would be written for GitHub and then rewritten for GitLab. |

### Data for the new stacks

| Option | Assessment |
|---|---|
| Copy Supabase Cloud data | Brings test and demonstration data into the Sandz environment. Needs a read-only window and a rollback deadline. |
| **Clean install** | **Selected.** Migrations plus one admin account. Product reference data that migrations seed (knowledge base definitions, AI provider entries, handbook release notes) is included; optional seed scripts are not run. |

### Source hosting

| Option | Assessment |
|---|---|
| Stay on GitHub | Conflicts with the organisation's direction. |
| **GitLab.com (SaaS)** | **Selected.** Least operational work, built-in CI and container registry, GitHub importer for issues and pull requests. A self-hosted runner on the ops VM deploys into Zadara's private network. |
| Self-managed GitLab on Zadara | Possible later if data residency requires it. Running GitLab is a sizeable service in itself (8 GB RAM minimum). |

### Supabase for multiple instances

| Option | Assessment |
|---|---|
| One shared Supabase stack | Rejected. One `auth.users` pool, one `public` schema and one migration history for every app. Upgrades and restores affect all of them, and one RLS defect could expose another app's data. |
| **One stack per instance per environment, several stacks per data VM** | **Selected** for the internal zone. Each stack adds about 2–3 GB of RAM when idle. |
| One VM per stack | For a stack that outgrows a shared VM, or a client requiring dedicated hardware. |

### VM layout

| Option | Assessment |
|---|---|
| Everything on one VM | Fine for lab. In production it ties app deploys, Postgres memory and patching together. |
| **App, data and ops tiers** | **Selected for production.** Apps are stateless and scale on CPU, Postgres needs memory, ops needs little. |
| Kubernetes | Not justified for the internal zone. It is likely to be justified for the community zone (ADR-0004). |

## Target topology (internal zone)

```text
                       Internet
                          │ HTTPS :443 (only public entry)
                ┌─────────▼──────────────────────────┐
                │ prod-app-01  (app tier)            │
                │  Caddy: TLS, routing, timeouts     │
                │   ├─ sli.<domain>       → SLI app  │
                │   ├─ builders.<domain>  → Builders │  (later)
                │   └─ api.*.<domain>     → data tier│
                │  Cron: curl /api/cron/... (15 min) │
                └─────────┬──────────────────────────┘
                          │ private network
                ┌─────────▼──────────────────────────┐
                │ prod-data-01  (data tier)          │
                │  Supabase stack: sli-prod      :8000│
                │  Supabase stack: builders-prod :8001│ (later)
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
Community zone (builders' own apps, shared-services gateway): separate VMs and network, ADR-0004.
```

Browsers call Supabase Auth directly (sign-in, password reset), so each stack's API needs a public HTTPS name. Once the app runs on Zadara (phase 4), Caddy on the app VM proxies `api.<app>.<domain>` to the data VM over the private network, and the data VM needs no public IP. During phases 1–3, while the app is still on Vercel, Caddy runs on the data VM as `ember-on-self-hosted-supabase.md` describes.

## Shared services and shared code

An earlier revision of this ADR said shared functions should be packages rather than shared runtime services. That holds for code, not for capabilities:

| Kind | Examples | How it is shared | Why |
|---|---|---|---|
| **Shared code** | UI components, Supabase client setup, auth helpers, design system | Versioned packages or an app template that each app builds in | No runtime coupling; each app upgrades on its own schedule |
| **Shared services** | AI model calls, speech-to-text, web search (Tavily), outbound MCP tools, email | A gateway service with per-app credentials | Provider keys stay in one place, usage is metered per app, builder and agency, policy (sensitivity, allowed providers) is enforced once, and providers can change without changing apps |
| **Shared infrastructure** | Reverse proxy and TLS, monitoring, logs, CI runner, backups, container registry | Ops and app tiers | Operated once for every app |

For the SLI phase, Ember calls its AI providers and Tavily directly, as today. The gateway is introduced with the builder platform (ADR-0004), built from Ember's existing provider abstraction, sensitivity gate, metering and MCP gateway.

## Required consequences

### Phase 1: Supabase on Zadara (clean install)

- Follow `docs/guides/ember-on-self-hosted-supabase.md` and the per-client stack runbook for the stacks, Storage, SMTP and backups. Skip that guide's §5 data move.
- Apply the migrations in order on lab first, then create the first admin account (`scripts/create-mike-admin.mjs` or an equivalent). Do not run the demonstration and test seed scripts.
- The migrations have never been applied in order to an empty database (the cloud project was built by hand). Expect some to fail; fix each as a corrected migration in the repository, never by editing the database by hand. Promote to `sli-prod` only once lab applies cleanly from empty.
- Review the migrations that insert rows (39 at the time of writing; most are backfills) for demonstration content before the first apply.
- Point Vercel's Preview environment at `sli-lab` and Production at `sli-prod`.

### Phase 2: app container preparation (on GitHub)

- Production container build (Next.js `output: 'standalone'`, Node 22), `.dockerignore`, `APP_ENV` in place of `VERCEL_ENV` (keeping the fallback), and a cron replacement script.
- Run the container by hand on `lab-01` against `sli-lab` to prove it. No automated deployment yet.

### Phase 3: source and CI on GitLab

- Import the repository, issues and pull requests. Protect `main`; merge requests require a green pipeline.
- Run `.gitlab-ci.yml` (lint, typecheck, test, build) on every merge request and on `main`.
- Reconnect Vercel to the GitLab project.
- Push-mirror GitLab to GitHub during the overlap.
- Tag the last GitHub-era commit, and from then on tag every production release (ADR-0001).

### Phase 4: application on Zadara

- Push images to the GitLab registry, tagged with release version and commit, and deploy with GitLab CI through the runner on `prod-ops-01`.
- Reverse-proxy timeouts of at least 180 seconds and a request body limit of at least 6 MB (`maxDuration` up to 120 seconds; 6 MB Server Action bodies in `next.config.ts`).
- Confirm outbound access from Zadara Philippines to every configured AI provider and to Tavily before cut-over (see the `hkg1` incident, `ember-on-self-hosted-supabase.md` §9).
- Keep Vercel deployable until the Zadara app has run cleanly for two weeks. DNS is the rollback switch.

### Phase 5: retire

- Delete the Vercel project and the Supabase Cloud project (after a final export), archive GitHub, and update `README.md` and `docs/CURRENT-ARCHITECTURE.md`.

## Claude Code after the move

Claude Code cloud sessions clone, push and open pull requests only through GitHub. A GitLab repository can be uploaded to a cloud session as a bundle, but the session cannot push back. Self-hosted cloud environments also check out from GitHub. After phase 3:

- **Main workflow:** Claude Code on developers' machines (terminal, IDE extensions, or the Desktop app in Local mode), with `glab` for merge requests and pipelines.
- **Mobile and asynchronous work:** Remote Control on an always-on dev VM holding the GitLab clone, steered from claude.ai/code or the Claude app. The VM has access to lab only.
- **Merge request automation:** the GitLab-maintained Claude Code GitLab CI/CD integration (beta), triggered by `@claude` mentions. Billed per token through the API.

## Consequences

### Positive

- Data moves to Zadara in the Philippines first, without test data.
- One organisation-standard platform for source, CI and hosting.
- Per-instance Supabase stacks isolate users, data, upgrades and restores.
- Tiers scale and are maintained independently.
- Each phase is small and reversible.

### Negative

- The team now operates Postgres, Supabase upgrades, TLS, backups and monitoring.
- No high availability at first.
- No automated tests on GitHub during phases 1–2: there is no GitHub CI and Vercel only checks the build. If those phases run long, add a small GitHub Actions workflow with the same four jobs.
- Vercel's per-branch preview deployments are lost in phase 5 unless CI recreates them on lab.
- Claude Code cloud sessions stop working for this repository once GitHub is archived.

## Open questions

- GitLab.com or self-managed GitLab long term?
- Domain names and TLS approach (ACME through Caddy, or organisation certificates)?
- Recovery objectives (RPO and RTO) for production.
- Does Zadara offer volume snapshots and private networking between VMs in the target zone?
- Will a self-hosted LLM or speech-to-text model run on Zadara GPU capacity, and when?

## Review triggers

- A production app needs high availability or zero-downtime upgrades.
- The data VM passes about 70% sustained memory use.
- The community zone (ADR-0004) is approved, which adds its own VMs and network.
