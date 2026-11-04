# Ember SLI: interim setup on Vercel and Supabase Cloud

Until the Zadara lab is ready, Ember SLI runs as the Vercel project `ember-sli` on a Supabase Cloud project in Singapore ([ADR-0003](../architecture-decisions/ADR-0003-source-hosting-and-zadara-deployment.md)). **Synthetic data only.**

Run the commands from the repository folder, with `.env.local` holding `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` for the `ember-sli` Supabase project.

## 1. Apply new migrations

```sh
node --env-file=.env.local scripts/run-migrations.mjs 20261101100001_sli_organizations_and_departments.sql 20261101100002_sli_triggers.sql
```

Then paste `supabase/migration_status_check_recent.sql` into the Supabase SQL Editor: every row should read `applied`.

Later migrations, in order:

```sh
node --env-file=.env.local scripts/run-migrations.mjs 20261102100001_sli_trigger_research_projects.sql
```

This one also gives Triggers already in research their research space.

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

## 5. Add people

Supabase's built-in email can't reach staff addresses, so people get a temporary password instead of an invitation:

1. Copy `scripts/sli-members.example.json` to a file ending in `.local.json` (for example `sli-members.local.json`; such files are ignored by git, so real names never reach the public repository) and list the people, each with a department code (`discovery`, `marketing`, `sales`, `presales`, `engineering`, `delivery`, `support`), `lead` or `member`, and for the Discovery team whether they can sponsor.
2. Run:

   ```sh
   node --env-file=.env.local scripts/sli-add-members.mjs sli-members.local.json
   ```

3. The script prints each new person's temporary password once. Give it to them privately.
4. At first sign-in Ember asks them to choose their own password before anything else.

To give everyone the same temporary password instead, add `--shared-password`: the script asks you for it (typed hidden, never printed). It is easier to hand out, but until each person changes it, anyone who knows it can sign in as them, so ask everyone to sign in the same day.

Re-running is safe: existing accounts keep their password and role, and their memberships are updated. `--reset-passwords` issues new temporary passwords to everyone in the list (for someone who lost theirs, use a list with just that person).
