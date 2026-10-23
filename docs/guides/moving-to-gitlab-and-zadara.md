# Moving Ember to GitLab and Zadara

Step-by-step guide for [ADR-0003](../architecture-decisions/ADR-0003-source-hosting-and-zadara-deployment.md). Four phases. Each one is finished, checked and left running before the next starts, and each has its own rollback.

| Phase | Moves | Hosting after the phase | Rollback |
|---|---|---|---|
| 0 | Nothing (preparation) | Vercel + Supabase Cloud | — |
| 1 | Source and CI → GitLab | Vercel (deploying from GitLab) + Supabase Cloud | Reconnect Vercel to GitHub |
| 2 | Database, Auth, Storage → Supabase on Zadara | Vercel + Zadara Supabase | Point Vercel back at Supabase Cloud |
| 3 | Application → Zadara app VM | Zadara only | DNS back to Vercel |
| 4 | Retire GitHub and Vercel | Zadara only | — |

Ember Sandz development can continue throughout. Avoid merging Sandz **migrations** in the same week as the Phase 2 data move.

---

## Phase 0: prepare (about half a day)

- ☐ Merge or close open pull requests on GitHub. List long-lived branches and decide which to keep.
- ☐ Agree a quiet window (one working day) for the repository import.
- ☐ Decide the GitLab location: group and project path (for example `sandz/ember`) on GitLab.com. ADR-0003 recommends GitLab.com over self-managed for this move.
- ☐ Write down every secret that lives outside the repo: Vercel environment variables (Production and Preview), Supabase keys, `CRON_SECRET`, AI provider keys, SMTP. Nothing secret is committed (`.gitignore` excludes `.env*`).
- ☐ Tag the last GitHub-era commit on `main`:

  ```bash
  git checkout main && git pull
  git tag -a v0.9.0 -m "Last release before the GitLab move"
  git push origin v0.9.0
  ```

  Choose the version to suit your release numbering. ADR-0001 asks for a recorded version per installation, so tag every production release from now on.

## Phase 1: source and CI on GitLab (1–2 days, then a 2-week overlap)

### 1.1 Import

