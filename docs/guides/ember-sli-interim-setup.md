# Ember SLI: interim setup on Vercel and Supabase Cloud

Until the Zadara lab is ready, Ember SLI runs as the Vercel project `ember-sli` on a Supabase Cloud project in Singapore ([ADR-0003](../architecture-decisions/ADR-0003-source-hosting-and-zadara-deployment.md)). **Synthetic data only.**

Run the commands from the repository folder, with `.env.local` holding `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` for the `ember-sli` Supabase project.

## 1. Apply new migrations

```sh
node --env-file=.env.local scripts/run-migrations.mjs 20261101100001_sli_organizations_and_departments.sql 20261101100002_sli_triggers.sql
```

Then paste `supabase/migration_status_check_recent.sql` into the Supabase SQL Editor: every row should read `applied`.

## 2. Your account

```sh
node --env-file=.env.local scripts/create-mike-admin.mjs
```

If the password reset email doesn't arrive, set the password from the terminal instead (typed hidden, never printed):

```sh
node --env-file=.env.local scripts/set-user-password.mjs you@example.com
```

Supabase's built-in email sender is for testing only: it sends a few emails an hour, and only to members of the Supabase organisation's team. For real users, set up custom SMTP (Supabase: Authentication → Emails → SMTP settings).

## 3. The organisation

```sh
node --env-file=.env.local scripts/sli-setup.mjs --owner you@example.com --synthetic
```

This creates the Sandz organisation ("Ember Sandz", "Solution Lifecycle Intelligence"), its departments (Discovery team, Marketing, Sales, Presales, Engineering, Project Delivery, Maintenance & Support) and Trigger types, makes you its owner and Discovery team lead, and adds four fictional Triggers. It is safe to re-run; the synthetic Triggers are added only once.

## 4. Turn the module on

In Vercel, `EMBER_SLI_ENABLED=true` (already set on `ember-sli`), then redeploy. Admins and curators see an **Ember Sandz** link in Ember's navigation; people whose access is only through SLI departments see the SLI screens only.
