# Moving Ember to Zadara and GitLab

Step-by-step guide for [ADR-0003](../architecture-decisions/ADR-0003-source-hosting-and-zadara-deployment.md). Each phase is finished, checked and left running before the next starts, and each has its own rollback.

| Phase | Moves | State after the phase | Rollback |
|---|---|---|---|
| 0 | Nothing (preparation) | Vercel + Supabase Cloud, code on GitHub | — |
| 1 | Database, Auth, Storage → **clean** Supabase on Zadara | Vercel + Zadara Supabase, code on GitHub | Point Vercel back at Supabase Cloud |
| 2 | Container build prepared and tested on lab | Unchanged in production | Not needed (nothing deployed) |
| 3 | Source and CI → GitLab | Vercel (deploying from GitLab) + Zadara Supabase | Reconnect Vercel to GitHub |
| 4 | Application → Zadara app VM | Zadara only | DNS back to Vercel |
| 5 | Retire GitHub, Vercel and Supabase Cloud | Zadara only | — |

Ember Sandz SLI development can continue throughout. Each Sandz migration is applied to the Zadara stacks like any other.

The first instance is named **SLI** (`sli-lab`, `sli-prod`). The Sandz Builders instance (ADR-0002) is added later with its own stacks (`builders-lab`, `builders-prod`), by repeating Phase 1 for those stacks.

---

## Phase 0: prepare (about half a day)

- ☐ Provision VMs from `docs/Deployment/zadara-resource-request.md`: `lab-01` and `prod-data-01` are needed now. `prod-app-01` and `prod-ops-01` are not needed until Phase 4.
- ☐ Write down every secret that lives outside the repo: Vercel environment variables (Production and Preview), AI provider keys, `TAVILY_API_KEY`, `CRON_SECRET`, SMTP. Nothing secret is committed (`.gitignore` excludes `.env*`).
- ☐ Decide domain names: `sli.<domain>` and `api.sli.<domain>`, and the lab equivalents.
- ☐ Tag the current `main` so the pre-Sandz state is easy to find:

  ```bash
  git checkout main && git pull
  git tag -a v0.9.0 -m "Ember before the Zadara move"
  git push origin v0.9.0
  ```

  Choose the version to suit your release numbering. ADR-0001 asks for a recorded version per installation, so tag every production release from now on.

## Phase 1: clean Supabase on Zadara (about 1 week including lab)

Follow `docs/guides/ember-on-self-hosted-supabase.md` and the per-client stack runbook, with these differences.

### 1.1 Stacks

- ☐ Name stacks per instance and environment: `sli-lab` on `lab-01`, `sli-prod` on `prod-data-01`. Later stacks (`builders-*`) get their own gateway port on the same VMs.
- ☐ Storage on Zadara S3 with **versioning** on. Confirm `backup.sh` dumps reach the backups bucket.
- ☐ SMTP configured; the password-reset test passes (self-hosted guide §3).

### 1.2 Schema, no data

The self-hosted guide's §5 (moving existing data) is **skipped**. Sandz starts from a clean database.

1. ☐ Before the first apply, review the migrations that insert rows for demonstration content:

   ```bash
   grep -l -i 'insert into' supabase/migrations/*.sql
   ```

   Expected reference data: knowledge base definitions (`20260809100001`), AI provider entries (`20260810110002`, `20260820120001`, `20260821090001`) and handbook release notes (`20260828150001`). Most of the other matches are backfills, which do nothing on an empty database. Note anything that looks like demonstration content for a decision before applying.
2. ☐ Apply the migrations **on lab first**, in filename order, following `ember-on-self-hosted-supabase.md` §4 (for example `supabase db push --db-url <session-mode connection string>` through an SSH tunnel). Then run `supabase/migration_status_check.sql` to confirm every migration's objects exist.

   > **Warning: Ember's migrations have never been applied in order to an empty database.** The current cloud project was built by hand in the SQL editor and with `scripts/run-migrations.mjs`. Expect some files to fail on a clean apply, for example a non-idempotent `create policy`, or a "fix" migration that assumes an earlier hand-applied state.
   >
   > - Fix each failure as a **corrected migration in the repository**, through a reviewed pull request. **Never edit the database by hand** to get past a failure.
   > - Prefer applying file by file over pasting `supabase/combined_migration.sql`. The combined file runs as one transaction, so the first failure rolls back everything, and it hides which file failed.
   > - Repeat on a fresh lab stack until the apply runs cleanly from empty. Only then use the same command for `sli-prod`.
   > - After any data is loaded, rebuild the vector index: `reindex index kb_vectors_embedding_idx;` (self-hosted guide §4, step 6).
