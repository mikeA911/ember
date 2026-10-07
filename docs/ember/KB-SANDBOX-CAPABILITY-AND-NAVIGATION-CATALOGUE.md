# KB Sandbox Capability and Navigation Catalogue

**Purpose:** Living product-navigation knowledge for Ember, release documentation, future application discovery, and a possible KB Sandbox MCP interface  
**Status:** Initial baseline — expand as workflows are verified  
**Application version:** 0.1.0  
**Last code verification:** 2026-10-07  

## How this document is used

This catalogue records what users can accomplish in KB Sandbox, where each workflow begins, which access rules apply, and how Ember should guide the user. It is committed with the application and should be updated in the same change as a material user-visible workflow.

This is not a changelog. Release notes should briefly describe what changed and link to the affected catalogue entry. This document retains the durable, current description of the workflow.

Each capability is described using the following fields:

| Field | Meaning |
|---|---|
| Intent | What the user is trying to accomplish |
| Users and authority | Who may see or use the capability |
| Prerequisites | Required identity, membership, role, content, or state |
| Start | Stable page from which the workflow begins |
| Navigation | Shortest supported UI sequence |
| Outcome | What the user should expect to see or create |
| Ember guidance | What Ember may explain, link to, or perform |
| Boundaries | Important restrictions, approvals, side effects, and known limitations |
| Exposure | Current or possible AI/MCP classification |
| Verification | Evidence and date supporting the entry |

## Release-note convention

A release note should be short and change-oriented:

```text
### <User-visible capability>

<What changed and why it matters to the user.>

- Available to: <roles or project relationship>
- Start at: <stable route>
- Ember: <new explanation, navigation, or action behavior>
- Guide: <link to the affected catalogue heading>
```

Example:

```text
### Project-scoped Assistant conversations

Members can now ask Ember about a project and receive answers grounded in that project's authorized sources and platform guidance.

- Available to: authorized project members
- Start at: `/projects/[id]`
- Ember: explains missing prerequisites and offers the project-specific Assistant entry point
- Guide: Project workspace → Ask Ember about a project
```

Do not copy the entire workflow into every release note. Update the workflow here, then use the release note to identify the change.

## Navigation map

| Area | Stable route | Primary intent | Visibility |
|---|---|---|---|
| Sign in | `/login` | Access a personal, role-aware workspace | Public entry point |
| Workbench | `/dashboard` | See activity, status, attention items, and shortcuts | Signed-in users |
| Projects | `/projects` | Organize governed work, knowledge, people, and evidence | Signed-in; results are access-scoped |
| Wiki | `/wiki` | Find and curate approved platform or project guidance | Signed-in; content is role- and project-scoped |
| Blog contribution | `/contribute/blog` | Draft and submit articles | Curator and admin |
| Public Blog | `/blog` | Read published articles | Public |
| Trending | `/trending` | Share and examine external material before it becomes knowledge | Signed-in users |
| Explore: Evals | `/evals` | Check whether Ember answers a Project's test questions correctly | Platform admin (also Admin → **Ember readiness**); curators reach their datasets from a Project or `/evals` |
| Explore: Graphs | `/graphs` | Inspect agent and Method flow visualizations | Signed-in users |
| Explore: Agents | `/agents` | View and use available agents, including Ember | Signed-in users |
| Explore: Agent Registry | `/agent-registry` | Register and inspect externally implemented agents | Signed-in non-anonymous users |
| Builder's Journey | `/builders` | Learn how builders go from proposal to paid client project | Public |
| Request builder access | `/register` | Ask the platform owner for a builder account, with a reason | Public entry point |
| Agency dashboard | `/agency` | Oversee builders: promotions, fees and rates, AI budgets, knowledge bases, workstream limits | Platform admin (all builders); an agency curator (their own builders) |
| Live collaboration (when enabled) | `/projects/[id]` → **Collaborate**; shared conversations at `/projects/[id]/shared/[conversationId]` | Work through a Project's pages together with one other member | Active members of that Project, only where the deployment enables it |

The application logo links to `/about`. The signed-in profile and journal begin at `/profile`.

---

## 1. Sign in

### Access the Workbench

- **Intent:** Sign in and continue work under the correct user identity and role.
- **Users and authority:** A registered user with valid credentials.
- **Prerequisites:** An account that is permitted to sign in.
- **Start:** `/login`
- **Navigation:** Enter credentials → submit → `/dashboard`.
- **Outcome:** The Workbench opens with navigation and content appropriate to the user's platform role and project memberships.
- **Ember guidance:** Ember may direct a signed-out user to `/login`. Ember must not request, repeat, retain, or transmit the user's password or API keys.
- **Boundaries:** Authentication does not grant access to every project. Project membership and content visibility continue to apply after sign-in.
- **Exposure:** UI guidance only; prohibited from agent credential handling.
- **Verification:** Login form redirects successful authentication to `/dashboard`; code verified 2026-08-28.

### Request a builder account

