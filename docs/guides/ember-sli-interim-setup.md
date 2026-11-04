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
node --env-file=.env.local scripts/run-migrations.mjs 20261103100001_sli_research_fit_check_prompt.sql
node --env-file=.env.local scripts/run-migrations.mjs 20261104100001_anthropic_provider.sql
node --env-file=.env.local scripts/run-migrations.mjs 20261105100001_sli_concept_and_feasibility_methods.sql
node --env-file=.env.local scripts/run-migrations.mjs 20261106100001_speech_to_text_models.sql
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

## 6. Claude as a model

Claude is available as a provider (switched off until it has a key):

1. Create an API key at [platform.claude.com](https://platform.claude.com) and add it to the Vercel project as `ANTHROPIC_API_KEY` (Sensitive), then redeploy.
2. In Ember, go to **Admin → AI providers → Claude (Anthropic)** and turn it on.
3. Set its **maximum sensitivity** to *Confidential*: Trigger research is confidential, and Ember only sends confidential material to providers approved for it.
4. Under **Model assignments**, make Claude Opus 5.5 the default generation model if you want Ember to use it everywhere. Keep the embedding default on OpenAI or Gemini: Claude has no embedding models.

## 7. Dictation

The **Dictate** button in Ember's chat (including a Trigger's research conversation) records speech and puts the words in the message box to check before sending. No audio is kept.

1. It uses the **Speech-to-text default** under Admin → AI Config → Model assignments. The migration makes OpenAI's GPT-4o Transcribe the default, so `OPENAI_API_KEY` must be set and the OpenAI provider enabled.
2. Set the OpenAI provider's **maximum sensitivity** to *Confidential* so dictation works on Trigger research, which is confidential.
3. The browser asks for microphone access the first time. Recordings stop at three minutes.