3. ☐ Create the first admin account with `scripts/create-mike-admin.mjs` (or an equivalent), using the stack's URL and secret key in a local `.env.local`.
4. ☐ **Do not run** the demonstration and test seed scripts: `seed-test-users`, `seed-codex-test-users`, `seed-showcase-*`, `seed-carecall-*`, `seed-cebu-*`, `seed-food-outlet-*`, `seed-zadara-pilot-eval`, `seed-lunch-agent-registration` and similar.
5. ☐ In the app: **Admin → AI Config**, enable the providers Sandz will use and set each one's maximum sensitivity. Add AI provider keys and `TAVILY_API_KEY` to the Vercel environment if web search will be on (ADR-0002, "Web search").

### 1.3 Point Vercel at the new stacks

| Vercel environment | Supabase stack |
|---|---|
| Preview | `sli-lab` |
| Production | `sli-prod` |

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SITE_URL` per environment (self-hosted guide §1). `NEXT_PUBLIC_*` values are build-time, so **redeploy** after changing them.

### 1.4 Check

- ☐ The self-hosted guide's "Acceptance additions" checklist passes on lab, then prod.
- ☐ **Rehearse a restore** on lab from a real dump, so the backup procedure is proven before production holds real Sandz data.

**Phase 1 rollback:** restore the Vercel variables to the Supabase Cloud values and redeploy. Keep the Supabase Cloud project, paused but not deleted, until Phase 5.

## Phase 2: prepare the container (on GitHub, about 2–3 days)

These are code changes, made through ordinary pull requests on GitHub. Claude Code cloud sessions can still help here.

1. **Standalone build.** In `next.config.ts`, add `output: 'standalone'`. Check the current guide in `node_modules/next/dist/docs/` first, as `AGENTS.md` asks, because this Next.js version differs from older documentation.
2. **Dockerfile** (multi-stage, `node:22-bookworm-slim`): `npm ci`, `next build`, then copy `.next/standalone`, `.next/static` and `public/` into a slim runtime image that runs `node server.js` as a non-root user on port 3000. Add a `.dockerignore` excluding `node_modules`, `.next`, `.git`, `docs`, `.env*`.
3. **Environment name.** In `src/lib/chat/feedback-tool.ts`, read `APP_ENV` first, then `VERCEL_ENV`, then `NODE_ENV`.
4. **Cron script** replacing `vercel.json`'s entry, to be run every 15 minutes by a systemd timer:

   ```bash
   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<app-host>/api/cron/presentations
   ```

5. ☐ Build the image on a workstation, copy it to `lab-01`, run it against `sli-lab` behind Caddy, and run the acceptance checks. Vercel still serves production.

There is no automated test run on GitHub. Run `npm run lint`, `npm run typecheck` and `npm test` before merging. If Phases 1–2 run long, add a small GitHub Actions workflow with the same jobs as `.gitlab-ci.yml`.

## Phase 3: source and CI on GitLab (1–2 days, then a 2-week overlap)

### 3.1 Before the import

- ☐ Merge or close open pull requests on GitHub. List long-lived branches and decide which to keep.
- ☐ Agree a quiet window (one working day).
- ☐ Choose the GitLab group and project path (for example `sandz/ember`) on GitLab.com.

### 3.2 Import

1. In GitLab: **New project → Import project → GitHub**. Authorise with a GitHub personal access token that has `repo` scope.
2. Select `mikeA911/ember`. The importer brings branches, tags, full history, issues, pull requests (as merge requests, with comments) and labels.
3. Check after import:
   - ☐ `git log --oneline | wc -l` matches between the GitHub and GitLab clones.
   - ☐ Tags are present.
   - ☐ A sample of merged PRs appear as merged MRs with their discussion.
4. The repo holds some `.docx` files under `docs/`. Check the project size under **Settings → Usage Quotas** stays within your GitLab plan.

### 3.3 Protect `main` and require CI

- ☐ **Settings → Repository → Protected branches:** `main`, allowed to merge = Maintainers, allowed to push = No one.
- ☐ **Settings → Merge requests:** "Pipelines must succeed" and "All threads must be resolved".
- ☐ Push a test branch and open an MR. The pipeline in `.gitlab-ci.yml` runs four jobs:

  | Job | Command | Typical time |
  |---|---|---|
  | `lint` | `npm run lint` | under 2 min |
  | `typecheck` | `npm run typecheck` | under 2 min |
  | `test` | `npm test` (217 files, about 1,970 tests, no database) | about 1–2 min |
  | `build` | `npx next build` (no environment variables needed) | 3–6 min |

  All four commands passed locally on 23 October 2026 (Node 22, at commit `ad32ab6`). The pipeline itself has not yet run on GitLab.

### 3.4 Point Vercel at GitLab

1. Vercel project → **Settings → Git → Disconnect** the GitHub repository.
2. **Connect Git Repository → GitLab** → choose the GitLab project.
3. ☐ Production Branch is `main`. Environment variables are untouched (they belong to the Vercel project, not the Git link).
4. ☐ Push a trivial docs change through an MR. Check that a Preview deploys, and that merging deploys Production.

### 3.5 Developers switch remotes

```bash
git remote set-url origin git@gitlab.com:<group>/ember.git
git fetch origin
git branch -u origin/main main
```

### 3.6 Claude Code from here on

Claude Code cloud sessions cannot push to GitLab. From this point (ADR-0003, "Claude Code after the move"):

- ☐ Developers use Claude Code locally (terminal, IDE extension, or the Desktop app in Local mode) and install `glab` so Claude can open MRs and read pipelines.
- ☐ Optional: an always-on dev VM with the GitLab clone, running `claude --remote-control`, for steering from claude.ai/code or the Claude app. Lab access only.
- ☐ Optional, later: the Claude Code GitLab CI/CD integration for `@claude` in issues and MRs.

### 3.7 Mirror and archive GitHub

- ☐ GitLab → **Settings → Repository → Mirroring repositories:** push mirror to `https://github.com/mikeA911/ember.git`, using a GitHub fine-grained token with contents write.
- ☐ Add a line at the top of the README, through GitLab so the mirror carries it: "This repository has moved to GitLab: <url>."
- ☐ After **two weeks** of clean pipelines and Vercel deploys from GitLab, remove the push mirror and **archive** the GitHub repository (**Settings → Archive this repository**). Do not delete it.