- **Intent:** Someone who wants to build with Ember asks the platform owner for an account.
- **Users and authority:** Anyone, signed out. Accepting is the platform owner's decision; an admin then creates the account.
- **Prerequisites:** The deployment sets `EMBER_ACCESS_REQUEST_EMAIL`; without it the page only says to ask an administrator.
- **Start:** `/register` (linked from the sign-in form as **Want to build? Request access**, and from the Builder's Journey page).
- **Navigation:** Enter name, email and a reason → **Email my request** → the visitor's email app opens with the request addressed to the platform owner.
- **Outcome:** An email to the platform owner. Nothing is created in Ember until the owner replies and creates the account from `/admin` (User Management). A new builder account gets a workspace Project and is placed under the creating admin's agency.
- **Ember guidance:** Direct people who ask how to join as a builder to `/register`, and explain that the owner replies to say whether they're accepted. Ember cannot create accounts.
- **Boundaries:** Self-registration is off; there is no sign-up form that creates an account.
- **Exposure:** UI only.
- **Verification:** `src/app/(auth)/register/page.tsx`, `src/components/auth/{AccessRequestForm.tsx,access-request.ts}`, `src/app/actions/admin.ts` (`createUserAction`); code verified 2026-10-07.

## 2. Workbench

### Review current activity and navigate to work

- **Intent:** Understand what exists, what needs attention, and where to continue.
- **Users and authority:** Admin and curator. A signed-in `consultant` or `member` (an ordinary Project member) instead lands on the Ember-first home described in the next entry -- this summary view is no longer what that role sees at `/dashboard`.
- **Prerequisites:** Signed-in admin or curator session.
- **Start:** `/dashboard`
- **Navigation:** Use the summary cards for Projects, Knowledge, Evaluations (platform admin only), Agents, or Trending; use **Sources & Curation** to open `/upload`. As of 2026-09-04, a **Continue where you left off** callout (the Project behind the viewer's most recent conversation) and a **Your projects** list (every active membership, role badge, most-recently-worked-on first) appear right below the summary cards -- the same "land somewhere useful, not just stats" shortcut the Ember-first home already had.
- **Outcome:** A role-aware summary of accessible work and direct links to the corresponding areas, including straight back into the viewer's own Projects without a trip to `/projects`.
- **Ember guidance:** Ember may explain the cards and provide stable links. It should mention that counts and attention items depend on access and role. Ember has no dedicated tool for "Your projects"/"Continue where you left off" -- point the user to `/dashboard` if asked how to get back to a Project quickly.
- **Boundaries:** Wiki review queues and governance attention items are limited to curator/admin users. Shared links and personal notes are shown only to eligible signed-in users. Dashboard totals do not authorize access to an underlying item. "Your projects" only ever lists the viewer's own active memberships -- never an org-wide list (that stays `/projects/portfolio`'s job).
- **Exposure:** Ember-readable; candidate for external MCP read access as a caller-scoped summary.
- **Verification:** `src/app/(app)/dashboard/page.tsx`, `src/components/dashboard/MyProjectsWidget.tsx`, `src/lib/projects/queries.ts` (`listActiveProjectsForDashboard`); code verified 2026-09-04. Live-verified as an admin persona with two active memberships and one recent conversation -- "Continue where you left off" named the correct Project, "Your projects" listed both with correct roles, the recent one sorted first.

### Ember-first home (ordinary members)

- **Intent:** Give an ordinary Project member (platform role `consultant` or `member`) a working surface centered on Ember rather than platform-wide statistics.
- **Users and authority:** Platform role `consultant` or `member` only. Admin and curator continue to see the standard Workbench summary described above.
- **Prerequisites:** Signed-in session.
- **Start:** `/dashboard`
- **Navigation:** Choose a Project from the selector (only the user's own active memberships appear, plus "General platform guidance") → **Ask Ember**. The choice is reflected in the page URL (`?ember=<projectId>`) so it survives a reload, and shows as a persistent "Using: <Project>" chip.
- **Outcome:** An embedded, Project-bound (or general) Ember conversation opens inline, alongside the user's recent conversations and a secondary **Explore workspace →** link to `/projects` for anyone who wants the full Workbench.
- **Ember guidance:** Same rules as any other project-bound or general conversation -- see "Work inside a project" below.
- **Boundaries:** Switching the Project selector always starts a fresh embedded conversation instance -- no retrieved evidence, citations, or chat history carry over from whatever Project was previously selected. The selector only ever lists the viewer's own active memberships.
- **Exposure:** UI surface only, not a distinct MCP concept -- the underlying Ember conversation follows the same project-binding rules as everywhere else.
- **Verification:** `src/app/(app)/dashboard/page.tsx`, `src/components/dashboard/EmberHome.tsx`; code verified 2026-08-30. Live-verified as a `consultant`-role account: selector persists via the URL, scope chip updates, the embedded panel remounts cleanly (no leaked state) on every Project switch; `admin`/`curator` accounts confirmed unaffected.

### Add a shared link

- **Intent:** Recommend external material for other Workbench users to examine.
- **Users and authority:** Active signed-in, non-anonymous users; admin may remove entries.
- **Prerequisites:** Signed-in session; optional project membership when associating a link with a project.
- **Start:** `/dashboard` or `/trending/new`
- **Navigation:** Find the shared-links area → add the title, URL, description, tags, and optional authorized project → submit.
- **Outcome:** A Trending/shared-link entry, explicitly treated as a recommendation rather than approved knowledge.
- **Ember guidance:** Ember may explain the distinction between external material and approved Wiki knowledge and navigate to the submission page.
- **Boundaries:** Submission is not publication as trusted knowledge. Promotion to Wiki follows a separate review workflow.
- **Exposure:** Candidate for MCP draft/action after confirmation; moderation remains authority-gated.
- **Verification:** Dashboard and Trending components; code verified 2026-08-28.

## 3. Projects

### Find or create a project

- **Intent:** Organize a bounded body of work with its own objective, members, sources, approvals, workstreams, assessments, and evidence.
- **Users and authority:** Signed-in users may see projects permitted by policy and create a project. Subsequent management depends on project relationship and authority.
- **Prerequisites:** Signed-in session.
- **Start:** `/projects`
- **Navigation:** Open **Projects** ("My Projects" -- genuinely scoped to the user's own active memberships for every platform role, including admin) → select an accessible project, or choose **New project** → `/projects/new`. Admin/curator additionally see a **View Organization Portfolio →** link to `/projects/portfolio` (next entry).
- **Outcome:** An existing project workspace opens, or the user begins the project-creation workflow.
- **Ember guidance:** Ember may list accessible projects, explain project types, navigate to `/projects` or a project derived from the authorized current context, and help create a project only through supported bounded tools.
- **Boundaries:** A platform role alone must not be represented as customer-project authorization. Ember should identify membership or authority gaps before proposing restricted actions. As of 2026-08-30, platform admin no longer sees every Project on `/projects` merely by role -- that previously relied on an RLS bypass and has been fixed; org-wide visibility for admin/curator now lives only in the safe-metadata Organization Portfolio below.
- **Exposure:** Ember-readable and partly Ember-actionable; strong candidate for caller-scoped MCP read access. Creation or change requires identity, validation, and confirmation.
- **Verification:** `/projects`, `/projects/new`, project membership and governance routes; code verified 2026-08-30.

### Browse and categorize My Projects

- **Intent:** Find a Project faster in a growing list by browsing it grouped into named categories instead of one flat grid.
- **Users and authority:** Any signed-in user, scoped to their own active memberships (same as "Find or create a project" above). Changing a Project's own category is owner/curator/admin only.
- **Prerequisites:** Signed-in session; at least one active Project membership to see any groups.
- **Start:** `/projects`
- **Navigation:** Projects page -- Projects now render under section headings (Sandz / Foundation / Showcases / Builder Lab / Templates / Legacy/Test / Archived / Others), each with a count; empty sections are hidden. To change a Project's own category, open it and use the selector next to its project type near the top of `/projects/[id]`.
- **Outcome:** The same set of Projects the user could always see, organized into fewer, labeled groups instead of one long grid.
- **Ember guidance:** Ember has no dedicated tool for this -- it is a page-level display only. If asked to categorize or find a Project by type, point the user to `/projects` rather than attempting to enumerate or sort Projects conversationally.
- **Boundaries:** This is a separate axis from `project_type` (learning/experiment/consulting/transformation/knowledge) -- the two do not line up 1:1, so never explain a Project's category by restating its type. A brand-new Project always starts in "Others" until its owner/curator classifies it.
- **Exposure:** UI-only; not Ember-actionable.
- **Verification:** `src/app/(app)/projects/page.tsx`, `src/components/projects/ProjectCategorySelector.tsx`, `src/lib/workbench/projects.ts` (`updateProjectPortfolioCategory`), `supabase/migrations/20260904120001_project_portfolio_category.sql` + `..._v2.sql`; code verified 2026-09-04. Live-verified as a platform admin: `/projects` renders grouped sections with correct counts, and the per-project selector saves and persists after reload.

### View the organization portfolio (admin/curator)

- **Intent:** Give platform admin/curator a safe, organization-wide view of every Project without granting content access merely by platform role.
- **Users and authority:** Admin and curator only; any other role is redirected to `/projects`.
- **Prerequisites:** Signed-in admin or curator session.
- **Start:** `/projects/portfolio` (linked from `/projects` for eligible roles)
- **Navigation:** Projects → **View Organization Portfolio →**.
- **Outcome:** A table of every Project's safe metadata -- name, type, status, owner, active member count, attached-knowledge-base count, authority-gap and unpublished-draft indicators, last updated. As of 2026-09-01, the row action is role-dependent, not just membership-dependent: an admin viewer always sees "Open workspace" (`is_project_member`'s own `is_admin` bypass already grants them the underlying content regardless of membership -- the table was previously hiding a link they could use anyway). A non-member curator, who has no such bypass, instead sees a one-click "Request membership" button that sends a `project_notes` note to the Project owner. A Project the viewer is an active member of still links straight through, same as before.
- **Ember guidance:** Ember has no dedicated tool for this view; if asked for an organization-wide summary, it should point an eligible user here rather than attempting to enumerate Projects itself.
- **Boundaries:** This view never exposes source titles, snippets, chat history, or artifacts -- only counts and dates computed from a narrow, explicitly safe query (never a service-role content query with UI-side hiding). It is not a bypass into any Project's private content for a curator -- a non-member curator still cannot open the workspace, only request access to it.
- **Exposure:** Not Ember-actionable; a candidate for a future caller-scoped MCP summary limited to the same safe fields.
- **Verification:** `src/app/(app)/projects/portfolio/page.tsx`, `src/lib/projects/portfolio.ts`, `src/components/projects/OrganizationPortfolio.tsx`, `src/components/projects/RequestMembershipButton.tsx`, `src/app/actions/project-notes.ts` (`requestProjectMembershipAction`), `supabase/migrations/20260901120001_project_notes_request_membership.sql`; code verified 2026-08-30, admin-bypass and request-membership behavior verified 2026-09-01. Live-verified with `admin`/`curator` test accounts against real seed data: an admin non-member of a Project still gets "Open workspace" and a fully rendered workspace on click; a non-member curator's "Request membership" click inserts exactly one open `project_notes` row addressed to the owner, survives a page reload as "Request sent" with no way to re-click, and a second click (or a reload-then-click) does not insert a duplicate.

### Browse the Project directory and request to join

- **Intent:** Let any signed-in user find and request access to a Project they're not yet a member of, without exposing its private content, and give the client a real organization entry point instead of a dead end.
- **Users and authority:** Any signed-in non-anonymous user can browse and request. Deciding a request (approve/decline) is the target Project's owner or curator, or a platform admin -- same bar as "Add or invite a member to a Project" below.
- **Prerequisites:** Signed-in session. A Project only appears here if its owner/curator/admin has explicitly set it discoverable (opt-in, default is `members_only`) -- there is no way to browse every Project in the instance.
- **Start:** `/projects/[id]` on the one Project flagged as the Organization Home (for this deployment, "Sandz — Organization Home") -- linked from the Project's own directory section, "Projects at Sandz."
- **Navigation:** Open the Organization Home Project → **Projects at Sandz** section → for a Project the user isn't a member of, **Request to join**; for one they already belong to (or if the viewer is a platform admin), **Open workspace** instead. The requester sees "Request pending" after filing; the Project's owner/curator sees the request under **Pending join requests** on that Project's own page and can Approve or Decline.
- **Outcome:** A pending request creates no membership by itself. Approval adds the requester as an active `viewer` on that Project -- never a higher role, and never platform authority. A genuinely non-discoverable Project stays completely invisible through this path, Ember, search, or direct navigation to a non-member.
- **Ember guidance:** `list_discoverable_projects` returns safe metadata (name/type/objective/status/owner/membership state) for exactly the Projects a user is allowed to know exist; `request_project_membership` files a request for one where `viewerIsMember` is false. Always tell the user their request is pending an owner/curator decision -- never imply it grants immediate access. If asked about a Project not in that list, say it isn't currently discoverable rather than guessing whether it exists.
- **Boundaries:** Never name or describe a non-discoverable Project to a non-member, through Ember or otherwise. A KB attached to a restricted Project may still show that Project's name on `/wiki`'s Knowledge Bases synopsis, but only when that Project is itself discoverable or the viewer is already a member -- see "Find approved guidance" in the Wiki section below.
- **Exposure:** Ember-readable and Ember-actionable (`list_discoverable_projects`, `request_project_membership`); deciding a request is UI-only (`JoinRequestsReview.tsx`), not exposed to Ember.
- **Verification:** `supabase/migrations/20260904140001_project_join_requests.sql`, `src/lib/projects/directory.ts`, `src/lib/projects/join-requests.ts`, `src/components/projects/{ProjectDirectory,RequestToJoinButton,JoinRequestsReview}.tsx`, `src/app/(app)/projects/[id]/page.tsx` (non-member discoverable fallback); code verified 2026-09-04.

### Work inside a project

- **Intent:** Use project-specific sources and knowledge while preserving access boundaries and provenance.
- **Users and authority:** Authorized project owner or member; individual actions may require a project role or named approval authority.
- **Prerequisites:** Access to the selected project.
- **Start:** `/projects/[id]`
- **Navigation:** Projects → select project → choose the relevant workstream, assessment, notes, members, access, governance, publication, or Ember action.
- **Outcome:** Work remains bound to the selected project and its approved evidence.
- **Ember guidance:** When entered through **Ask Assistant about this project**, Ember should preserve the project binding, search only authorized project knowledge plus approved platform guidance, and label citations accordingly. It also gains `list_project_members` and `send_project_note` in this bound state -- see the dedicated entry below.
- **Boundaries:** General unbound chat must not retrieve project-private evidence merely because the user happens to be a project member. Consequential decisions remain human- or authority-approved. As of 2026-08-29, a project or resource classified above the selected model's approved AI-processing sensitivity blocks the turn before any content reaches that model -- Ember explains the block and names the sensitivity tier rather than silently refusing or answering without the restricted evidence.
- **Exposure:** Ember-readable/actionable within the project binding; MCP access must preserve caller identity, project membership, and approval rules.
- **Verification:** Project routes and previously live-verified project-bound retrieval behavior; reviewed 2026-08-29.

### Create a workstream on a project

- **Intent:** Start a new structured body of work (a Workstream) inside an existing Project.
- **Users and authority:** Project owner or curator, or a platform admin -- a plain Project member (e.g. `consultant` Project role) cannot do this, even if their *platform* role is `curator` or `admin` (Project role and platform role are independent; the check is on the Project-scoped role, not the platform one).
- **Prerequisites:** Active membership in the Project with `owner` or `curator` Project role, or platform `admin`.
- **Start:** `/projects/[id]`
- **Navigation:** Project page → the **New Workstream** link (only rendered for an authorized viewer -- it does not appear at all for a plain member) → `/projects/[id]/workstreams/new`.
- **Outcome:** A new draft Workstream on the Project.
- **Ember guidance:** `create_workstream` fails for a caller whose Project role is `consultant` or `viewer`. If you don't know the caller's Project role, check with `list_project_members` before offering this as a ready action. If it fails or isn't available, tell the user their *Project* role (not platform role) needs to be `owner` or `curator`, and that the Project's owner **or curator** can change that on the Members page (`/projects/[id]/members`) -- do not say "click New Workstream" to someone who can't see that link.
- **Boundaries:** Never conflate platform role (`profiles.role`: consultant/curator/admin) with Project role (`project_members.role`: owner/curator/consultant/viewer) -- a platform curator/admin is not automatically a Project curator on any given Project unless separately made a member with that Project role.
- **Exposure:** Ember-actionable (`create_workstream`) and UI (`New Workstream` link), both gated identically.
- **Verification:** `src/app/(app)/projects/[id]/page.tsx` (`canCurateWorkstreams`), `src/lib/workbench/workstreams.ts`, `supabase/migrations/20260810120001_project_members.sql` (`can_curate_project`); code verified 2026-08-31. Added after a live test (`docs/test-reports/2026-08-31-orderlunch-builder-journey.md`, OL-002/OL-003) found Ember offering this action to an unauthorized caller and then, after the resulting failure, giving recovery guidance that named a control the caller couldn't actually see.

### Explore how this Project connects to others (read-only)

- **Intent:** See which other Projects share a knowledge base with the current one, purely through existing attachments -- not a new hierarchy or Organization entity.
- **Users and authority:** Any active member of the current Project; a connected Project only appears if the viewer can also see it.
- **Prerequisites:** Active membership in the Project being viewed.
- **Start:** `/projects/[id]` (Organization Explorer section)
- **Navigation:** Project page → Organization Explorer → each attached knowledge base lists its sources and any other Project also attached to it, one level deep.
- **Outcome:** A read-only, navigation-only tree. Selecting a connected Project opens its own full, independent workspace -- it does not inherit the current Project's members, roles, or access grants (confirmed live: a member's role and business function differ between the root and a connected Project).
- **Ember guidance:** Ember has no dedicated tool for this; it is a page-level visualization only.
- **Boundaries:** No move/attach/detach/rename/delete action exists here. Restricted branches are omitted, never shown as locked placeholders. Never presented as a technical parent/child or Organization concept. Cycles (a Project reachable through two shared knowledge bases) collapse into one expanded node and a reference, never recursive rendering.
- **Exposure:** Not Ember-actionable; page-level only.
- **Verification:** `src/lib/projects/explorer.ts`, `src/components/projects/OrganizationExplorer.tsx`; code verified 2026-08-30.

### Add or invite a member to a Project

- **Intent:** Bring an existing KB Sandbox user onto a Project, or -- as of 2026-09-04 -- create a brand-new account for someone who has never used KB Sandbox and add them in one step. Confirmed model: a Project's curator is usually the department head or trusted assistant actually running that team's work, so this is deliberately not owner-only.
- **Users and authority:** The Project's **owner or curator**, or a platform admin. A plain member/consultant Project role cannot reach this page at all. **Creating a brand-new account is capped by who is doing it**: a platform admin can create an account at any platform role (member/consultant/curator/admin); a Project owner or curator who is *not* a platform admin can only create an account at platform role `member` or `consultant` -- **a curator can never create a new curator or admin account**, no matter what role they try to select. This cap is enforced in application code, not just the database, because minting an account uses a privileged path that bypasses ordinary row-level security.
- **Prerequisites:** Active `owner` or `curator` Project role, or platform `admin`. Self-serve registration is removed platform-wide -- there is no other way for a genuinely new person to get an account.
- **Start:** `/projects/[id]/members`
- **Navigation:** Project page → **Members** link (visible only to an authorized viewer) → enter the person's email and pick a Project role → **Add**. If no account exists for that email, an inline "No account for `<email>` yet" panel appears (visible to an authorized viewer only) offering to create one and add them in the same step -- fill in a password (or use the pre-filled one), pick a capped platform role, and **Create & add**. The generated password is shown once in a confirmation banner; there is no email delivery in this environment, so it must be handed to the new person directly (Slack, in person, etc.).
- **Outcome:** The person becomes an active Project member at the chosen Project role. For a newly created account, they also get a real KB Sandbox login at the platform role the inviter chose (capped as above).
- **Ember guidance:** Ember has no dedicated tool for this -- it is a UI-only workflow. If a user asks Ember to "add" or "invite" someone to a Project, direct them here (or to `/projects/[id]` → Members section for their own Project) rather than attempting it conversationally. If the user asks whether a curator can make someone else a curator or admin, the answer is **no** -- only a platform admin can create a curator or admin account; a curator inviting a genuinely new person can only give them `member` or `consultant`. Do not say a curator can promote someone to owner, either -- that stays owner/admin-only (see "Create a workstream on a project" for the same owner/curator distinction rule).
- **Boundaries:** Never conflate this with the read-only Member Directory (next entry) -- that page cannot add anyone. Never imply the created account is usable before the inviter has actually communicated the password to the new person. Never state or imply a curator-created account could be given curator/admin platform role -- that path is blocked in code even if someone tries.
- **Exposure:** UI-only; not Ember-actionable.
- **Verification:** `src/app/(app)/projects/[id]/members/page.tsx`, `src/components/projects/MembersManager.tsx`, `src/lib/workbench/projects.ts` (`addProjectMember`, `createAndAddProjectMember`), `supabase/migrations/20260903100001_curator_manages_project_members.sql` (`project_members_curate` RLS); code verified 2026-09-04. Live-verified as a non-admin curator persona on a real, Sandz-visible Project: invited an existing member, created a brand-new account capped to `member`/`consultant` (the platform-role selector never offered curator/admin), and confirmed the owner's own row and the `owner` role option stayed completely out of reach.

### See a Project's member directory and send a note

- **Intent:** See who is actively working on a Project and send one of them an addressed note, without needing owner/admin management access.
- **Users and authority:** Any active member of the Project. Distinct from the owner/curator/admin-only Members management page (`/projects/[id]/members`), which adds/removes members and changes roles -- as of 2026-09-03, a Project **curator** (department head running their own team's Project) can manage membership too, not just the owner, including creating an account for someone brand-new (capped to platform role `member`/`consultant`).
- **Prerequisites:** Active membership in the Project.
- **Start:** `/projects/[id]` (Members section)
- **Navigation:** Project page → Members section lists every active member with role and business function → **Send note** on any member other than yourself → prefilled note form at `/projects/[id]/notes`.
- **Outcome:** A compact, read-only roster, plus an addressed Project Note (reusing the existing Project Notes feature -- not a new messaging channel) once sent.
- **Ember guidance:** Ember can answer the same "who's on this project" questions conversationally -- see the next entry.
- **Boundaries:** Only active members appear; a removed member disappears immediately and cannot be addressed. The directory never lists members of a different Project. Not shown to a non-member viewing a published/public Project.
- **Exposure:** UI-only; the equivalent Ember-actionable path is `list_project_members`/`send_project_note` below.
- **Verification:** `src/components/projects/MemberDirectory.tsx`, `src/app/(app)/projects/[id]/notes/page.tsx`; code verified 2026-08-30.

### Ask Ember who's on a Project, or have Ember send a note

- **Intent:** Answer "who's working on this?", "who owns it?", "who handles a specific approval?", or "can I send someone a note?" conversationally, inside a Project-bound Ember conversation.
- **Users and authority:** Any active member, within a conversation already bound to that Project.
- **Prerequisites:** The conversation must have a server-resolved Project binding (opened via **Ask Ember about this Project**, or a Project chosen on the Ember-first home). A general, unbound conversation has neither tool available and cannot enumerate any Project's roster.
- **Start:** Any project-bound Ember conversation.
- **Navigation:** Ask Ember directly -- no page navigation involved.
- **Outcome:** Ember calls `list_project_members` (no Project ID accepted from the model; it is always the conversation's own server-resolved binding) and answers with each active member's role, business function, and any approval responsibility already visible to the caller -- never platform-wide roles, other Projects' memberships, or evidence-access grants. If asked to send a note, Ember first calls `list_project_members` to find the exact recipient, states the exact recipient/subject/body, and waits for the user's explicit confirmation before calling `send_project_note`.
- **Ember guidance:** Fetch fresh every time -- never guess from earlier in the conversation or persist the roster into a saved summary. Project role, business function, and approval responsibility are three separate things and must not be conflated; none of them implies what evidence someone can access.
- **Boundaries:** `send_project_note` re-checks that the recipient is still an active member at call time and reuses the exact same Project Notes storage/RLS as the human Send Note form -- it cannot address a non-member or a member of a different Project. Confirmation before sending is enforced by prompt guidance, not a code-level gate -- the same trust boundary already accepted for every other Ember tool that creates a record (e.g. `create_project`).
- **Exposure:** Ember-actionable, Project-bound only; never offered in general chat.
- **Verification:** `src/lib/chat/project-members-tool.ts`, `src/lib/chat/project-note-tool.ts`; code verified 2026-08-30. Live-verified: asked "who is working on this project, and who handles commercial approval?" against a real Project and got the correct roster and approval responsibilities; separately asked Ember to send a note, confirmed it drafted content and waited for explicit confirmation before calling `send_project_note`, and the resulting note appeared correctly addressed on the Project's Notes page with a working structured link in the Artifacts panel. Also confirmed a general (unbound) conversation never offers or uses `list_project_members`.

### Work together live with another Project member (when enabled)

- **Status:** Implemented 6 October 2026 (shared workspace sessions, Phases 1–3). **Enabled** only where the deployment sets `NEXT_PUBLIC_EMBER_COLLABORATION=true` (the `20261023100001_collaboration_sessions.sql` migration is applied on the live backend as of 6 October 2026) -- off by default. **Verified** locally: database and unit tests, multi-connection race checks, and a two-person, two-browser run of every step below against a local copy of the full schema. Not yet verified on a deployment or between remote locations. If the **Collaborate** button isn't on the Project page, it isn't enabled on this deployment, or a platform admin hasn't turned it on for this Project (Admin → Live collaboration → *Where it's on*); Ember says so if asked to invite someone there.
- **Intent:** Two people at different locations go through a Project's pages together in their own browsers: one person (the controller) moves between the Project page and its Workstream pages and the other's browser follows. Either can ask for control.
- **Users and authority:** Two active members of the same Project (actual membership -- platform admin alone doesn't qualify). The person who invites is the **host** and starts in control.
- **Prerequisites:** Both people are active members of the Project. Each person can be in one live session at a time.
- **Start:** `/projects/[id]` → **Collaborate**, or ask Ember in a Project-bound conversation.
- **Navigation:** **Collaborate** → choose the member → review → **Send invitation**. The invitation lasts an hour; the other person sees it within about 5 seconds in a bar at the top of Ember (or, if Ember is in a background tab, as "(1) Invitation" in the tab title) and selects **Accept** or **Decline**. Once accepted, a live-session bar stays at the top of every page: who's in the session, who's connected, who is **In control**, and what page is shared. The controller opens Project or Workstream pages as usual and the other browser follows. The other person selects **Ask for control**; the controller selects **Give control** or **Decline**. The host can **Take control back** at any time. **Leave** steps out (if the leaver had control and the other person is still there, control passes to them); the host can **End session**. An observer who wanders to another page sees **Follow again**. If the session is open in another of your tabs, use **Use this tab instead**.
- **Editing together:** On the shared Project page, the person in control can edit the **Goal**, **Description** and **Starter prompt**; on a shared Workstream page, its **Summary** and **Deliverables**. Text is a shared draft: the others see it as it's typed, marked "✎ *name* is editing — not saved yet", and the bar lists unsaved drafts. **Save** writes it; **Cancel** drops it. Ticking a deliverable saves straight away. Each person can only edit what their own account may edit (goal: the Project's owner or a platform admin; the rest: owner, curator or admin) -- having control doesn't lend anyone else's rights. If someone changed the field outside the session meanwhile, it shows the saved text and asks: **Keep my text** (then Save) or **Discard my changes**. When control is handed over, any unsaved draft stays for the next person to continue. **End session** warns about unsaved drafts, and they are never saved. Outside a session the ordinary edit forms are unchanged.
- **Viewers:** On the shared conversation's page (or **Add viewers** / **Manage** in the bar), either of the pair can add other active members of the Project as **viewers**, and remove them. A viewer sees the conversation under **History → Shared** ("Viewing: A & B") and its page, read-only. While a session is live, their bar says "A and B are live on *Project* — **Watch**"; watching makes their tab follow the controller between the Project and Workstream pages, with no controls -- **Follow again** if they wander off, **Stop watching** to stop. The pair's bar lists viewers and marks who is watching. Up to 10 can watch at once. Viewers also read the shared Ember chat and comment in it (below).
- **Shared Ember chat (Phase 3, built 6 October 2026; the `20261025100001_collaboration_shared_chat.sql` migration is applied on the live backend as of 6 October 2026):** In a live session, either of the pair selects **Ember chat** in the bar (or opens the shared conversation's page) and asks Ember. Everyone in the conversation -- the pair and its viewers -- sees each question with who asked it, and Ember's answers, which come one at a time in order ("Ember is answering…", "*n* waiting"). Ember answers only while both of the pair are in the live session. If an answer fails, either of the pair selects **Ask again**. Viewers read the chat on the conversation page (select **Refresh** for new messages, or **Watch** a live session to see them as they arrive) and post comments with **Post comment**; Ember doesn't answer a comment unless one of the pair selects **Ask Ember to respond**, and the answer is labelled as answering that viewer's comment, passed on by that person. In this chat Ember only searches the Project's knowledge and answers -- it can't change anything, send notes or invitations, search the web, or use anyone's working knowledge -- and it uses only sources that everyone in the conversation can open. An answer that drew on a source someone can't open shows to them as "Hidden -- this answer drew on sources you can't open", including if their access is removed later. In the shared chat Ember can also list the Project's workstreams and members, and -- when asked -- **propose** a Project note or new text for the goal, description, starter prompt or a workstream summary; the proposal appears under its answer. Either of the pair selects **Review and send** to edit and send the note as themselves; the person in control, on that field's page, selects **Put in shared draft**, then reviews and saves it as usual; **Dismiss** drops a proposal. Long conversations get a **summary of earlier messages** on the conversation page; either of the pair can **Publish as Project note** to the project team. Sending a proposal or publishing the summary is refused if something it drew on can't be opened by every Project member (and proposed field text on a non-private Project must not draw on any source) -- write it yourself then. (Summary and proposals use the `20261027100001_collaboration_shared_chat_tools.sql` migration, applied on the live backend 7 October 2026.)
- **If the connection drops:** the bar says "Connection lost — reconnecting… What you see may be out of date." When the connection is back, the view catches up within a couple of seconds. Control never moves because of a dropped connection; after 90 seconds offline the other person sees "not connected" and may **Take control** (the host can always take it back).
- **Connection check:** in a live session (or while watching), **Connection check** in the bar shows how this browser's connection is doing: how quickly it reaches the server, how many checks failed, how soon the other person's changes reached it, and how long Ember took to answer. **Copy results** copies those figures (no content) for a pilot report; **Start again** resets them.
- **Administrators:** platform admins have **Admin → Live collaboration**: live sessions, problems needing attention and counts for a period (no content). They choose where it's on (**Every Project**, or **Only the Projects below** with Projects turned on one by one; where it's off nobody can start a session, live ones carry on). They can **End session…** (both bars say "An administrator ended the live session"), cancel a stalled Ember answer, reset a note stuck sending and settle overdue sessions; each is recorded. See `docs/guides/shared-workspace-sessions-runbook.md`. (Uses the `20261028100001_collaboration_operations.sql` migration, applied on the live backend 7 October 2026.)
- **Outcome:** Both browsers show the same shared page. The pair gets a shared conversation listed under **History → Shared** in Ember for both people; it lists the live sessions held on it, and **Invite [name] to resume** starts a new live session on the same conversation.
- **Ember guidance:** Ember can invite on the user's behalf: it calls `list_project_members`, then `preview_collaboration_invitation`, tells the user who would be invited and what a live session shares, and only after the user confirms in their next message calls `send_collaboration_invitation` (the code refuses a send in the same turn as the preview). Ember can't accept for anyone, join or control a session, or see what happens in it. In a personal chat, Ember can't see or post in a shared conversation's chat; point the user to **Ember chat** in the session bar or the shared conversation's page.
- **Boundaries:** Only the Project page and its Workstream pages are shared; any other page (members, notes, requirements, admin, journal, personal chat) is never mirrored -- the controller sees "This page isn't shared" there. Each person sees each page with their own access, so the two views can differ where access differs. Voice is not available yet. Nothing from either person's private Ember chats is copied. Control never moves just because someone disconnected; a disconnected person catches up when they return. Someone with no input for 10 minutes shows as **away** (switching to another tab or app counts as no input; a closed tab shows as **not connected** at once). While the person in control is away or not connected, the other person can **Take control** (recorded; the host can always take it back). A session ends on its own after 30 minutes with nobody active, after one person has been inactive for an hour, or after 12 hours -- both bars warn 5 minutes before, with **I'm still here** -- and immediately if either person stops being an active member -- the shared conversation then disappears from both histories until access returns. Nothing is deleted when a session ends.
- **Exposure:** Human UI, plus the two Ember tools above (Project-bound conversations only, and only when enabled). Not exposed through the external MCP server, which can't change sessions.
- **Verification:** `supabase/migrations/20261023100001_collaboration_sessions.sql`, `src/components/collaboration/`, `src/lib/collaboration/`, `src/lib/chat/collaboration-tool.ts`; tests `src/lib/collaboration/database.test.ts`, `src/lib/collaboration/client.test.ts`, `src/lib/chat/collaboration-tool.test.ts`; race checks `scripts/collaboration-concurrency-check.mjs`; two browsers `scripts/local-e2e/collaboration-two-browsers.mjs`. Shared chat: `supabase/migrations/20261025100001_collaboration_shared_chat.sql`, `src/lib/collaboration/shared-turn.ts`, `src/app/api/collaboration/turns/route.ts`, `src/components/collaboration/SharedChat.tsx`; checks `scripts/collaboration-shared-chat-check.mjs`, `scripts/local-e2e/collaboration-shared-chat.mjs`. Code verified 2026-10-06; see `docs/test-reports/2026-10-06-shared-workspace-phase-1.md`, `-phase-2.md` and `-phase-3.md`.

### Manage access and AI-processing sensitivity

- **Intent:** Restrict a source, article, artifact, or the project itself to specific people/groups (human access) and separately control which AI providers may process it (AI-processing sensitivity).
- **Users and authority:** Project owner, or platform admin via the same manage boundary.
- **Prerequisites:** Access to the selected project; owner or admin authority. **Every person or group granted here must already be an active Project member** -- this page cannot add a new person to the project. Add them at the project's **Members** page first if they aren't one yet, then come here to grant them access to a specific restricted resource or the project's own sensitivity tier.
- **Start:** `/projects/[id]/access`
- **Navigation:** Project → **Access & Evidence** → classify a listed resource, or set the project's own sensitivity in the **This project** section → select from existing members/groups → save.
- **Outcome:** A resource or the project gains (or changes) a human-access classification, an AI-processing sensitivity tier, or both -- independently. Restricting human access requires granting at least one *existing* group or named member in the same action -- it does not invite anyone. An unclassified resource or project defaults to Internal for AI-processing purposes, never Public.
- **Ember guidance:** Ember does not perform classification itself; it may explain that a blocked response is due to this policy and direct an eligible user to this page. If the user's goal is actually to add a new person to the project (not grant an existing member access to something restricted), direct them to **Members** instead -- this page only grants access among people already on the project. Ember must not name or describe a resource the current user cannot see.
- **Boundaries:** Human access and AI-processing sensitivity are separate axes -- changing one never implies the other. Project membership and resource-level access grants are separate axes too -- this page is the second one, never the first. All classification and grant changes are recorded in an audit log.
- **Exposure:** Not an Ember-actionable tool; administrative page only, reached via navigation guidance.
- **Verification:** `/projects/[id]/access`, `AccessEvidenceManager.tsx`; code verified 2026-08-29. Confirmed as a real, live Ember mistake in the Sandz onboarding experiment's Run 2 (`docs/test-reports/2026-08-30-ember-sandz-onboarding-experiment.md`) -- she read this entry correctly and still told the user to "invite" someone here, because the entry didn't say membership was a prerequisite until this fix.

### See a Project's attached sources and their metadata

- **Intent:** Let any Project member see what's actually in their Project's attached knowledge base(s) -- title, publisher, current version, and source link -- without asking Ember or needing curator/admin access.
- **Users and authority:** Any active member of the Project, not just owner/curator/admin -- RLS on `knowledge_sources` already scopes each source correctly per-viewer, so a restricted source is simply absent from the list rather than specially hidden.
- **Prerequisites:** Active membership in the Project.
- **Start:** `/projects/[id]`
- **Navigation:** Project page → Knowledge section → each attached knowledge base lists its sources underneath, each linking to its own `/sources/[id]` detail page.
- **Outcome:** A read-only metadata list -- not the source's actual chunked/embedded content, which stays gated to platform curator/admin at `/review/[docId]`.
- **Ember guidance:** Ember can already answer "what's in the KB" conversationally via `search_project_knowledge`/`search_wiki`; this page gives the same metadata a permanent, browsable home so the user doesn't have to ask every time. No new Ember tool -- point a user here if they want to browse rather than ask.
- **Boundaries:** Never confuse this with the actual chunk/document content, which stays curator/admin-only. Never confuse it with the owner/admin-only Access & Evidence page, which manages classification/grants, not just displays metadata.
- **Exposure:** UI-only; not Ember-actionable (Ember already covers the equivalent conversationally via existing search tools).
- **Verification:** `src/lib/projects/queries.ts` (`listSourcesForKnowledgeBases`), `src/app/(app)/projects/[id]/page.tsx`; code verified 2026-09-04. Live-verified as both a platform admin and a `viewer`-role member with no manage rights against the real Sandz Pilot project -- the list rendered identically for both.

### Have Ember research the web for a Project

- **Intent:** Pre-sales/competitive research inside a Project -- checking out a prospective client or a competitor -- when the answer isn't in the Project's own knowledge or the Wiki.
- **Users and authority:** Any active member, within a conversation already bound to that Project. Same authority bar as `search_project_knowledge`/`list_project_members` -- no elevated role required to search, but see Boundaries for who can make a finding real.
- **Prerequisites:** The conversation must have a server-resolved Project binding (a general, unbound conversation never offers this tool). `TAVILY_API_KEY` must be configured on the deployment -- if it isn't, the tool is simply absent from Ember's tool list for every Project conversation, with no error surfaced to the user.
- **Start:** Any project-bound Ember conversation.
- **Navigation:** Ask Ember directly -- no page navigation involved.
- **Outcome:** Ember calls `search_web` (Tavily) and can use the results to answer conversationally. At most 2 calls per turn. If the findings are worth keeping, Ember proposes a `research_dossier` workstream artifact (via `attach_workstream_artifact`, creating a workstream first if the Project has none) summarizing what it found with source URLs as plain links -- landing in the same `ready_for_review` state as any other Ember-created artifact.
- **Ember guidance:** A web result is never treated as verified platform evidence -- it is never cited via `present_assistant_response`'s citations field (that field is reserved for real, server-verified internal retrieval), and Ember must never tell the user something is "in the knowledge base" or "confirmed" from a web search alone. A `research_dossier` artifact is a draft, not an addition to the knowledge base -- it still needs a curator/owner to review and approve it, then a member to **Submit a candidate source for a Project** (below) with it, before it's retrievable.
- **Boundaries:** Read-only and reversible, so unlike the MCP Gateway's side-effecting actions (e.g. the OrderLunch showcase), `search_web` runs freely with no human confirmation gate. Turning a dossier into real Project knowledge still requires the same two human checkpoints as any other member-submitted source: artifact review/approval, then curator/owner decision on the source submission -- nothing this tool does writes into a knowledge base directly.
- **Exposure:** Ember-actionable, Project-bound only, and only when `TAVILY_API_KEY` is configured.
- **Verification:** `src/lib/chat/web-search-tool.ts`, `src/lib/chat/loop.ts` (`WEB_SEARCH_LIMIT`, `buildProjectPromptAddendum`), `supabase/migrations/20260904160001_workstream_artifact_type_research_dossier.sql`; code verified 2026-09-04.

### Submit a candidate source for a Project

- **Intent:** Let an ordinary Project member propose knowledge for their Project -- a file, or an already-approved, content-bearing Ember-generated workstream artifact -- for their curator to decide on, closing the gap where only platform curator/admin could add anything to any knowledge base.
- **Users and authority:** Any active Project member, any Project role (owner/curator/consultant/viewer all qualify -- this is deliberately broader than who *decides* a submission).
- **Prerequisites:** Active membership in the Project. The Project must already have at least one knowledge base attached (Project page → Knowledge section → **Attach a knowledge base**) -- a submission always goes into one of the Project's own attached knowledge bases, chosen by the submitter. For an artifact-kind submission specifically, the artifact must already be `approved` within its own workstream and have inline text content -- a link-only artifact (an external URL with no content) has nothing to submit and will not appear in the picker.
- **Start:** `/projects/[id]` (Knowledge section)
- **Navigation:** Project page → Knowledge section → **Submit a source** → choose **File** (upload, optional citation URL) or **Workstream artifact** (pick from the Project's own eligible artifacts) → pick which attached knowledge base it targets → **Submit for review**.
- **Outcome:** A new `pending` submission the Project's owner/curator/admin can see and decide. **Nothing becomes retrievable by Ember at this point** -- submitting is a proposal, not an addition to the knowledge base.
- **Ember guidance:** Ember has no dedicated tool for this yet -- it is a UI-only workflow. If a user asks Ember to "add" or "upload" a source to their Project, direct them here rather than attempting it conversationally, and be explicit that a curator/owner still has to approve it before Ember can use it in answers. Never tell a user their submission is already searchable -- it is not, until approved.
- **Boundaries:** A member submitting a file has no path into the platform's curator-only `/upload` worklist and cannot bypass this proposal step. Real URL-fetching (submitting a bare link with no file, expecting the system to scrape it) is not supported -- a URL is only ever an optional citation attached to a file. Rejecting a file-kind submission deletes the underlying (never-approved) document; an artifact-kind submission that's rejected leaves the original workstream artifact untouched.
- **Exposure:** Not Ember-actionable; UI only.
- **Verification:** `src/components/projects/SubmitSourceForm.tsx`, `src/lib/workbench/source-submissions.ts` (`submitFileSource`, `submitArtifactSource`), `supabase/migrations/20260904100001_project_source_submissions.sql`; code verified 2026-09-04. Live-verified: a non-admin Project member (consultant Project role) submitted a real file through this exact flow on a disposable test Project and confirmed it appeared as `pending`, not yet retrievable.

### Review and decide a candidate source

- **Intent:** Let the Project's owner/curator/admin approve or reject a member-submitted source before it enters the Project's knowledge base.
- **Users and authority:** The Project's **owner, curator, or admin** -- the same `can_curate_project` bar as workstream creation and membership management, deliberately not owner-only. A plain member/consultant cannot decide their own or anyone else's submission, even though they can see it if they submitted it.
- **Prerequisites:** Active `owner` or `curator` Project role, or platform `admin`; at least one `pending` submission on the Project.
- **Start:** `/projects/[id]` (Knowledge section)
- **Navigation:** Project page → Knowledge section → **Pending sources** list (visible only to an authorized decider) → **Approve** or **Reject** (Reject accepts an optional reason) on the relevant row.
- **Outcome:** **Approve** processes the source for real (parses/chunks a file, or copies an artifact's content into a new document) and embeds every resulting chunk into the Project's knowledge base immediately -- this is the moment the source actually becomes retrievable by Ember, never before. **Reject** discards a file-kind submission's never-approved document entirely (an artifact-kind submission has no document to discard, since its content stays in the original workstream artifact). Approved chunks are auto-approved in bulk rather than needing one-by-one sign-off, but remain individually re-reviewable afterward on the existing curator chunk-review page (`/review/[docId]`) -- a curator or admin can still reject an individual chunk later if it turns out to be wrong.
- **Ember guidance:** Ember has no dedicated tool for this -- it is a UI-only decision. If asked "is my submission live yet," the honest answer requires checking this page's status, not assuming approval happened. Never say a submission was auto-approved without a human decision -- the decision itself (who approved it and when) is always recorded.
- **Boundaries:** Only the Project's own owner/curator/admin can decide -- not a platform curator/admin who isn't actually on this Project, and not the submitter themselves acting alone. Approving or rejecting an already-decided submission is a no-op, not an error, to tolerate a race between two deciders.
- **Exposure:** Not Ember-actionable; UI only.
- **Verification:** `src/components/projects/SourceSubmissionsReview.tsx`, `src/lib/workbench/source-submissions.ts` (`approveSourceSubmission`, `rejectSourceSubmission`), reuses `src/lib/curator/chunks.ts` (`approveChunk`) unmodified; code verified 2026-09-04. Live-verified: a project owner approved a real member-submitted file and confirmed the resulting chunk was genuinely embedded (present in `kb_vectors` with the expected auto-approval marker) and separately visible/re-reviewable on `/review/[docId]`.

### What counts as Project knowledge (for Ember's answers)

- **Intent:** Understand which material Ember treats as this Project's own evidence.
- **Users and authority:** Every Project member; curators decide what gets added.
- **Outcome:** Project knowledge = approved chunks of sources in knowledge bases attached to the Project **or to one of its workstreams**, plus approved Wiki articles attached to the Project. Workstream artifacts (research dossiers, findings, test results), working knowledge, Project notes and web results are not Project knowledge until an artifact is submitted as a source and approved.
- **Ember guidance:** When asked why Ember couldn't answer, explain this rule and point to **Submit a source** (or submitting an approved artifact from its workstream page), then curator approval and chunk approval. Never present working knowledge or web results as Project evidence.
- **Boundaries:** Retrieval is RAG over approved, embedded chunks under the caller's own access; restricted sources stay hidden from members without a grant.
- **Verification:** Code verified 2026-10-05.

### Record and read a Project's requirements

- **Intent:** Know what the Project's delivered solution must satisfy and where each requirement comes from; (curators) record and maintain them.
- **Users and authority:** Every Project member reads. Project owners/curators and platform admins create and edit drafts, withdraw, and delete drafts.
- **Prerequisites:** Project membership.
- **Start:** `/projects/[id]/requirements`, or the Project page's **Requirements** section.
- **Navigation:** Project → **Requirements** → **Open the requirements register** → a requirement. Curators: **New requirement**; on a draft, **Edit**, **+ Add a source**, **Change scope**, **+ Add a verification method**, **Withdraw**, **Delete draft**.
- **Outcome:** A requirement with code, statement, category, priority and the stage it must be verified from; its sources (standard, regulation, contract, customer need, vendor claim) with clause locators and links into Project knowledge; the workstreams and objects it concerns; verification methods with pass criteria.
- **Ember guidance:** Explain the register and link to it. Ember can draft requirements from Project knowledge when a curator asks (see **Ask Ember to draft requirements or report on them**); it cannot edit, baseline or withdraw them. A vendor claim is a claim to verify, never evidence that a requirement is met. AI evaluation scores (`/evals`) are not evidence of solution conformance.
- **Boundaries:** Only drafts can be edited; withdrawn requirements stay readable and cannot be reopened. Sources citing restricted evidence are hidden from people without a grant.
- **Exposure:** Read-only candidate for MCP; writing stays a UI action.
- **Verification:** Code verified 2026-10-05 (solution conformance, Stage 1); SQL behaviour checked against a local Postgres with stub tables.

### Record verification results for a requirement

- **Intent:** Record whether a requirement was shown to be met — by test, demonstration, inspection, analysis, vendor evidence or operational measure — with the evidence; see where verification stands.
- **Users and authority:** Every Project member reads results. The Project's owner, curators and consultants, and platform admins, record and correct them. Viewers can't record.
- **Prerequisites:** Project membership; the requirement has a verification method; for a pass, the evidence (test results, evidence map, findings) is attached as an artifact to one of the Project's workstreams.
- **Start:** a requirement at `/projects/[id]/requirements/[requirementId]`.
- **Navigation:** Project → **Requirements** → **Open the requirements register** → a requirement → under a method, **Record result**; in **Verification history**, **Correct** on a record.
- **Outcome:** A record with result (pass, fail, conditional pass with conditions, not run, not applicable with rationale), environment, build or component versions, configuration reference, date, observations, issue reference and evidence artifacts. The method shows its current result; the register shows each requirement's verification status and passed/failed/not-verified counts.
- **Ember guidance:** Explain how to record a result and link to the requirement. Ember cannot record results or mark a requirement as passed. A pass needs evidence artifacts — a statement that something works is not evidence. A vendor claim is not a result. AI evaluation scores (`/evals`) are not evidence of solution conformance.
- **Boundaries:** Records can't be edited or deleted; a correction supersedes a record once and both stay readable. Withdrawn and superseded requirements take no new results. A requirement with results can't be deleted, only withdrawn. Evidence citing a restricted artifact is hidden from people without a grant.
- **Exposure:** Read-only candidate for MCP; recording stays a UI action.
- **Verification:** Code verified 2026-10-05 (solution conformance, Stage 2); SQL behaviour checked against a local Postgres with stub tables.

### Baseline requirements and make conformance decisions

- **Intent:** Fix the requirements an acceptance or go-live decision is made against, accept known gaps explicitly, and record who approved the decision and on what evidence.
- **Users and authority:** Every Project member reads. Project owners/curators and platform admins create, activate and version baselines and request decisions. Owners, curators and consultants request waivers. Only members holding the decision's or waiver's approval authority (assigned on the Project's governance page) approve or reject — platform admin status alone does not count.
- **Prerequisites:** Requirements with verification methods; for approval, approval authorities assigned to the right people (e.g. customer acceptance to the customer representative); optionally an approval policy setting how many approvals are needed and whether self-approval is allowed.
- **Start:** `/projects/[id]/requirements/baselines`, or **Baselines and decisions** on the requirements register.
- **Navigation:** Requirements → **Baselines and decisions** → **New baseline** (curators) → choose requirements → **Activate**. On an active baseline: **+ Request a waiver or deviation**, **+ Request a decision**, **Create a new version**; authority holders see **Approve** / **Reject**. On a baselined requirement: **Supersede with a new version**.
- **Outcome:** A frozen, versioned baseline with each requirement's live status (passed, failed, conditional, waived, not yet verified); waivers with rationale and approver; decisions with each approver's verdict, notes and conditions, and the roll-up they rested on.
- **Ember guidance:** Explain baselines, waivers and decisions and link to them. Ember cannot activate baselines, approve waivers or decisions, or mark requirements as passed. A decision is approved only by people holding the assigned authority; suggest the Project owner assign it on the governance page if nobody holds it. Once decided, a decision's roll-up does not change even if later results do.
- **Boundaries:** Active baselines can't be edited — create a new version. Decided waivers and decisions can't change. No self-approval by the requester, or by anyone who recorded the evidence, unless the policy and the approver's assignment both allow it. Re-verification after changes: see **Re-verify requirements after a change**.
- **Exposure:** Read-only candidate for MCP; every write stays a UI action.
- **Verification:** Code verified 2026-10-06 (solution conformance, Stage 3); SQL behaviour checked against a local Postgres with stub tables.

### Re-verify requirements after a change

- **Intent:** Know which requirements no longer hold after a change, re-verify them, and keep production changes from being approved until they are.
- **Users and authority:** Every Project member reads. Owners, curators and consultants (and platform admins) record changes. Owners and curators resolve a flag without re-verifying (with a reason) and set review schedules.
- **Prerequisites:** Requirements with verification methods; for preselection, requirements scoped to Project objects (components) or workstreams.
- **Start:** `/projects/[id]/requirements/changes`, or **Changes** on the requirements register.
- **Navigation:** Requirements → **Changes** → **Record a change** (kind, what changed, versions, component or workstream, confirm the affected requirements). On a requirement: the *Re-verification due* panel → record new results under each method, or **Resolve without re-verifying**; **Set a review schedule**.
- **Outcome:** Affected requirements show *Re-verify* until each method has a new result (not *not run*) or a curator resolves the flag. New versions of cited sources and operational measures recorded as failing are flagged automatically; review schedules flag requirements when they are overdue.
- **Ember guidance:** Explain why a requirement needs re-verification and link to it. Ember cannot record changes, results or resolutions. A production-change decision can't be approved while anything in its baseline needs re-verification. Earlier results and decisions remain as they were — they describe the solution as it was then.
- **Boundaries:** Only open requirements of the Project can be flagged. Resolving needs a reason. Nothing about past results, baselines or decisions changes.
- **Exposure:** Read-only candidate for MCP; every write stays a UI action.
- **Verification:** Code verified 2026-10-06 (solution conformance, Stage 4); SQL behaviour checked against a local Postgres with stub tables.

### Ask Ember to draft requirements or report on them

- **Intent:** Turn a standard or contract in the Project's knowledge into draft requirements with cited clauses, and ask what's open, failed, missing evidence or due for re-verification.
- **Users and authority:** Any Project member can ask Ember for requirement status (it only sees what they can see). Only Project owners/curators and platform admins can have Ember create draft requirements or add verification methods. Only a curator can accept an Ember draft.
- **Prerequisites:** A Project conversation; for drafting, the source (e.g. the NENA standard) in the Project's or a workstream's knowledge base, or a Wiki article attached to the Project.
- **Start:** Ember chat in the Project, e.g. "Draft requirements for the K-Safety workstream from the NENA i3 standard" or "What's still missing evidence in K-Dispatch?"
- **Navigation:** Ember shows the drafts in its reply (code, statement, source and clause, methods) → confirm or ask for changes → Ember creates them → each appears in the register as *Ember draft · awaiting acceptance* → a curator reviews it on the requirement page and clicks **Accept draft**.
- **Outcome:** Draft requirements marked as drafted by Ember, citing their clauses and linked sources, with any verification methods; not in any baseline and not verified. Status answers list each requirement's verification status, methods missing evidence and re-verification flags, with links.
- **Ember guidance:** Search the Project's knowledge first and cite each clause; never invent a clause or figure. Show the drafts and wait for explicit confirmation before creating them. Afterwards say they await a curator's acceptance. Ember can never record a result, mark a requirement as passed, waive, baseline, or request or approve a decision — say these are human decisions and link the page.
- **Boundaries:** An Ember draft can't be added to a baseline until a curator accepts it (the database enforces this and records who accepted it). Ember only drafts into its own conversation's Project. Restricted sources and evidence stay hidden from Ember exactly as from the asking user.
- **Exposure:** Chat tools only (`list_requirement_status`, `create_draft_requirements`, `add_verification_methods`); not in the external MCP registry.
- **Verification:** Code verified 2026-10-06 (solution conformance, Stage 5); SQL behaviour checked against a local Postgres with stub tables.

### See or assess Ember readiness for a Project

- **Intent:** Know how far to rely on Ember for this Project, and (curators) record that judgement.
- **Users and authority:** Every active Project member, viewers included, sees it. Project owners/curators and platform admins assess it.
- **Prerequisites:** Project membership. The measured score needs a completed admin eval run on a dataset attached to the Project.
- **Start:** `/projects/[id]#ember-readiness`, or the dashboard's **Ember readiness** table.
- **Navigation:** Open the Project → **Ember readiness** section. From the dashboard, select the Project's name in the **Ember readiness** table. Curators: **Assess readiness** / **Update readiness** in the section.
- **Outcome:** A verdict (*Ready*, *Needs more sources* or *Not assessed*), the curator's confidence with reason, author, date and review date, the measured score (questions passed of questions asked, dataset, run date), knowledge coverage (sources, searchable sources, Wiki articles, last source added), *review due* and disagreement notices, earlier assessments, and (curators) links to the Project's test-question datasets.
- **Ember guidance:** Explain the two signals and that they are deliberately separate; link to the section. Ember cannot set or change readiness. If a user says Ember could not answer from Project knowledge, point them to **Report a problem** under the answer.
- **Boundaries:** Assessments are append-only; each save adds to the history. Members see counts, never individual test results. The measured score at the time of an assessment is recorded server-side.
- **Exposure:** Read-only candidate for MCP; assessing stays a UI action.
- **Verification:** Code verified 2026-10-05 (Ember Readiness, Stage 2); SQL behaviour checked against a local Postgres with stub tables.

### Report an Ember failure, and work the knowledge-gap queue

- **Intent:** Tell the Project's curators that Ember got something wrong or couldn't answer, so the missing knowledge gets added; (curators) close those gaps.
- **Users and authority:** Any active Project member reports, and sees their own reports. Project owners/curators and platform admins see and work every gap for the Project. Other members see only the open count.
- **Prerequisites:** Project membership. **Report a problem** appears only in a Project-bound conversation.
- **Start:** **Report a problem** under an Ember answer in a Project conversation, or `/projects/[id]#knowledge-gaps`.
- **Navigation:** In the chat, under the answer → **Report a problem** → choose what was wrong → **Send to curators**. Without the answer to hand: open the Project → **Knowledge gaps** → **Report something Ember got wrong**. Curators: **Knowledge gaps** → **Triage**, **Resolve**, **Make it a test question** or **It's an Ember problem**. **Resolve** lists sources from the Project's and its workstreams' knowledge bases, marking those not yet searchable, and **The source isn't listed?** walks through submitting a source or an approved workstream artifact, approving it, and having its chunks approved.
- **Outcome:** A gap in the Project's queue with the question, Ember's answer, its sources and the model (from the stored conversation), the kind of failure and anything the reporter added; a note to every Project owner/curator. Gaps Ember detects itself join the same queue as *Detected by Ember*, grouped when the same question recurs (*Asked N times*, other wordings, details people added); curators get a note for a new one and at 3, 10 and 25 occurrences. When resolved (or closed as out of scope or duplicate) the reporter gets a note. A promoted gap becomes a draft test question in the Project's draft dataset; *It's an Ember problem* files a platform feedback report and closes the gap.
- **Ember guidance:** When a user says an answer was wrong or missing, point them to **Report a problem** under that answer. Ember does not triage reports. In a Project conversation, Ember itself files a knowledge gap when it can't answer from the Project's knowledge (its `knowledgeCoverage` declaration); the user then sees a notice under the answer with **Add details** and **Don't send** -- don't also ask them to report it.
- **Boundaries:** What was reported can't be edited and gaps are never deleted. Reports go to the Project's curators, never the platform feedback board unless a curator converts one. Five or more open gaps mark the Project's readiness *review due*.
- **Exposure:** Not exposed over MCP; external tokens cannot write the table.
- **Verification:** Code verified 2026-10-05 (Ember Readiness, Stages 3 and 4); SQL behaviour checked against a local Postgres with stub tables.

### Configure a Project's Ember starter prompt

- **Intent:** Give a Project a short, clickable suggestion Ember offers to anyone starting a fresh conversation bound to it -- e.g. "Ask anything about the Sandz pilot, suggest an improvement, or report a problem" for a Q&A-style Project.
- **Users and authority:** The Project's **owner, curator, or admin** -- same `can_curate_project` bar as membership management and source review, not owner-only.
- **Prerequisites:** Active `owner` or `curator` Project role, or platform `admin`.
- **Start:** `/projects/[id]`
- **Navigation:** Project page → **+ Add a starter prompt for Ember** (or **Edit**, if one is already set) → type the prompt → **Save**.
- **Outcome:** The saved text appears as a clickable suggestion in Ember whenever someone opens a *new* conversation bound to this Project -- confirmed to appear for a first-time Ember user, a returning user's "Welcome back" state, and the plain empty-conversation state alike, not just one of them.
- **Ember guidance:** Ember has no dedicated tool for this -- it is a UI-only setting. If a user asks how to change what Ember suggests when someone opens their Project, direct them here.
- **Boundaries:** This only affects the *suggestion chip* shown before a conversation starts -- it is never injected as a hidden instruction or system prompt, and does not change what evidence Ember can retrieve or what it's allowed to say.
- **Exposure:** Not Ember-actionable; UI only.
- **Verification:** `src/components/projects/ProjectStarterPromptForm.tsx`, `src/lib/workbench/projects.ts` (`updateProjectStarterPrompt`), `supabase/migrations/20260904110001_project_starter_prompt.sql`; code verified 2026-09-04. Live-verified on a real Project: set the prompt, confirmed the clickable chip rendered in all three empty-conversation states described above, then cleared it back to unset.

## 4. Wiki

### Find approved guidance

- **Intent:** Locate reusable platform guidance or authorized project knowledge.
- **Users and authority:** Signed-in users; article visibility and project membership determine results.
- **Prerequisites:** Signed-in session; project membership for private project articles.
- **Start:** `/wiki`
- **Navigation:** Open **Wiki** → search or filter by category, status, or project → select an article.
- **Outcome:** The user sees the approved version and available provenance, relationships, and source links they are authorized to access.
- **Ember guidance:** Ember may search approved Wiki content, summarize it with citations, and offer an authorized article link.
- **Boundaries:** Platform admin or curator status does not automatically grant access to approved private customer knowledge. Ember must not reveal the existence, title, excerpt, or source of inaccessible private articles. As of 2026-09-04, `/wiki`'s "Knowledge bases" synopsis section shows every active/approved KB's name and description to any signed-in user, plus which of the *viewer's own* Projects have it attached (a real link, no longer a dead end) -- for a KB scoped to a specific Project, it also names that Project (and its owner) only when the Project is itself discoverable or the viewer already belongs to it, never otherwise.
- **Exposure:** Ember-readable; strong candidate for MCP read access with visibility enforcement.
- **Verification:** `/wiki`, `/wiki/[slug]`, project visibility controls; code verified 2026-08-28, KB synopsis fix verified 2026-09-04.

### Create or curate Wiki knowledge

- **Intent:** Convert reviewed evidence or manual expertise into governed, reusable guidance.
- **Users and authority:** Curator or admin for authoring and review functions; final approval follows the configured workflow.
- **Prerequisites:** Appropriate role and, for project-private knowledge, an authorized project link.
- **Start:** `/wiki/new` or an editable article at `/wiki/[slug]/edit`.
- **Navigation:** Create or edit draft → attach sources/projects as appropriate → submit/review → approve or return for changes.
- **Outcome:** A versioned Wiki article; approved content becomes retrievable within its visibility boundary.
- **Ember guidance:** Ember may explain the workflow and draft content where supported, but must distinguish drafting from approval or publication.
- **Boundaries:** Attach a project before narrowing an article to project-only visibility. Approval and visibility changes are consequential, authority-gated actions.
- **Exposure:** Draft assistance may be Ember-actionable; approval should remain authority-gated and excluded from broad external MCP access.
- **Verification:** Wiki routes and curation components; code verified 2026-08-28.

## 5. Blog

### Draft and submit an article

- **Intent:** Prepare public-facing material based on reviewed ideas without turning KB Sandbox into a full content-management system.
- **Users and authority:** Curator and admin can access `/contribute/blog`; only admin publishes.
- **Prerequisites:** Curator or admin role.
- **Start:** `/contribute/blog`
- **Navigation:** Open **Blog** (`/blog`) → **My drafts** (shown only to curator/admin) → **New draft** → write or import initial content → edit/preview → save → submit for review.
- **Outcome:** A private draft or submitted article. It is not publicly visible until an admin publishes it.
- **Ember guidance:** Ember may explain the authoring and review process and navigate eligible users to the contributor area. It must not offer the contributor route to an ineligible user as if access were available.
- **Boundaries:** Contributors cannot edit another author's draft through guessed URLs. Submission locks curator editing until an admin returns the article to draft. Publishing and unpublishing are admin-only.
- **Exposure:** Draft preparation may be Ember-assisted; publishing is authority-gated and not a general MCP action.
- **Verification:** `/contribute/blog` route gate and the `My drafts` link on `/blog`; code verified 2026-08-28. (Until 2026-08-28, the top-nav "Blog" link itself pointed curator/admin straight at `/contribute/blog`'s own-drafts-only view instead of the public listing -- fixed the same day, see the next entry.)

### Read published articles

- **Intent:** Read public articles and share their canonical links.
- **Users and authority:** Anyone -- anonymous visitors and every signed-in role see the identical list of published articles; there is no author-scoped or role-scoped narrowing on this page.
- **Prerequisites:** The article is published.
- **Start:** `/blog`
- **Navigation:** Open **Blog** in the top nav (now unconditional for every signed-in role, not just curator/admin) → select a published article → `/blog/[slug]`.
- **Outcome:** Public article with its approved presentation and metadata.
- **Ember guidance:** Ember may link to a relevant published article as a citation or recommended reading. KB Sandbox navigation links should not be collected as user artifacts merely because Ember used them for navigation.
- **Boundaries:** Draft and unpublished articles return no public content.
- **Exposure:** Public MCP/resource candidate; read-only.
- **Verification:** Public Blog routes; code verified 2026-08-28. Fixed the same day: the top-nav "Blog" link was curator/admin-only and pointed at `/contribute/blog` (an own-drafts-only view), so a signed-in curator/admin saw fewer posts than an anonymous visitor, and a plain consultant had no Blog nav link at all. `Header.tsx`'s Blog link now always points here for every signed-in role; `/contribute/blog` is reached via a "My drafts" button shown only to curator/admin on this page.

## 6. Trending

### Examine and discuss emerging material

- **Intent:** Share external material worth examining before deciding whether it should become governed knowledge.
- **Users and authority:** Signed-in users may view and submit within applicable access rules; curator/admin perform curation actions.
- **Prerequisites:** Signed-in session.
- **Start:** `/trending`
- **Navigation:** Open **Trending** → filter by tag or select an item; choose **Submit to Trending** to add material.
- **Outcome:** External material can be discussed, tagged, associated with a project, reviewed, archived, or promoted into a Wiki draft.
- **Ember guidance:** Ember should describe Trending as an intake and discussion area, not as an authoritative knowledge base. It may navigate to an item the user may access.
- **Boundaries:** A Trending item is not approved evidence merely because it was submitted. Promotion creates or updates a draft and still requires Wiki review/approval.
- **Exposure:** Ember-readable; submission could be a confirmed MCP action. Promotion and moderation are authority-gated.
- **Verification:** Trending routes and curation actions; code verified 2026-08-28.

## 7. Explore

### Evals

- **Intent:** Check whether Ember (or an Agent) finds the right evidence and answers correctly, using datasets of test questions with known answers and sources.
- **Users and authority:** Platform admins run evaluations (including draft datasets), read runs and results, mark baselines and record human review. Platform curators, and Project curators for their own Project's dataset, create datasets and author draft cases, and activate or archive datasets. Consultants and viewers have no evaluation access.
- **Start:** Admin → **Ember readiness** (admin), or `/evals`.
- **Navigation:** Admin: **Admin** → **Ember readiness** for every dataset's latest run, or Explore → **Evals**. Curator: open the Project and follow its dataset link under **Evals**, or go to `/evals` (datasets only, no runs). The Agent page's **Run evaluation suite** button is admin-only.
- **Outcome:** An admin sees per dataset the Project, number of questions, latest completed run (Hit@K, outcome score), results awaiting review, and failed runs; a curator sees and edits the dataset's test questions.
- **Ember guidance:** Explain what evals measure and send curators to their dataset to add test questions. Do not offer to run an evaluation or show results to anyone but a platform admin.
- **Boundaries:** Once a dataset leaves draft its cases are frozen (RLS). Run, baseline and review writes are admin-only in both the Server Actions and RLS (`20261012100001_eval_operations_admin_only.sql`); `/evals/runs/*` redirects non-admins to `/dashboard`.
- **What evals measure:** Evals measure Ember and Agents (whether answers retrieve the right evidence and stay grounded), not a Project's delivered solution. Ember should not describe an eval score as evidence that a client system conforms to a standard.
- **Exposure:** Results are candidates for admin read access only; running evaluations stays a UI action.
- **Verification:** Code verified 2026-10-05 (Ember Readiness, Stage 1). Detailed workflows remain to be catalogued.
- **Solution evaluation is separate:** `docs/dev-request-solution-conformance-and-acceptance-evaluation.md` is the Project's **Solution evaluation** area — the requirements register, verification records, baselines and conformance decisions, and re-verification (see **Record and read a Project's requirements**, **Record verification results for a requirement**, **Baseline requirements and make conformance decisions**, **Re-verify requirements after a change** and **Ask Ember to draft requirements or report on them**). An eval score is never evidence that a delivered solution conforms. If a user says Ember got something wrong or could not answer from Project knowledge, point them to **Report a problem** under the answer (see **Report an Ember failure** below).

### Graphs

- **Intent:** Inspect how bounded agents, tools, deterministic operations, evidence, guardrails, and human gates are connected.
- **Start:** `/graphs`
- **Navigation:** Explore → **Graphs** → select a graph.
- **Ember guidance:** Explain that a visualization describes a flow; it does not by itself authorize execution or prove that every node is an AI agent.
- **Exposure:** Read-only visualization candidate.
- **Verification:** Header and graph routes; code verified 2026-08-28. Detailed workflows remain to be catalogued.

### Agents

- **Intent:** Discover and use available KB Sandbox agents.
- **Start:** `/agents`
- **Navigation:** Explore → **Agents** → select an agent; Ember has a dedicated entry at `/agents/workbench-assistant`.
- **Ember guidance:** Distinguish KB Sandbox-native agents from external registered agents and from Workbench Methods.
- **Exposure:** Agent metadata may be readable; execution requires each agent's own tool, data, identity, and confirmation controls.
- **Verification:** Header and agent routes; code verified 2026-08-28. Detailed workflows remain to be catalogued.

### Agent Registry (external)

- **Intent:** Record and inspect externally implemented agents as governed, versioned specifications.
- **Users and authority:** Signed-in non-anonymous users, subject to registry controls.
- **Start:** `/agent-registry`
- **Navigation:** Explore → **Agent Registry (external)**.
- **Ember guidance:** Clarify that registration or visualization does not mean the external agent is hosted by, trusted by, or executable through KB Sandbox.
- **Exposure:** Registry metadata is a candidate for controlled read access; external invocation is separately designed and authorized.
- **Verification:** Header and registry routes; code verified 2026-08-28. Detailed workflows remain to be catalogued.

## 8. Builders and the agency

In the Builder edition the platform owner (admin) is every builder's agency. A builder's workspace is their sales funnel: each client proposal is a Workstream, and an accepted one becomes a paid client Project. The public overview is the Builder's Journey page, `/builders`.

### Read the Builder's Journey

- **Intent:** Understand how builders work with Ember and get paid, before or after joining.
- **Users and authority:** Anyone; no sign-in.
- **Prerequisites:** None.
- **Start:** `/builders` (header **Builder's Journey**; also linked from the landing page and `/register`).
- **Navigation:** Open the page; **Request builder access** leads to `/register`.
- **Outcome:** The stages, how promotion works, how fees are split, and what Ember gives at each stage.
- **Ember guidance:** Link to `/builders` for questions about the builder programme in general; use the entries below for how to do a specific step.
- **Boundaries:** Describes the programme; contract-value commission is negotiated with Ember case by case and is not recorded in the app.
- **Exposure:** Public page.
- **Verification:** `src/app/(public)/builders/page.tsx`; code verified 2026-10-07.

### Request promotion of a workstream to a client project

- **Intent:** Turn an accepted client proposal (a Workstream) into its own client Project.
- **Users and authority:** On a builder's Project (their workspace, or a client Project they built), only its **builder of record**; the platform admin on any Project. On other Projects, any active member submits as before.
- **Prerequisites:** The Workstream is completed, has at least one approved artifact, and has no pending or approved promotion. The builder must confirm **My client has agreed to this project**.
- **Start:** `/projects/[id]/workstreams/[workstreamId]`
- **Navigation:** Workstream page → **Proposal accepted? Request a client project** → optional client emails and maintenance fee → tick **My client has agreed to this project** → **Request client project**. The platform admin sees **Create client project** instead.
- **Outcome:** A pending request for the agency, or, for the platform admin's own work, a client Project created at once. The new Project is owned by the builder, its builder of record, with the agency as curator and the client people as viewers; only approved artifacts are copied. It records who found the client: the platform admin's own work is Ember-found, a builder's proposal builder-found, and more work on an existing client Project keeps that Project's source.
- **Ember guidance:** Ember has no tool for this; direct the builder to the Workstream page. Explain that the client must have agreed first and that the agency approves it.
- **Boundaries:** A builder invited onto someone else's Project cannot request promotion of that builder's work. Only the builder of record is paid for the new Project; sharing with invited builders is up to them.
- **Exposure:** UI only.
- **Verification:** `src/lib/workbench/workstream-promotions.ts`, `src/components/projects/WorkstreamPromotionForm.tsx`, `supabase/migrations/20261028100001_builder_edition_agency_rules.sql`; code verified 2026-10-07.

### Decide a builder's promotion

- **Intent:** The agency approves or rejects a builder's request for a client Project.
- **Users and authority:** The builder's agency or the platform admin. Never the submitter, and never another curator on the builder's Project (for example a builder they invited).
- **Prerequisites:** A pending promotion.
- **Start:** `/agency` (the builder's card, **Waiting for a client project**), or the Project page's pending promotions.
- **Navigation:** Builder card → review the request → **Approve** or **Reject** (with an optional reason).
- **Outcome:** Approval creates the client Project and records its maintenance fee, split for who found the client. Rejection leaves the Workstream where it was.
- **Ember guidance:** UI only; tell builders their request waits on the agency.
- **Boundaries:** The database enforces who may decide.
- **Exposure:** UI only.
- **Verification:** `src/lib/workbench/workstream-promotions.ts` (`requirePromotionDecider`), `supabase/migrations/20261028100001_builder_edition_agency_rules.sql`; code verified 2026-10-07.

### Set how a client's maintenance fee is split

- **Intent:** Decide what Ember and the builder each receive from a client's maintenance fee.
- **Users and authority:** The platform admin sets the defaults and each builder's own rates; the builder's agency or the admin adjusts a single Project's fee. Builders see their own shares on their profile.
- **Prerequisites:** Only a Project created by an approved promotion can have a fee.
- **Start:** `/agency`
- **Navigation:** Top of the page: **Ember's cut when the builder found the client** and **Builder's share when Ember found the client** (defaults) → **Save**. Each builder card: the same two figures for that builder (blank uses the default). Each client Project row: edit the fee and the builder's share.
- **Outcome:** Ember's share and the builder's share add up to 100%. Builder-found: Ember takes its cut and the builder keeps the rest. Ember-found: the builder gets their share and Ember keeps the rest. A fee records its split when created; later rate changes apply to new paid Projects only.
- **Ember guidance:** Ember cannot change fees; direct the admin to `/agency`.
- **Boundaries:** Ember records figures for invoicing and never charges anyone. Contract-value commission is negotiated outside the app.
- **Exposure:** UI only.
- **Verification:** `src/lib/workbench/client-billing.ts`, `src/components/agency/{PlatformRateForm,BuilderRatesForm,ClientFeeEditor}.tsx`, `supabase/migrations/20261029100001_client_source_and_workstream_limits.sql`; code verified 2026-10-07.

### Assign a builder to a project Ember found

- **Intent:** Choose who builds and maintains a client Project whose client Ember found.
- **Users and authority:** Platform admin only.
- **Prerequisites:** The Project records the client as Ember-found (the admin promoted it from their own work).
- **Start:** `/projects/[id]/members`
- **Navigation:** Members page → **Builder for this Ember-found client** → choose a builder → **Assign**.
- **Outcome:** The builder becomes the Project's builder of record and a curator, the Project follows the builder rules, and its fee is re-split at that builder's share for Ember-found clients.
- **Ember guidance:** UI only.
- **Boundaries:** Not offered on builder-found Projects.
- **Exposure:** UI only.
- **Verification:** `src/lib/workbench/project-builder.ts`, `src/components/projects/AssignProjectBuilderForm.tsx`; code verified 2026-10-07.

### Ask for more workstreams

- **Intent:** A builder whose workspace is full asks for room for more proposals.
- **Users and authority:** The builder asks; the platform admin approves or declines.
- **Prerequisites:** The builder's own workspace holds 20 workstreams by default. Workstreams in client Projects created by promotion don't count, and admins aren't limited.
- **Start:** `/projects/[id]/workstreams/new` on the workspace; the admin decides on `/agency`.
- **Navigation:** New Workstream page shows how many are used; at the limit → enter the total needed and a reason → **Request more workstreams**. Admin: `/agency` → **Workstream limit requests** → **Approve** or **Decline**, with an optional note.
- **Outcome:** Approval raises that builder's limit to the number they asked for. One open request per builder at a time.
- **Ember guidance:** If creating a workstream fails with "Workstream limit reached", explain the limit and direct the builder to the New Workstream page to ask for more.
- **Boundaries:** A database trigger enforces the limit on every way a workstream is created (form, Ember, wizard, cloning, Methods).
- **Exposure:** UI only; Ember's `create_workstream` is subject to the same limit.
- **Verification:** `src/lib/workbench/workstream-limits.ts`, `src/components/projects/WorkstreamAllowanceNotice.tsx`, `src/components/agency/WorkstreamLimitRequestsReview.tsx`, `supabase/migrations/20261029100001_client_source_and_workstream_limits.sql`; code verified 2026-10-07.

### Choose which knowledge bases a builder can see

- **Intent:** Give a builder access to knowledge bases curated for their work, including project-only ones they could not attach themselves.
- **Users and authority:** Platform admin only.
- **Prerequisites:** An active knowledge base; the user is a builder (platform role `consultant`).
- **Start:** `/agency` (or the **Assigned KBs** checkboxes on `/admin`, which do the same for builders).
- **Navigation:** Builder card → **Knowledge bases this builder can see** → tick or untick → **Save**.
- **Outcome:** Each ticked knowledge base is attached to the builder's workspace, labelled **Assigned by Ember** on the Project page, so the builder and Ember in that workspace can use its sources and articles. Unticking removes only assigned attachments, never ones the builder added.
- **Ember guidance:** If a builder asks for access to a knowledge base, tell them the platform owner assigns it from `/agency`.
- **Boundaries:** The builder cannot detach an assigned knowledge base; the database allows only the admin to add or remove one. Anyone else the builder invited to their workspace also sees it.
- **Exposure:** UI only.
- **Verification:** `src/lib/workbench/builder-knowledge-bases.ts`, `src/components/agency/BuilderKnowledgeBasesForm.tsx`, `supabase/migrations/20261030100001_builder_assigned_knowledge_bases.sql`; code verified 2026-10-07.

### Export a project's knowledge

- **Intent:** Take a Project's own knowledge out of Ember as files.
- **Users and authority:** The Project's owner or curators, its builder of record, or a platform admin.
- **Prerequisites:** None beyond that access; an empty export still has a README.
- **Start:** `/projects/[id]`
- **Navigation:** Project page → Knowledge section → **Export knowledge**.
- **Outcome:** A zip with every knowledge base the Project owns (each current source's original file and its approved text as Markdown), the Project's approved wiki articles, and a README listing what's inside.
- **Ember guidance:** Ember cannot produce the zip; direct the user to the button.
- **Boundaries:** Only the Project's own knowledge bases are included, not shared or assigned ones. Sources the person can't read under evidence access stay out. Unapproved text and retired sources are left out. Very large original files may exceed the host's download size limit.
- **Exposure:** UI only (`/projects/[id]/knowledge-export`).
- **Verification:** `src/lib/projects/knowledge-export.ts`, `src/app/(app)/projects/[id]/knowledge-export/route.ts`; code verified 2026-10-07.

## Ember response contract for navigation

When a user asks where or how to do something, Ember should return:

1. a one-sentence answer identifying the appropriate area;
2. any prerequisite, project binding, membership, or role requirement;
3. one primary stable navigation link;
4. a short description of what the user will do or see next;
5. an explicit distinction between navigation, drafting, execution, approval, and publication; and
6. an honest limitation when the workflow is unverified or not yet supported.

Example:

> Use **Projects** to open the customer workspace, then choose **Ask Assistant about this project** so I can use its authorized sources. You must be a member of that project. [Open Projects](/projects)

Ember should avoid:

- listing several weakly related links when one primary route is sufficient;
- inventing a route or using a test-specific identifier;
- treating a link click as completion of the linked action;
- implying that admin, curator, or project membership grants an authority that has not been verified;
- putting internal KB Sandbox navigation links in the user's Artifacts collection; and
- exposing private content through link labels, summaries, citations, or error messages.

## Update checklist

For every material UI or workflow change:

1. update the affected catalogue entry in the same code change;
2. verify the shortest path as each affected role or project relationship;
3. check empty, populated, pending, approved, and denied states where relevant;
4. update Ember's committed navigation knowledge;
5. add or update link/route checks;
6. add a concise release note linking to the catalogue heading; and
7. record the verification date and evidence without including secrets or customer-sensitive data.

## Discovery backlog

The following areas need deeper workflow-level verification in later passes:

- project creation, membership, access, and approval-authority management;
- source upload, document versioning, review, and publication;
- project knowledge-base and Wiki attachment/reuse;
- project-bound Ember conversations, artifacts, and recovery;
- assessments, datasets, evaluation runs, and result approval;
- Ember Readiness, knowledge gaps and solution evaluation, once built (see the Evals entry);
- agent graph and external registry detail views;
- profile, journals, and feedback/problem reporting;
- owner Roadmap access and export; and
- admin-only provider, model, Blog publication, and system-management workflows.

These entries should be expanded before they are treated as complete MCP discovery evidence.
