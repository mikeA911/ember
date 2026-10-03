# Setting up Ember's MCP server (ask your AI chatbot about Ember)

Builders can connect **Claude** or **ChatGPT** (web, desktop or phone) to Ember and ask about their projects: status, workstreams and deliverables, approved knowledge, open notes, and "how do I…" navigation. The connection is **read-only** and signs in as the builder's own Ember account.

Sign-in uses **OAuth 2.1**, with **Supabase Auth as the authorization server**. The chatbot sends the user to Ember's normal login, Ember shows a consent screen, and Supabase issues the chatbot a short-lived token for that user. Ember never sees or stores a password or API key for the chatbot.

Design and guardrails: [`docs/dev-request-ember-external-mcp-server.md`](../dev-request-ember-external-mcp-server.md).

---

## 1. Apply the database migration

Apply `supabase/migrations/20261005100001_external_mcp_access.sql` the same way as any other migration (SQL Editor, or `scripts/run-migrations.mjs`). It creates:

- `mcp_access_users`: who may connect (empty until you add people).
- `mcp_approved_clients`: which chatbots may connect. Pre-filled with Claude (`claude.ai`, `claude.com`) and ChatGPT, each capped at **Internal** sensitivity.
- `mcp_access_log` and `mcp_rate_counters`.
- **Read-only enforcement:** a restrictive policy on every table and on `storage.objects` that blocks insert, update and delete for any token issued to an OAuth client, plus guards on the three `SECURITY DEFINER` counter functions.

Then run `supabase/migration_status_check.sql` to confirm it applied.

> Any **future** migration that creates a table must end with `select apply_oauth_read_only_policies();`. A test (`src/lib/mcp/read-only-migrations.test.ts`) fails otherwise.

## 2. Turn on Supabase's OAuth server

In the Supabase dashboard for the Ember project. Menu labels may shift slightly between Supabase releases.

1. **Authentication → URL Configuration**
   - **Site URL:** Ember's production URL, e.g. `https://ember.example.com`. Supabase builds the consent-page URL from this.
   - **Redirect URLs:** make sure Ember's own URL is listed, as for normal login.
2. **Authentication → OAuth Server**
   - **Enable the OAuth 2.1 server.**
   - **Authorization path:** `/oauth/consent`. Supabase sends the user to `<Site URL>/oauth/consent?authorization_id=…`, which is Ember's consent page.
   - **Allow dynamic client registration: on.** Claude and ChatGPT register themselves automatically when a user adds the connector. This is safe because Ember's consent page only approves apps whose redirect URI is in `mcp_approved_clients`; a client registered with any other redirect URI can never receive a code.
3. **JWT signing keys** (Project Settings → JWT Keys). If the OAuth server asks you to switch to **asymmetric signing keys** (RS256/ES256), do it. Ember works with either, because it validates tokens by asking Supabase Auth (`auth.getUser`).

**Check:** open `https://<project-ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`. You should see JSON containing `authorization_endpoint`, `token_endpoint` and `registration_endpoint`.

## 3. Configure the Ember deployment

Set these on the Vercel project (Production, and Preview if you want to test there first):

| Variable | Value |
|---|---|
| `EMBER_MCP_ENABLED` | `true`. Anything else keeps `/api/mcp` at 503 and makes the consent page refuse. |
| `NEXT_PUBLIC_SITE_URL` | Ember's public URL, used for the links in answers. |

Redeploy.

**Check:**
- `https://<ember>/.well-known/oauth-protected-resource/api/mcp` returns JSON whose `authorization_servers` is `https://<project-ref>.supabase.co/auth/v1`.
- `curl -i -X POST https://<ember>/api/mcp` returns `401` with a `WWW-Authenticate: Bearer … resource_metadata="…"` header. This is what tells a chatbot where to sign in.

## 4. Choose who can connect

As an Ember admin: **Admin → AI app access**.

- **Who can connect:** add yourself and your colleagues by the email of their existing Ember account.
- **Approved apps:** Claude and ChatGPT are already listed at **up to internal**. Raise an app to *confidential* only if your organisation's AI policy allows that provider to receive confidential material. *Restricted* information is never sent over MCP.
- **Claude Code (optional):** Claude Code signs in through a local callback on a random port. Add `http://localhost/callback` with the label "Claude Code"; loopback entries match any port.

## 5. Connect a chatbot

Each builder does this once. After that it works on their phone too.

**Claude (claude.ai web or desktop):** Settings → Connectors → **Add custom connector** → URL `https://<ember>/api/mcp` → Add → **Connect**. Sign in to Ember and choose **Allow read-only access**. The connector then appears in the Claude mobile app as well.

**ChatGPT:** add `https://<ember>/api/mcp` as a custom connector/app (Settings → Apps & Connectors; on some plans this is under *Advanced → Developer mode*). Choose OAuth when asked, then sign in and Allow.

**Claude Code:** `claude mcp add --transport http ember https://<ember>/api/mcp`, then run `/mcp` and choose *Authenticate* (after step 4's localhost entry).

Try: *"What Ember projects am I on?"*, *"What's the status of the Zadara pilot?"*, *"Which deliverables are still open on the ontology workstream?"*, *"What do our approved documents say about data retention?"*

Each builder can see their connected apps and recent activity under **Profile → Connected AI apps**, and **Disconnect** there. Disconnecting takes effect on the app's next request.

## 6. Verify the read-only guarantee on your database

Run this in the Supabase SQL Editor. It simulates a chatbot token for your own user and rolls everything back. Replace the two ids with your user id and a project you own.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<your-user-id>', 'role', 'authenticated', 'client_id', 'verification')::text, true);

select name from projects where id = '<a-project-you-own>';           -- returns the row: reads work
update projects set name = name where id = '<a-project-you-own>';     -- UPDATE 0: writes blocked
select increment_rejected_chunks(gen_random_uuid());                  -- ERROR: OAuth client tokens are read-only
rollback;
```

Without the `client_id` line, the same update reports `UPDATE 1` (then rolls back). That shows normal browser sessions are unaffected.

## What happens if something is misconfigured

Every failure refuses access; none of them opens it up.

| Symptom | Cause |
|---|---|
| Chatbot says the server is unavailable (503) | `EMBER_MCP_ENABLED` isn't `true`. |
| Consent page: "This app is not approved for Ember" | The app's redirect URI isn't in **Approved apps**. |
| Consent page: "AI app access isn't enabled for your account" | The user isn't in **Who can connect**. |
| Connects, but every call fails with "only accepts sign-ins made through an approved AI app" | The token has no `client_id` claim. Ember requires it, because the database's read-only policies key on it. Check the OAuth server is enabled and the app signed in through it. |
| Calls fail with 429 | Rate limit: 30 calls per minute, 500 per day, per user and app. |
| A project or search result "withheld" | It's above the app's sensitivity level. Open Ember to see it. |

## Turning it off

- **Everyone, immediately:** set `EMBER_MCP_ENABLED` to anything but `true` and redeploy.
- **One person:** remove them under **Admin → AI app access**. Their next request fails.
- **One app:** remove it from **Approved apps**. Existing connections fail on their next request.