1. In GitLab: **New project → Import project → GitHub**. Authorise with a GitHub personal access token that has `repo` scope.
2. Select `mikeA911/ember`. The importer brings branches, tags, full history, issues, pull requests (as merge requests, with comments) and labels.
3. Check after import:
   - ☐ `git log --oneline | wc -l` matches between the GitHub and GitLab clones.
   - ☐ Tags are present, including `v0.9.0`.
   - ☐ A sample of merged PRs (for example #63–#65) appear as merged MRs with their discussion.
4. Large files: the repo holds some `.docx` files under `docs/`. Check the project size under **Settings → Usage Quotas** stays within your GitLab plan.

### 1.2 Protect `main` and require CI

- ☐ **Settings → Repository → Protected branches:** `main`, allowed to merge = Maintainers, allowed to push = No one.
- ☐ **Settings → Merge requests:** "Pipelines must succeed", and "All threads must be resolved".
- ☐ Push a test branch and open an MR. The pipeline in `.gitlab-ci.yml` runs four jobs:

  | Job | Command | Typical time |
  |---|---|---|
  | `lint` | `npm run lint` | under 2 min |
  | `typecheck` | `npm run typecheck` | under 2 min |
  | `test` | `npm test` (217 files, about 1,970 tests, no database) | about 1–2 min |
  | `build` | `npx next build` (no environment variables needed) | 3–6 min |

  All four commands passed locally on 23 October 2026 (Node 22, at commit `ad32ab6`). The pipeline itself has not yet run on GitLab.

### 1.3 Point Vercel at GitLab

Hosting does not change in this phase.

1. Vercel project → **Settings → Git → Disconnect** the GitHub repository.
2. **Connect Git Repository → GitLab** → choose the GitLab project.
3. ☐ Production Branch is `main`. Environment variables are untouched (they belong to the Vercel project, not the Git link).
4. ☐ Push a trivial docs change through an MR. Check that a Preview deploys, and that merging deploys Production.

### 1.4 Developers switch remotes

```bash
git remote set-url origin git@gitlab.com:<group>/ember.git
git fetch origin
git branch -u origin/main main
```

### 1.5 Mirror and archive GitHub

- ☐ GitLab → **Settings → Repository → Mirroring repositories:** push mirror to `https://github.com/mikeA911/ember.git`, using a GitHub fine-grained token with contents write. GitHub now follows GitLab automatically.
- ☐ Add a line at the top of the GitHub README, through GitLab so the mirror carries it: "This repository has moved to GitLab: <url>."
- ☐ After **two weeks** with clean pipelines and Vercel deploys from GitLab: remove the push mirror, then on GitHub use **Settings → Archive this repository**. Do not delete it. Archiving keeps PR history readable and links working.

### 1.6 Claude Code

This project has used Claude Code cloud sessions that clone from GitHub, push branches and watch PRs. Before archiving GitHub, check whether those sessions support your GitLab project. If they don't:

- the Claude Code CLI on a developer machine works with any git remote, including GitLab;
- or keep the GitHub mirror (read-only for humans) longer for that purpose.

**Phase 1 rollback:** reconnect Vercel to the GitHub repository (it still has every commit through the mirror).

## Phase 2: Supabase on Zadara (about 1–2 weeks including lab)

Follow `docs/guides/ember-on-self-hosted-supabase.md` and the per-client stack runbook. In this phase the app is still on Vercel, so the Caddy-on-the-Supabase-VM layout in that guide applies as written.

Additions from ADR-0003:

- ☐ Provision VMs from `docs/Deployment/zadara-resource-request.md`. Use `lab-01` and `prod-data-01` for the stacks. Those sizes replace the single-stack table in the self-hosted guide.
- ☐ Name each stack per app and environment (`ember-lab`, `ember-prod`), so later apps get their own (`<app>-prod`) on the same data VM, each on its own gateway port.
- ☐ Turn on S3 bucket versioning and check that `backup.sh` dumps reach the backups bucket.
- ☐ **Rehearse a restore on lab** from a real dump before moving production data.
- ☐ Production data move in a short read-only window (self-hosted guide §5). Vercel's Production variables then point at `ember-prod`.

**Phase 2 rollback:** restore the Vercel Production variables to the Supabase Cloud values and redeploy. Keep the Supabase Cloud project, paused but not deleted, until Phase 4. Anything written to Zadara after cut-over must be exported if you roll back, so decide the rollback deadline in advance (for example 48 hours).

## Phase 3: application on Zadara (about 1–2 weeks)

### 3.1 Code changes (one MR)

These are small, but they are code. They go through the normal MR and pipeline.

1. **Standalone build.** In `next.config.ts`, add `output: 'standalone'`. Check the current guide in `node_modules/next/dist/docs/` first, as `AGENTS.md` asks, because this Next.js version differs from older documentation.
2. **Dockerfile** (multi-stage, `node:22-bookworm-slim`): `npm ci`, `next build`, then copy `.next/standalone`, `.next/static` and `public/` into a slim runtime image that runs `node server.js` as a non-root user on port 3000. Add a `.dockerignore` excluding `node_modules`, `.next`, `.git`, `docs`, `.env*`.
3. **Environment name.** In `src/lib/chat/feedback-tool.ts`, read `APP_ENV` first, then `VERCEL_ENV`, then `NODE_ENV`.
4. **CI.** Extend `.gitlab-ci.yml`:
   - a `docker` stage that builds and pushes `registry.gitlab.com/<group>/ember:<tag>` and `:<short-sha>`, on `main` and on tags;
   - `deploy-lab` (automatic on `main`) and `deploy-prod` (manual, tags only). Both run on the **self-hosted runner** on `prod-ops-01`, which can reach the private network: it SSHes to the app VM, runs `docker compose pull && docker compose up -d`, then checks health.

### 3.2 App VM setup

On `prod-app-01` (and the same on `lab-01`):

- ☐ Docker and Docker Compose. A `compose.yml` with Caddy and the Ember service (two replicas), with the environment file at `/etc/ember/ember.env` (mode 600). It holds the same variables as Vercel, plus `APP_ENV=production` and `CRON_SECRET`.
- ☐ Caddy sites:
  - `ember.<domain>` → Ember replicas, with `request_body max_size 6MB` and read and write timeouts of at least 180 s. Routes run up to 120 s (`maxDuration` in `src/app/api/collaboration/turns/route.ts`) and evaluation runs can take longer.
  - `api.ember.<domain>` → `prod-data-01:8000` over the private network. Move this site off the data VM's own Caddy, then remove the data VM's public IP.
- ☐ **Cron** replacing `vercel.json`. A systemd timer or cron entry every 15 minutes:

  ```bash
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://ember.<domain>/api/cron/presentations
  ```

- ☐ **AI provider reachability** from the VM. Test an embedding call and a chat call for every provider enabled in **Admin → AI Config**. The self-hosted guide §9 records an outage caused by a provider refusing a region.
- ☐ Health check: `curl -fsS https://ember.<domain>/login` returns 200. Add it and the Supabase API to the uptime monitor on `prod-ops-01`.

### 3.3 Cut-over

1. ☐ Deploy the release tag to lab and run the acceptance checklist (self-hosted guide, "Acceptance additions"): sign-in, Project page, logo from Storage, password-reset email, upload and approve a source, an Ember conversation with knowledge search, a scheduled presentation opening on the cron.
2. ☐ Deploy the same tag to prod. Lower the DNS TTL to 5 minutes a day ahead.
3. ☐ Switch `ember.<domain>` DNS to `prod-app-01`. Update Supabase Auth's Site URL and redirect URLs if the app URL changes, and `NEXT_PUBLIC_SITE_URL` (a **build-time** value, so rebuild).
4. ☐ Repeat the acceptance checks on prod.

**Phase 3 rollback:** point DNS back to Vercel. Vercel still talks to the same Zadara Supabase, so no data is lost.

## Phase 4: retire (after two clean weeks)

- ☐ Remove the Vercel project's domains, then delete the project. Remove `vercel.json`, and `.vercel` from `.gitignore`, in an MR.
- ☐ Delete the paused Supabase Cloud project after taking a final export for the archive.
- ☐ Archive the GitHub repository if not already done (§1.5).
- ☐ Update `README.md` (getting started, deployment), `docs/CURRENT-ARCHITECTURE.md` ("Stack": no longer on Vercel), and `docs/guides/ember-on-self-hosted-supabase.md` (topology and §1 now refer to the app VM's environment file instead of Vercel variables).
- ☐ Change ADR-0003 status to **Accepted** and record the dates.

## Adding a future app

Once the platform exists, a new Supabase-based app needs:

1. Its own GitLab project, using `.gitlab-ci.yml` from Ember as the template.
2. Its own Supabase stacks on `lab-01` and `prod-data-01` (next free gateway port), with its own storage bucket and a backup entry.
3. A service in the app VM's `compose.yml`, and two Caddy sites (`<app>.<domain>`, `api.<app>.<domain>`).
4. A monitor entry on `prod-ops-01`.
5. A memory check on `prod-data-01` against the resize triggers in the resource request.