**Phase 3 rollback:** reconnect Vercel to the GitHub repository, which still has every commit through the mirror.

## Phase 4: application on Zadara (about 1 week)

### 4.1 CI deploy jobs (one MR)

Extend `.gitlab-ci.yml`:

- a `docker` stage that builds and pushes `registry.gitlab.com/<group>/ember:<tag>` and `:<short-sha>`, on `main` and on tags;
- `deploy-lab` (automatic on `main`) and `deploy-prod` (manual, tags only). Both run on a **self-hosted runner** on `prod-ops-01`, which can reach the private network. It SSHes to the app VM, runs `docker compose pull && docker compose up -d`, then checks health.

### 4.2 App VM setup

On `prod-app-01` (and the same on `lab-01`):

- ☐ Docker and Docker Compose. A `compose.yml` with Caddy and the SLI service (two replicas), with the environment file at `/etc/ember/sli.env` (mode 600). It holds the same variables as Vercel, plus `APP_ENV=production` and `CRON_SECRET`.
- ☐ Caddy sites:
  - `sli.<domain>` → SLI replicas, with `request_body max_size 6MB` and read and write timeouts of at least 180 s.
  - `api.sli.<domain>` → `prod-data-01:8000` over the private network. Move this site off the data VM's own Caddy, then remove the data VM's public IP.
- ☐ The cron systemd timer from Phase 2.
- ☐ **Outbound reachability** from the VM: an embedding call and a chat call for every provider enabled in **Admin → AI Config**, and a Tavily search if web search is on.
- ☐ Uptime checks on `https://sli.<domain>/login` and the Supabase API from `prod-ops-01`.

### 4.3 Cut-over

1. ☐ Deploy the release tag to lab and run the acceptance checklist: sign-in, Project page, logo from Storage, password-reset email, upload and approve a source, an Ember conversation with knowledge search, a scheduled presentation opening on the cron.
2. ☐ Deploy the same tag to prod. Lower the DNS TTL to 5 minutes a day ahead.
3. ☐ Switch `sli.<domain>` DNS to `prod-app-01`. Update Supabase Auth's Site URL and redirect URLs if the app URL changes, and `NEXT_PUBLIC_SITE_URL` (build-time, so rebuild).
4. ☐ Repeat the acceptance checks on prod.

**Phase 4 rollback:** point DNS back to Vercel. Vercel talks to the same Zadara Supabase, so no data is lost.

## Phase 5: retire (after two clean weeks)

- ☐ Remove the Vercel project's domains, then delete the project. Remove `vercel.json`, and `.vercel` from `.gitignore`, in an MR.
- ☐ Take a final export of the Supabase Cloud project for the archive, then delete it.
- ☐ Archive the GitHub repository if not already done (§3.7).
- ☐ Update `README.md` (getting started, deployment), `docs/CURRENT-ARCHITECTURE.md` ("Stack") and `docs/guides/ember-on-self-hosted-supabase.md` (topology; environment file on the app VM instead of Vercel variables).
- ☐ Change ADR-0003 status to **Accepted** and record the dates.

## Adding the Builders instance

When the Sandz Builders instance (ADR-0002) starts:

1. Phase 1 again for `builders-lab` and `builders-prod`: clean install, admin account, AI providers.
2. A second service in each app VM's `compose.yml` from the same image, with its own environment file and module switches (builder programme on, SLI off).
3. Two Caddy sites (`builders.<domain>`, `api.builders.<domain>`), monitor entries and a backup entry.
4. A memory check on `prod-data-01` against the resize triggers in the resource request.

Builders' **own apps** do not go in this zone. They run in the community zone described in ADR-0004.
