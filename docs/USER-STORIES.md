# Ember — User Stories by Role and Module

**Status:** Living reference; describes behavior implemented in the repository as of 4 October 2026
**Audience:** Product, design, QA, onboarding leads and anyone writing acceptance tests
**Related:** `docs/CURRENT-ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/workbench-handbook-how-kb-sandbox-is-organized.md`

## How to read this document

Stories are grouped first by **role**, then by **module**. Each story has an ID (`<ROLE>-<MODULE>-<nn>`), the story itself and short acceptance criteria taken from the enforced behavior (Server Action checks, service-layer checks and RLS).

Roles are cumulative. A story is listed once, under the **lowest** role that can perform it. Every higher role inherits it:

```text
Platform Admin  ⊃  Curator  ⊃  Consultant  ⊃  Viewer
```

The one deliberate exception is **self-approval**: nobody, including an admin where noted, may approve a Project, presentation or promotion they created or submitted themselves.

### The four roles

Ember has two separate authorization tiers: a **platform role** (`profiles.role`) and a **Project role** (`project_members.role`). Granting a role in one Project never implies access to another. The personas below map onto both tiers.

| Persona | Platform role | Typical Project role | In one sentence |
|---|---|---|---|
| **Platform Admin** | `admin` | Any (bypasses Project membership) | Operates the instance: users, AI providers, external access, final approval of canonical knowledge and publication. |
| **Curator** | `curator` | `owner` or `curator` | Governs knowledge and Projects: curates sources, drafts the Wiki, defines benchmarks, manages members, reviews and approves work. |
| **Consultant** | `consultant` | `consultant` | Does the work: converses with Ember, runs evaluations, performs Workstreams, attaches evidence and submits sources for review. |
| **Viewer** | `member` | `viewer` | Participates read-only: reads approved knowledge and Project material, asks Ember questions, keeps personal notes. |

Notes on the mapping:

- **Project owner** abilities (publishing, approval policies, authority assignments, deciding restricted-evidence requests) are listed under **Curator** and marked *(owner)*. A platform admin can always perform them.
- A **platform curator who is not a member** of a Project sees only safe portfolio metadata for it and must request membership before opening the workspace. A **platform admin** can open any Project.
- **Public visitors** (no session) have their own section, [5. Public Visitor](#5-public-visitor).
- The **Builder/Agency** deployment mode (`KB_SANDBOX_PRODUCT_MODE=builder`) gives the same four roles different meanings. Sections 1–4 describe the default **Enterprise** mode; [6. Builder Mode](#6-builder-mode) covers what changes.

### Modules

| Code | Module | Main routes |
|---|---|---|
| ACC | Accounts, profile and journal | `/login`, `/forgot-password`, `/profile`, `/profile/journal` |
| EMB | Ember assistant | `/dashboard`, `/agents/workbench-assistant` |
| PRJ | Projects and membership | `/projects`, `/projects/new`, `/projects/portfolio`, `/projects/[id]`, `/projects/[id]/members` |
| ACS | Evidence access and information sensitivity | `/projects/[id]/access` |
| GOV | Project governance | `/projects/[id]/governance` |
| CUR | Knowledge curation and knowledge bases | `/upload`, `/review/[docId]`, `/sources/[id]`, `/projects/[id]`, `/admin` |
| WIK | Wiki | `/wiki`, `/wiki/new`, `/wiki/[slug]`, `/wiki/[slug]/edit` |
| WKN | Working knowledge and Project notes | `/projects/[id]/working-knowledge`, `/projects/[id]/notes` |
| WST | Workstreams, artifacts and presentations | `/projects/[id]/workstreams/...` |
| ASM | Assessments | `/projects/[id]/assessments/...` |
| MTH | Methods | `/methods`, `/methods/[id]` |
| EVL | Evaluations | `/evals`, `/evals/datasets/...`, `/evals/runs/...` |
| AGT | Graphs, agents and agent registry | `/graphs`, `/agents`, `/agent-registry` |
| PUB | Publishing, blog and trending | `/projects/[id]/publish`, `/blog`, `/contribute/blog`, `/trending`, `/examples`, `/knowledge` |
| FBK | Feedback and roadmap | `/feedback`, `/roadmap` |
| AIR | AI provider and model registry | `/admin/providers/[id]` |
| MCP | External AI app access (MCP) | `/oauth/consent`, `/api/mcp`, `/admin` |
| ADM | Platform administration | `/admin` |

### Coverage matrix

`●` = the role has stories of its own in this module; `○` = inherits only.

| Module | Admin | Curator | Consultant | Viewer |
|---|:-:|:-:|:-:|:-:|
| ACC Accounts, profile and journal | ○ | ○ | ○ | ● |
| EMB Ember assistant | ○ | ● | ● | ● |
| PRJ Projects and membership | ● | ● | ● | ● |
| ACS Evidence access and sensitivity | ○ | ● | ○ | ● |
| GOV Project governance | ○ | ● | ○ | ● |
| CUR Knowledge curation | ● | ● | ● | ○ |
| WIK Wiki | ● | ● | ○ | ● |
| WKN Working knowledge and notes | ○ | ● | ○ | ● |
| WST Workstreams and presentations | ○ | ● | ● | ● |
| ASM Assessments | ○ | ● | ● | ● |
| MTH Methods | ○ | ● | ○ | ● |
| EVL Evaluations | ○ | ● | ● | ○ |
| AGT Graphs, agents and registry | ○ | ● | ● | ○ |
| PUB Publishing, blog and trending | ● | ● | ○ | ● |
| FBK Feedback and roadmap | ● | ○ | ○ | ● |
| AIR AI provider and model registry | ● | — | — | — |
| MCP External AI app access | ● | ○ | ○ | ● |
| ADM Platform administration | ● | — | — | — |

---

## 1. Viewer

The Viewer reads and converses. They cannot change shared Project content, run evaluations or attach evidence. Their default shell is **Ember-first**: the header shows only the Ember link, with a "Switch to classic workspace" toggle.

### ACC — Accounts, profile and journal

**VWR-ACC-01 — Sign in**
As a Viewer, I want to sign in with the account an admin created for me, so that I can reach the Projects I have been added to.
- There is no self-service registration; `/register` redirects to `/login`.
- Password reset is available from `/forgot-password`.
- A deactivated account is refused by every workspace action (`Account is deactivated`).

**VWR-ACC-02 — Maintain my profile**
As a Viewer, I want to update my display name, so that teammates recognize me in notes, members lists and comments.

**VWR-ACC-03 — Generate a personal work journal**
As a Viewer, I want to generate a reflective journal of my recent work and download it as a Word document, so that I can review my progress without assembling it by hand.
- Previewed before download; not available to anonymous accounts.

### EMB — Ember assistant

**VWR-EMB-01 — Ask Ember a question**
As a Viewer, I want to ask Ember a question in plain language, so that I get help without having to learn the Workbench's structure.
- Conversations and messages persist; recent conversations are listed on return.
- Each answer records the provider and model that produced it, visible in response details.

**VWR-EMB-02 — Scope a conversation to a Project**
As a Viewer, I want to choose which of my Projects scopes the conversation, so that Ember answers with that Project's permitted knowledge.
- Only Projects where I hold active membership are offered.
- Ember shows which Project currently governs the conversation.
- Switching Projects never carries retrieved private evidence into the new context.

**VWR-EMB-03 — Get answers grounded only in evidence I may see**
As a Viewer, I want Ember to use only sources I am authorized for, so that restricted material is never revealed to me through the assistant.
- Ember does not retrieve, summarize, cite or acknowledge the existence of a restricted source I cannot access.

**VWR-EMB-04 — Understand a sensitivity block**
As a Viewer, I want Ember to explain in plain language when a request cannot be sent to the selected model, so that I understand why it did not answer.
- The check happens before inference; blocked content never reaches the model.

**VWR-EMB-05 — Choose the model for my next message**
As a Viewer, I want to pick which enabled generation model answers my next message, so that I can compare answers or use a stronger model for a hard question.
- Switching models mid-conversation does not rewrite earlier messages' provenance.

**VWR-EMB-06 — See what Ember is doing**
As a Viewer, I want a live activity indicator while Ember works, so that I know a long request is progressing.

**VWR-EMB-07 — Follow safe links**
As a Viewer, I want Ember to link me to the relevant page, source or artifact, so that I can inspect the evidence myself.
- Links resolve only to pages I am allowed to open.

**VWR-EMB-08 — Attach a file to a question**
As a Viewer, I want to attach a document (including a zip) to my message, so that Ember can reason over material I already have.

**VWR-EMB-09 — Find a suitable Method**
As a Viewer, I want Ember to match my objective to a documented Method and list its prerequisites, so that I know what is needed before work begins.
- Ember names missing inputs and any prerequisite Method instead of claiming automation that does not exist.

**VWR-EMB-10 — Confirm before Ember delegates to an external agent**
As a Viewer, I want to confirm or cancel any action Ember proposes to delegate to an external agent, so that nothing runs on my behalf without my consent.

### PRJ — Projects and membership

**VWR-PRJ-01 — See only my Projects**
As a Viewer, I want the Projects list to show only Projects where I am an active member, so that the workspace reflects my actual access.
- Membership in one Project reveals nothing about another private Project.

**VWR-PRJ-02 — Browse the Project directory**
As a Viewer, I want to browse discoverable Projects in my organization, so that I can find work I should be part of.
- Only Projects marked discoverable appear; no private content is exposed.

**VWR-PRJ-03 — Request to join a Project**
As a Viewer, I want to request membership of a discoverable Project with a short reason, so that its owner or curator can let me in.
- I can see the status of my own requests.

**VWR-PRJ-04 — Read a Project's overview**
As a Viewer, I want to read a Project's purpose, goal, status, members, attached knowledge and Workstreams, so that I understand the work.

**VWR-PRJ-05 — Explore connected knowledge**
As a Viewer, I want the Organization Explorer to show Projects and knowledge bases connected to the current Project, so that I can navigate related work.
- Only branches I am permitted to discover appear; restricted branches are not hinted at by names, counts or placeholders.

### ACS — Evidence access and information sensitivity

**VWR-ACS-01 — Request access to a restricted source**
As a Viewer, I want to request access to a restricted source in my Project, so that I can use it when I have a legitimate need.
- I can see my own requests and their outcome.

### GOV — Project governance

**VWR-GOV-01 — See who approves what**
As a Viewer, I want to see a Project's approval policies and named authorities, so that I know who decides pricing, customer release, security acceptance and similar outcomes.

### WIK — Wiki

**VWR-WIK-01 — Read approved Wiki articles**
As a Viewer, I want to browse and read approved Wiki articles by category, so that I learn from reviewed knowledge.
- Only an article's current approved version is shown; drafts and superseded versions are not.
- Project-scoped articles appear only in Projects where I am a member.

**VWR-WIK-02 — Get Quick Help**
As a Viewer, I want a short Quick Help summary of an article, so that I can get the gist before reading in full.

**VWR-WIK-03 — Follow related articles and sources**
As a Viewer, I want to follow an article's related articles and cited sources, so that I can check what it is based on.

### WKN — Working knowledge and Project notes

**VWR-WKN-01 — Save personal working knowledge**
As a Viewer, I want to save notes into my own working knowledge for a Project, directly or through Ember, so that useful findings are not lost in chat history.
- Items are private to me by default; only I can edit them.

**VWR-WKN-02 — Share a working note with a teammate**
As a Viewer, I want to share one of my working notes with a specific Project member and revoke that share later, so that I control who sees my draft thinking.

**VWR-WKN-03 — Search working knowledge with Ember**
As a Viewer, I want Ember to search my working knowledge and notes shared with me, so that I can reuse what I or colleagues already found.

**VWR-WKN-04 — Read and reply to Project notes**
As a Viewer, I want to read notes addressed to me or my Project team and reply to them, so that I can respond to curator guidance.
- I can mark a note addressed to me as resolved.

### WST — Workstreams, artifacts and presentations

**VWR-WST-01 — Read Workstreams and their evidence**
As a Viewer, I want to read a Workstream's scope, goal, guardrail, deliverables and attached artifacts, so that I can follow the work.
- Artifacts under a restricted evidence classification are hidden unless I have access.

**VWR-WST-02 — Comment on a presentation under review**
As a Viewer, I want to comment on individual slides while a presentation's review is open, and reply to other comments, so that my feedback is captured against the right slide.

### ASM — Assessments

**VWR-ASM-01 — Read assessments and completed responses**
As a Viewer, I want to read a Project's system assessments and completed responses, so that I understand how the system was judged.

### MTH — Methods

**VWR-MTH-01 — Browse published Methods**
As a Viewer, I want to browse the published Method catalog, so that I can learn the recognized ways of doing applied AI work.

### PUB — Publishing, blog and trending

**VWR-PUB-01 — Read the blog and public knowledge**
As a Viewer, I want to read published blog posts and public Wiki articles, so that I can learn from material released for wider reading.
- Signed-in users see the same public pages as visitors (see section 5).

**VWR-PUB-02 — Share and discuss a trending item**
As a Viewer, I want to submit a link to Trending, comment on items and link them to relevant Wiki articles, so that the team notices developments worth curating.

### FBK — Feedback and roadmap

**VWR-FBK-01 — Send product feedback through Ember**
As a Viewer, I want to report a problem or idea to Ember during a conversation, so that I can give feedback without leaving my work.

**VWR-FBK-02 — Track my feedback**
As a Viewer, I want to see my own reports, their status and status history, and browse the feedback board, so that I know what happened to my input.

**VWR-FBK-03 — Read the roadmap**
As a Viewer, I want to read the product roadmap register, so that I know what is planned.

### MCP — External AI app access

**VWR-MCP-01 — Connect an approved external AI app**
As a Viewer who is on the MCP access allowlist, I want to approve or deny an external AI app's request to read my Ember data, so that I can use Ember knowledge from another assistant.
- Only allowlisted users and approved client redirect URIs can connect.
- Access is read-only and limited to what I can already see.

**VWR-MCP-02 — Disconnect an external AI app**
As a Viewer, I want to disconnect an AI app I previously approved, so that it can no longer read my data.

---

## 2. Consultant

The Consultant does the hands-on work inside Projects. Everything a Viewer can do also applies.

### EMB — Ember assistant

**CON-EMB-01 — Create Projects and Workstreams through Ember**
As a Consultant, I want Ember to create a Project or a Workstream from our conversation, so that I can move from intent to structure without filling in forms.
- Records Ember creates carry creation-path provenance.
- Ember states which configuration it actually completed and what still needs a human.

**CON-EMB-02 — Attach an artifact through Ember**
As a Consultant, I want Ember to attach a finding to a Workstream as an artifact, so that conversational results become evidence.

**CON-EMB-03 — Save chat attachments as findings**
As a Consultant, I want to save files I attached in a Project conversation as findings on a Workstream, so that source material reaches the evidence trail.
- Offered only when my Project role is owner, curator or consultant.

**CON-EMB-04 — Save a conversation as a Project note**
As a Consultant, I want to save selected messages from a conversation as a Project note, so that decisions reached in chat are recorded where the team will see them.

**CON-EMB-05 — Search the web through Ember**
As a Consultant, I want Ember to search the web when Project knowledge does not cover a question, so that I get current external context, clearly labelled as such.

### PRJ — Projects and membership

**CON-PRJ-01 — Start a Project**
As a Consultant, I want to create a Project with a type, objective, details and initial team, so that a new piece of work has its own governed workspace.
- I become the Project owner automatically.
- Ember can suggest a Project ontology from the type and objective.
- A Project started by a Consultant is pending approval until a Curator or Admin approves it; Projects started by a Curator or Admin skip this step.

**CON-PRJ-02 — Resubmit my Project after rejection**
As a Consultant whose Project was rejected, I want to address the reason and resubmit it, so that it can be approved.
- Only the Project's creator can resubmit.

**CON-PRJ-03 — Clone a Project or Workstream**
As a Consultant, I want to clone an existing Project or Workstream as a starting point, so that I can reuse a proven structure.

### CUR — Knowledge curation

**CON-CUR-01 — Submit a source for a Project knowledge base**
As a Consultant, I want to submit a file, a Workstream artifact or a working-knowledge item as a source for one of my Project's knowledge bases, so that useful evidence can become approved knowledge.
- I must be an active Project member.
- The submission waits for a Project owner or curator decision; I can see my own submissions.

### WST — Workstreams, artifacts and presentations

**CON-WST-01 — Attach evidence to a Workstream**
As a Consultant, I want to attach an artifact (finding, design note, evidence map, implementation handoff and similar) with content or an external link, so that work done in Ember or in external tools leaves a durable record.
- Artifacts are insert-only: a correction is a new artifact, not an edit.

**CON-WST-02 — Track deliverables**
As a Consultant, I want to tick off a Workstream's deliverables and update its summary, so that progress is visible to the team.

**CON-WST-03 — Submit a Workstream for promotion**
As a Consultant, I want to submit a completed Workstream for promotion, so that its approved results can be reused beyond this Project.
- I must be an active member of the Workstream's Project.

### ASM — Assessments

**CON-ASM-01 — Respond to an assessment**
As a Consultant, I want to complete a system assessment's questions and save my response, so that the system's readiness is assessed with evidence.
- I can keep editing my own response until it is completed.
- Viewers cannot submit responses.

### EVL — Evaluations

**CON-EVL-01 — Run an evaluation**
As a Consultant, I want to run an active benchmark dataset against a chosen configuration (single pass, graph or Agent; chunks, Wiki or both; generation, embedding and judge models), so that a change is judged on evidence rather than impression.
- Consultants may run only **active** datasets.
- The run snapshots its full configuration so it stays interpretable after the registry changes.
- A failed case still produces a result row with a structured error.

**CON-EVL-02 — Inspect results and traces**
As a Consultant, I want to drill into each case's retrieved evidence, metrics (Hit@K, Recall@K, MRR, grounding, outcome), judge output and graph trace, so that I can see why a configuration passed or failed.

**CON-EVL-03 — Compare against the baseline**
As a Consultant, I want to compare a run with the dataset's baseline run, so that I know whether my change helped.

### AGT — Graphs, agents and agent registry

**CON-AGT-01 — Create an Agent from a template**
As a Consultant, I want to create an Agent from an Agent Template with its purpose, instructions and models prefilled, so that I start from a governed configuration.
- Template defaults are copied; editing a template later never changes my Agent.

**CON-AGT-02 — Ask an Agent a question**
As a Consultant, I want to ask the RAG Answer Agent a question and see its answer and trace, so that I can test it on real questions.

**CON-AGT-03 — Run an Agent's evaluation suite**
As a Consultant, I want to run an Agent against a benchmark from its detail page, so that its performance is comparable to other runs.

**CON-AGT-04 — Inspect graphs**
As a Consultant, I want to view each graph's versions and flow, so that I understand how a retry loop is configured.

**CON-AGT-05 — Register an external agent integration**
As a Consultant, I want to register an external agent integration and publish new versions of it, so that it can be evaluated and offered to Projects.
- I can manage only integrations I created.

---

## 3. Curator

The Curator governs knowledge and Projects. This section covers both the **platform curator** role and the **Project owner/curator** role; stories that need Project ownership specifically are marked *(owner)*. Everything a Consultant can do also applies. Curators keep the full classic navigation.

### EMB — Ember assistant

**CUR-EMB-01 — Update Project details through Ember**
As a Curator, I want Ember to update a Project's description, ontology, members and notes from our conversation, so that I can administer a Project conversationally.
- Ember applies the same authorization as the equivalent page.

### PRJ — Projects and membership

**CUR-PRJ-01 — See the organization portfolio**
As a platform Curator, I want a portfolio of all Projects with safe metadata (purpose, owner, status, member count, attached-knowledge count, authority gaps, items needing attention), so that I can see where governance is needed.
- No source titles, snippets, contents or conversations are exposed.
- For a Project I am not a member of, I can only request membership; I cannot open its workspace.

**CUR-PRJ-02 — Approve or reject a new Project**
As a Curator, I want to approve or reject a submitted Project with a reason, so that only well-formed Projects go live.
- I cannot approve a Project I created myself.

**CUR-PRJ-03 — Move a Project through its lifecycle**
As a Project Curator, I want to start work on, submit, send back, mark live or reopen a Project, so that its status reflects reality.

**CUR-PRJ-04 — Edit Project framing**
As a Project Curator, I want to edit a Project's description, goal, objective, starter prompt, portfolio category and discoverability, so that members and Ember start from the right context.

**CUR-PRJ-05 — Manage members**
As a Project Curator, I want to add members by email, change their roles, deactivate and reactivate them, so that the right people have the right access.
- Only a platform admin can create curator or admin accounts while adding members.

**CUR-PRJ-06 — Transfer ownership** *(owner)*
As a Project owner, I want to transfer ownership to another member, so that accountability follows the work.

**CUR-PRJ-07 — Decide join requests**
As a Project Curator, I want to approve or decline requests to join my Project, so that membership stays deliberate.

**CUR-PRJ-08 — Attach and detach knowledge bases**
As a Project Curator, I want to attach existing knowledge bases (or create and attach a new one) and detach them later, so that the Project uses exactly the evidence it is permitted to use.
- Attachment does not copy sources, change ownership or override source restrictions.
- Detaching does not delete the knowledge base.

**CUR-PRJ-09 — Attach an evaluation dataset**
As a Curator, I want to attach a benchmark dataset to a Project, so that the Project has its own evaluation baseline.
- A dataset cannot reference a knowledge base belonging to a different Project.

### ACS — Evidence access and information sensitivity

**CUR-ACS-01 — Create access groups**
As a Project Curator, I want to create evidence access groups and add or remove members with a reason, so that sensitive material can go to a subset of the team.

**CUR-ACS-02 — Classify a resource**
As a Project Curator, I want to classify a source, Wiki article or Workstream artifact and grant it to specific groups, so that restricted evidence is enforced rather than merely described.
- Every classification change and revocation is written to an audit log.

**CUR-ACS-03 — Decide restricted-access requests** *(owner)*
As a Project owner, I want to approve or deny a member's request for a restricted source, so that access to sensitive evidence is a deliberate decision.
- An approval is audited exactly like a manual grant.

**CUR-ACS-04 — Set AI-processing sensitivity** *(owner)*
As a Project owner, I want to set the information sensitivity (Public, Internal, Confidential, Restricted) of the Project and its resources, so that only eligible AI providers can process them.
- Sensitivity is independent of who may read the material.

### GOV — Project governance

**CUR-GOV-01 — Define approval policies** *(owner)*
As a Project owner, I want to state which approval types the Project requires and how, so that consequential outcomes have a defined decision path.
- At most one policy per approval type per Project; editing never creates a duplicate.

**CUR-GOV-02 — Assign and revoke authorities** *(owner)*
As a Project owner, I want to name the people responsible for each approval type and revoke an assignment with a reason, so that it is clear who may decide.

### CUR — Knowledge curation

**CUR-CUR-01 — Upload and process a document**
As a Curator, I want to upload a PDF, DOCX or text document into a knowledge base and have it parsed, chunked and enriched, so that it can be reviewed as evidence.
- Every failed stage records a structured, visible error instead of silently degrading.

**CUR-CUR-02 — Review chunks**
As a Curator, I want to approve, reject or save notes on each chunk, approve the remaining chunks in bulk and request more enrichment, so that only reviewed text becomes retrievable.
- Approving a chunk embeds it for retrieval.

**CUR-CUR-03 — Submit a reviewed document**
As a Curator, I want to submit a reviewed document for final approval, so that it can become authoritative evidence.

**CUR-CUR-04 — Decide source submissions**
As a Project Curator, I want to approve or reject sources my members submit, with a reason, so that only appropriate evidence enters the Project's knowledge bases.

**CUR-CUR-05 — Create a knowledge base**
As a Project Curator, I want to create a new knowledge base from my Project and attach it, so that a new body of evidence can be built.
- The knowledge base starts as pending and needs admin approval.

### WIK — Wiki

**CUR-WIK-01 — Write an article manually**
As a Curator, I want to create a Wiki article in the standard section structure, so that established knowledge is explained consistently.

**CUR-WIK-02 — Draft an article with AI**
As a Curator, I want to generate a draft from approved chunks I select, so that synthesis is faster but still grounded.
- AI output is always a draft; no AI path approves an article.

**CUR-WIK-03 — Revise without disturbing the live version**
As a Curator, I want each edit to create a new version, so that the approved version stays live until the revision is itself approved.

**CUR-WIK-04 — Link sources and related articles**
As a Curator, I want to cite sources (document, chunk or external) and link related articles, so that readers can trace and navigate the knowledge.

**CUR-WIK-05 — Submit for review**
As a Curator, I want to submit a draft for review, so that an admin can approve it as canonical.

**CUR-WIK-06 — Scope an article to a Project**
As a Project Curator, I want to attach an article to a Project and set its visibility scope, so that Project-specific guidance reaches only that Project.

### WKN — Working knowledge and Project notes

**CUR-WKN-01 — Send a Project note**
As a Curator, I want to send a note to a member, the whole Project team, curators or admins, so that guidance and requests are recorded in the Project.

### WST — Workstreams, artifacts and presentations

**CUR-WST-01 — Define a Workstream**
As a Project Curator, I want to create a Workstream with a goal, repository scope, guardrail and deliverables checklist, so that the work is bounded before it starts.
- A guardrail describes how to work; it does not grant or restrict access.

**CUR-WST-02 — Attach knowledge bases to a Workstream**
As a Project Curator, I want to attach or detach knowledge bases for a specific Workstream, so that its context is narrower than the whole Project's.

**CUR-WST-03 — Review artifacts**
As a Project Curator, I want to approve or reject an attached artifact with notes, so that only accepted evidence is treated as a result.

**CUR-WST-04 — Decide promotions**
As a Project Curator, I want to approve or reject a submitted Workstream promotion, so that only proven work is reused.
- I cannot decide a promotion I submitted myself.

**CUR-WST-05 — Generate a presentation**
As a Project Curator, I want to generate a slide presentation from a Workstream, so that findings can be reviewed by stakeholders.

**CUR-WST-06 — Run the presentation review**
As a Project Curator, I want to open, schedule, cancel, close and reopen a presentation review with an optional deadline, so that reviewers comment in a defined window.
- Owners and curators are notified when a review opens and when it is submitted for curator review.

**CUR-WST-07 — Triage review comments**
As a Project Curator, I want comments classified and turned into tracked actions, so that every piece of feedback is addressed.

**CUR-WST-08 — Approve a presentation**
As a Curator, I want to approve a revised presentation, so that it becomes the agreed deliverable.
- I cannot approve a presentation I created.

### ASM — Assessments

**CUR-ASM-01 — Author an assessment**
As a Project Curator, I want to create a system assessment and its questions, so that the Project's AI system can be assessed consistently.

**CUR-ASM-02 — Version an assessment**
As a Project Curator, I want to create, activate and retire assessment versions, so that changing the questions never invalidates past responses.

**CUR-ASM-03 — Correct a response**
As a Project Curator, I want to edit any response in my Project, so that I can fix errors after review.

### MTH — Methods

**CUR-MTH-01 — Turn a Workstream into a Method**
As a Project Curator, I want to create a draft Method from a successful Workstream and edit it, so that a proven approach becomes repeatable.

**CUR-MTH-02 — Publish a Method**
As a platform Curator, I want to publish a pending Method, so that it joins the catalog.

**CUR-MTH-03 — Instantiate a Method**
As a Project Curator, I want to create a Workstream from a published Method in my Project, so that the team follows a proven path.

### EVL — Evaluations

**CUR-EVL-01 — Build a benchmark dataset**
As a Curator, I want to create a dataset and add cases with a question, expected answer, expected concepts, expected chunks and articles, criteria, tags and difficulty, so that AI configurations can be scored.

**CUR-EVL-02 — Activate or archive a dataset**
As a Curator, I want to activate a dataset (it needs at least one case) and archive it later, so that consultants have a stable benchmark.
- Once a dataset leaves draft, its cases are frozen.

**CUR-EVL-03 — Run draft datasets**
As a Curator, I want to run a dataset while it is still in draft, so that I can check the cases before activating it.

**CUR-EVL-04 — Mark a baseline**
As a Curator, I want to mark one run as the dataset's baseline, so that later runs have a reference.

**CUR-EVL-05 — Add a human review**
As a Curator, I want to record my own scores and failure classification for a result, so that human judgement sits next to the automated metrics.
- Human review never overwrites the automated scores.

### AGT — Graphs, agents and agent registry

**CUR-AGT-01 — Activate a graph or Agent version**
As a Curator, I want to choose which version of a graph or Agent is active, so that changes are adopted deliberately.
- Project-scoped graphs and Agents are owner-managed.

**CUR-AGT-02 — Certify an external integration**
As a Curator, I want to change an external integration's certification status, record capability evidence and decide capability evaluations, so that only verified integrations are trusted.

**CUR-AGT-03 — Offer an integration to a Project**
As a Curator, I want to grant or revoke an integration's availability in a Project, so that each Project uses only approved external agents.

### PUB — Publishing, blog and trending

**CUR-PUB-01 — Publish a Project example** *(owner)*
As a Project owner, I want to write a public profile (summary, problem, approach, findings, conclusion, benchmark summary, related articles), save it as a draft and publish or unpublish it, so that we can share a curated account of the work without exposing the Project.
- Editing never auto-publishes; unpublishing keeps the draft.
- The public `/examples` routes are currently switched off (`PUBLIC_EXAMPLES_ENABLED = false`), so a published profile is not yet reachable by visitors.

**CUR-PUB-02 — Write a blog post**
As a Curator, I want to write, import from a Word document, illustrate and link blog posts, then submit them for review, so that we can publish articles.
- I can generate a Substack export.

**CUR-PUB-03 — Curate Trending**
As a Curator, I want to mark a trending item under review, archive it, make it public, or promote it into a Wiki draft, so that worthwhile developments become knowledge.

---

## 4. Platform Admin

The Platform Admin operates the instance. Everything a Curator can do also applies, and the admin can open any Project's workspace from the portfolio.

### PRJ — Projects and membership

**ADM-PRJ-01 — Open any Project**
As a Platform Admin, I want to open any Project's full workspace from the portfolio, so that I can support and govern it without being a member.

**ADM-PRJ-02 — Delete a Project**
As a Platform Admin, I want to permanently delete a Project after typing its name to confirm, so that mistaken or abandoned Projects can be removed.
- No other role can delete; others archive.

**ADM-PRJ-03 — Allow full public detail**
As a Platform Admin, I want to enable full data exposure for a published Project, so that a showcase can include its Workstreams, artifacts and completed assessments.

### CUR — Knowledge curation

**ADM-CUR-01 — Approve documents**
As a Platform Admin, I want to give final approval to a reviewed document, so that it becomes authoritative evidence.

**ADM-CUR-02 — Approve, reject or delete knowledge bases**
As a Platform Admin, I want to approve, reject or delete proposed knowledge bases, so that the evidence estate stays intentional.

**ADM-CUR-03 — Assign knowledge bases to curators**
As a Platform Admin, I want to assign knowledge bases to specific curators, so that curation responsibility is clear.

### WIK — Wiki

**ADM-WIK-01 — Approve or reject a Wiki version**
As a Platform Admin, I want to approve or reject a submitted article version, so that only reviewed content becomes canonical.
- Approval is the only action that changes an article's current version, and it embeds the approved version for retrieval.

**ADM-WIK-02 — Archive an article**
As a Platform Admin, I want to archive an article, so that outdated knowledge stops being served.

**ADM-WIK-03 — Make an article public**
As a Platform Admin, I want to make an approved article public or private, so that only content safe for anonymous readers is disclosed.
- Approved and public are separate decisions.

### PUB — Publishing, blog and trending

**ADM-PUB-01 — Publish the blog**
As a Platform Admin, I want to publish, unpublish, return to draft or delete blog posts, so that the public blog stays accurate.

**ADM-PUB-02 — Remove a shared link**
As a Platform Admin, I want to remove an inappropriate trending link with a reason, so that the shared feed stays trustworthy.

### FBK — Feedback and roadmap

These two stories need the **platform owner** designation (`is_platform_owner`), not just the admin role.

**ADM-FBK-01 — Triage feedback**
As the platform owner, I want to triage feedback reports by changing status and adding notes, so that every report has a visible outcome.
- Reports are immutable history; only status and triage fields change.

**ADM-FBK-02 — Maintain the roadmap register**
As the platform owner, I want to update roadmap items, so that the published roadmap reflects decisions.

### AIR — AI provider and model registry

**ADM-AIR-01 — Manage providers**
As a Platform Admin, I want to add providers (OpenAI, Gemini, Groq and OpenAI-compatible gateways) and enable or disable them, so that the instance uses only sanctioned AI services.
- Only the API key's environment variable name is stored; the UI reports Configured or Missing.

**ADM-AIR-02 — Set a provider's sensitivity ceiling**
As a Platform Admin, I want to set the maximum information sensitivity each provider may receive, so that confidential material never reaches an ineligible model.

**ADM-AIR-03 — Manage models**
As a Platform Admin, I want to add or discover models, record their capabilities, enable or disable them, set their lifecycle status and notes, so that users can only select appropriate models.

**ADM-AIR-04 — Choose defaults**
As a Platform Admin, I want to set the default generation, embedding and structured-output models independently, so that each workload uses the right model.
- At most one default per model type.

### MCP — External AI app access

**ADM-MCP-01 — Control who may connect**
As a Platform Admin, I want to add and remove users on the MCP access allowlist, so that only named people can connect external AI apps.

**ADM-MCP-02 — Control which apps may connect**
As a Platform Admin, I want to approve client redirect URIs with a label and a maximum sensitivity, so that only known AI apps receive Ember data, and only up to an agreed level.

### ADM — Platform administration

**ADM-ADM-01 — Create users**
As a Platform Admin, I want to create accounts with an email, password and platform role, so that people can be onboarded directly.
- This is the only way to create an account; there is no self-service registration.
- Each new account is enrolled in the Organization Home Project.

**ADM-ADM-02 — Change roles and deactivate users**
As a Platform Admin, I want to change a user's platform role and deactivate or reactivate their account, so that access matches each person's responsibilities.

**ADM-ADM-03 — Brand the instance**
As a Platform Admin, I want to upload the instance's icon, so that the workspace carries the client's branding.

---

## 5. Public Visitor

A Public Visitor has no session. They see only content that a human has explicitly published, through narrow read paths that never expose internal columns, members, evaluations or AI logs. Code prefix: `PUBV`.

### Public site

**PUBV-01 — Understand what Ember is**
As a Public Visitor, I want a landing page and an About page that explain Ember and what makes it different, so that I can decide whether it is relevant to me.
- A signed-in user who opens `/` is sent to `/dashboard` instead.

**PUBV-02 — Read the blog**
As a Public Visitor, I want to browse published blog posts and read each one, so that I can follow how Ember is built and used.
- Only posts an admin has published appear; drafts and posts under review never do.
- Each post has its own canonical link and social-sharing metadata.

**PUBV-03 — Read public knowledge**
As a Public Visitor, I want to browse and read Wiki articles marked public at `/knowledge`, so that I can learn from reviewed material without an account.
- Only an article's current approved version is shown, and only when an admin has marked the article public.
- Sources, related-article links and version history are not exposed.

**PUBV-04 — Sign in or recover my password**
As a Public Visitor who has been given an account, I want to sign in or reset my password, so that I can reach my workspace.
- There is no self-service sign-up; accounts are created by an admin.

**PUBV-05 — Have search engines index only public pages**
As a Public Visitor arriving from a search engine, I want results to point only at public pages, so that I never land on a sign-in wall.
- `robots.txt` allows `/`, `/about`, `/blog` and `/knowledge`, and `/examples` only when examples are switched on.

**PUBV-06 — View a published Project example** *(currently switched off)*
As a Public Visitor, I want to read a published Project's curated profile and, where an admin allowed full detail, its Workstreams, artifacts and completed assessments, so that I can see real examples of the method.
- Gated by `PUBLIC_EXAMPLES_ENABLED`, which is `false` today; `/examples` returns *not found* until it is switched on.
- Never shows draft assessment versions or in-progress responses.

### What a Public Visitor can never do

- Run Ember, an Agent or any other live AI call.
- See Project members, evaluation data, AI operation logs, Wiki sources or any unpublished content.

---

## 6. Builder Mode

When a deployment sets `KB_SANDBOX_PRODUCT_MODE=builder`, Ember becomes a programme for individual builders who discover and specify customer AI capabilities, build them in their own tools, and hand them over. The platform roles keep their names but take on these meanings:

| Builder-mode persona | Platform role | What they do |
|---|---|---|
| **Platform owner** | `admin` | Runs the programme: assigns builders to agencies, sets allowances and the platform rate, sees every agency and builder. |
| **Agency** | `curator` | Supervises its own builders: approves their Projects and promotions, records client fees. |
| **Builder** | `consultant` | Works alone in one private workspace Project; each client proposal is a Workstream. |
| **Client** | Project `viewer` | Is added as a viewer to the client Project created when a proposal is accepted. |

Everything in sections 1–4 still applies unless a story below changes it. Agency and platform-owner views are **consent-based and metadata only**: names, statuses, counts, dates, completion percentages and progress updates the builder chose to share. They never show a builder's notebooks, conversations, artifacts, slides, goals or deliverable labels. Code prefix: `BLD-<persona>`.

### Builder

**BLD-B-01 — Start working straight away**
As a Builder, I want my workspace Project to exist when my account is created, so that I can start without any setup.
- An admin creating a `consultant` account in Builder mode provisions `<name> — Builder Workspace` (category `builder_lab`).

**BLD-B-02 — One Project, one Workstream per client**
As a Builder, I want each client proposal to be a Workstream in my workspace, so that my work stays in one place.
- Trying to create a second Project is refused with guidance to start a new Workstream instead.

**BLD-B-03 — A Builder-focused shell**
As a Builder, I want navigation focused on Ember, my Projects, the Wiki and the Blog, so that enterprise administration does not get in my way.
- Trending, Explore and the classic-workspace toggle are hidden.

**BLD-B-04 — See my AI spend**
As a Builder, I want my profile to show my monthly allowance, credits, spend and what remains, so that I can manage my usage.

**BLD-B-05 — Be stopped before overspending**
As a Builder, I want a warning near my limit and, if my agency set it, a hard stop at my allowance, so that costs stay within what was agreed.
- Enforced on the server before the model call.
- Only Ember conversations on my own workspace Project are metered; unpriced calls are reported as unpriced, never as free.

**BLD-B-06 — Bring my own LLM**
As a Builder, I want to configure my own LLM (a hosted API key, or a local OpenAI-compatible server such as Ollama or LM Studio) and clear it later, so that my conversations do not draw on the platform's allowance.
- One active credential per builder.
- Applies only to my own workspace Project; these calls are logged but never counted against my allowance.

**BLD-B-07 — Share a progress update**
As a Builder, I want to share a progress update on a client Workstream (progress, next step, confidence and any help needed), replace it, and withdraw it, so that my agency sees exactly what I choose to share.
- Only the Workstream's Project owner can share.

**BLD-B-08 — Promote an accepted proposal**
As a Builder, I want to submit an accepted client proposal for promotion with my client contacts' email addresses, so that it becomes a client Project.
- On approval, a new Project is created that I own; my agency (if I have one) joins as curator; the Workstream and its artifacts are copied; a fee record is created; and the client contacts are added as viewers.
- My workspace Project is never exposed to the client.
- I cannot approve my own promotion.

**BLD-B-09 — Use any AI while it's presales**
As a Builder, I want to use any approved model (or my own LLM) in my workspace and in a client Project until it goes Live, so that I can work fast during discovery and specification.
- Counted against my allowance, as before.

**BLD-B-10 — Live client Projects use Sandz-hosted AI**
As a Builder, I want Ember to switch to Sandz-hosted AI automatically once my client Project is Live, so that the client's live work never reaches an external model.
- Applies to chat, summaries, Wiki drafts, presentations and ontology suggestions; not to document enrichment, embeddings or web search.
- The model picker offers only Sandz-hosted models and the chat header shows "Live: Sandz-hosted AI only"; my own LLM isn't used there.
- If none is available, Ember says so instead of calling any model.
- Internal and foundation Projects are never restricted, Live or not.

### Agency

**BLD-A-01 — See my builders**
As an Agency, I want a dashboard of my assigned builders, their Projects, Workstreams, attached knowledge-base names and completion percentages, so that I can support them without reading their private work.
- I see only builders on my roster.

**BLD-A-02 — Approve my builders' Projects and promotions**
As an Agency, I want to approve or reject Projects and promotions submitted by my own builders, so that client engagements start with oversight.
- In Builder mode, a curator may decide only for builders on their own roster; the platform owner may decide for anyone.

**BLD-A-03 — Record client fees**
As an Agency, I want to record the maintenance fee for each of my builders' client Projects, so that invoicing figures are available.
- Ember records figures only; it never charges anyone.
- A new fee takes the current platform rate; correcting a fee keeps the rate it was recorded with.

### Platform owner

**BLD-P-01 — See every agency and unassigned builder**
As the Platform owner, I want the agency dashboard to show every agency and every builder not yet assigned, so that nobody is left without supervision.

**BLD-P-02 — Assign builders to agencies**
As the Platform owner, I want to assign a builder to an agency or remove the assignment, so that each builder has the right supervisor.

**BLD-P-03 — Set the platform rate**
As the Platform owner, I want to set the platform's percentage share of client fees, so that billing reflects the programme's business model.

**BLD-P-04 — Review Builder Operations**
As the Platform owner, I want a Builder Operations view of every builder's shared progress updates and AI spend, so that I know who needs help.
- Shown on `/admin` in Builder mode only.

**BLD-P-05 — Set allowances and grant credit**
As the Platform owner, I want to set a builder's monthly AI allowance, warning threshold and hard stop, and grant one-off credit with a reason, so that usage matches the programme's budget.
- The service layer also permits curators, but the controls are only on `/admin`, which is admin-only. Exposing them on `/agency` would let agencies manage their own builders.


**BLD-P-06 — Mark a provider as Sandz-hosted**
As the Platform owner, I want to mark a provider as Sandz-hosted in Admin → AI Config, so that Live client Projects can use it and only it.
### Client

**BLD-C-01 — Follow my engagement**
As a Client, I want to be added as a viewer of my client Project, so that I can follow the work, comment on presentations and talk to Ember about it.
- All Viewer stories in section 1 apply.

---

## Planned capabilities (not yet stories)

These appear in `docs/ROADMAP.md` but have no implemented behavior to describe. Add stories here once a slice is built:

- Promote a conversation to Project Knowledge with human review (M2).
- Persisted method Requirement Status: Available, Needed, Optional, Can Be Produced Elsewhere (M5).
- Guardrail Templates with runtime enforcement (M5C / M7).
- AI system inventory, risk tiers, control definitions and evaluation gates (M7).
- Reviewed report types and executive reports (M8).
- Role-based consultant learning paths (M9).
- Builder mode: the private Builder Notebook, opportunity states, the five programme milestones and milestone-triggered credit awards (`docs/dev-request-kb-sandbox-builder-product.md`).

## Maintenance

- When a Server Action, service check or RLS policy changes who can do something, update the matching story and move it between roles if needed.
- Keep each story under the lowest role that can perform it.
- Describe enforced behavior only. Put intent under *Planned capabilities*.
