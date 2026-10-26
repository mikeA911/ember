# Sandz SLI — Discovery: Triggers, Decisions and Handoffs

## Status

**Proposed, not built.** Discovery becomes the **first stage** of Solution Lifecycle Intelligence (SLI), before Marketing. This document covers milestones **S2** (Discovery workspace and Triggers) and **S3** (management decisions, handoffs and send-backs). It follows [ADR-0002](architecture-decisions/ADR-0002-ember-sandz-as-a-domain-module.md): Discovery is part of the SLI module and is switched on with it.

The customer registry ([design](dev-request-sandz-sli-customer-and-contact-registry.md)) moves to S4. A Trigger can reference industries now and customers once the registry exists.

## Delivery stages

| Milestone | Stage | Requirements |
|---|---|---|
| S2 | 1. SLI shell: SLI users see SLI screens only | — |
| S2 | 2. Trigger registry and stage history | DISC-01 |
| S2 | 3. Research workspace per Trigger (built on Workstreams) | DISC-02, DISC-06 |
| S2 | 4. Concept and feasibility Methods and artifacts | DISC-03 |
| S3 | 5. Management review and recorded decisions | DISC-04 |
| S3 | 6. Handoffs: promote forward, return, send back | DISC-05 |
| Later | Comparison and prioritisation; AI-assisted assessment; portfolio dashboard; lessons learned | DISC-07 to DISC-10 |

## 1. Purpose

Discovery is where Sandz decides **what is worth pursuing**. Marketing decides how to bring an approved solution to market.

Discovery is both the starting point of the lifecycle and a continuous function. Ideas can come from management, from any department, or from outside events.

```text
Discovery (Triggers) → Marketing → Sales & Presales → Project Delivery → Maintenance & Support
        ↑                                                                              │
        └──────────────────── send-backs and new Triggers (continuous learning) ───────┘
```

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Trigger** | Something that may justify a new or changed Sandz solution: a management idea, a market event, a customer problem, a technology development, a partner offering, an employee suggestion, or a lesson from a later stage |
| **Stage** | Where a Trigger is in Discovery (§4) |
| **Decision** | A recorded management outcome with its rationale and evidence (§6) |
| **Handoff** | Moving work between stages with a package of approved material. Three kinds: **promote** (forward), **return** (the receiver refuses a handoff before accepting it), **send back** (a later stage reopens earlier work after accepting it) (§7) |
| **Handoff package** | The selected, approved artifacts and claims passed to the next owner; never the whole research workspace |

"Opportunity" is not used in Discovery. It stays free for Sales opportunities later.

## 3. What a user sees: the SLI shell

SLI users should not see Ember's own screens (Projects, Workstreams, Methods, Evals, Wiki administration), because those would confuse them.

- On an instance with `EMBER_SLI_ENABLED`, users whose only access is through SLI departments get the **SLI shell**. Its navigation is SLI only: **Home** (my work), **Discovery**, and later **Customers**, **Marketing**, **Sales** and so on. This extends the existing role-directed shell in `src/components/Header.tsx`.
- **Ember's features are used underneath, presented in SLI terms.** A Trigger's research space *is* an Ember Workstream, but the user sees a "Research" tab on the Trigger, not a Workstream page. The assistant appears inside SLI pages, with the instance's branding.
- **Core routes are not linked** from the SLI shell. Opening one directly sends an SLI-only user back to SLI Home.
- **Platform admins and knowledge curators** keep the full Ember navigation for administration, knowledge curation and evaluations.

This applies to every later SLI stage, not only Discovery.

## 4. Trigger lifecycle

```text
New ──► Researching ──► Concept ──► Feasibility ──► Under review ──► Approved ──► Promoted
 │           ▲              ▲             ▲              │                            │
 │           └──────────────┴─────────────┴── Revise ────┤                            │
 │                                                       ├──► Deferred (review date)  │
 └──► Declined (not worth researching)                   └──► Rejected                │
             ▲                                                                        │
             └────────────────────── send back (§7) ──────────────────────────────────┘
```

- **New:** raised and visible to the Discovery team. A sponsor accepts it into research, or declines it with a reason.
- **Researching, Concept, Feasibility:** work happens in the research workspace (§5). Each stage's output is an artifact: research notes and candidate concepts, a concept paper, a feasibility assessment.
- **Under review:** the sponsor submits the Trigger for a management decision, with the evidence.
- **Decision outcomes** (§6): *Approve* (with a destination, for example "prototype first"), *Revise* (back to a named earlier stage), *Defer* (with a review date), *Reject*.
- **Promoted:** a handoff has been accepted by the destination owner (§7).
- **Reopened:** a send-back moves a promoted or approved Trigger back to an earlier stage. The earlier decision is marked superseded, never deleted.

Every stage change is recorded in an append-only history (who, when, from, to, reason). Stage changes go through one database function that checks the allowed transitions. Clients never set the stage directly, following Ember's existing pattern for Project status.

## 5. Research workspace (built on Ember)

| Need | Ember feature used underneath |
|---|---|
| A private space per Trigger | One **Discovery Project** per instance (confidential, management and appointed analysts). Each Trigger gets its own **Workstream** in it |
| Research and brainstorming | The assistant in the Trigger's Research tab, Tavily web search (ADR-0002, "Web search"), source uploads to the Workstream's own knowledge base, working knowledge notes |
| Concept and feasibility work | Two published **Methods** written for Sandz: *Concept development* and *Feasibility assessment*. Starting a Trigger's concept stage instantiates the Method in its Workstream |
| Outputs | **Workstream artifacts**: research dossier, concept paper, feasibility assessment, presentation |
| Using Sandz knowledge | Enterprise, market and technical knowledge bases attached read-only to the Discovery Project (shared, not copied) |
| Keeping speculation contained | Project privacy, evidence access groups and the sensitivity gate. The Discovery Project is **confidential**, so financial assumptions go only to AI providers approved for confidential data |
| Contributors outside management | Added to a single Trigger through an evidence access group, without seeing other Triggers |

**Discovery does not get its own large knowledge base.** Each Trigger's evidence lives in its Workstream. Findings become reusable knowledge only after approval, through Ember's source submission and curator review.

## 6. Management review and decisions (S3)

- **Review:** the sponsor submits the Trigger with its evidence (concept paper, feasibility assessment, key sources). The review can use Ember's **presentation** flow (slides generated from the Workstream, comments, revision).
- **Who decides:** holders of a `discovery_decision` authority, using Ember's approval policies and authority assignments (`project_approval_policies`, `holds_project_authority()`). Management is the initial authority. Nobody decides on a Trigger they sponsor unless the policy allows it.
- **What is recorded:** outcome, rationale, conditions (for example "prototype must reach 95% detection accuracy"), the evidence relied on, the destination if approved, the review date if deferred, and who decided under which authority.
- **Revisions do not overwrite:** a new decision supersedes the previous one, and both stay visible.

## 7. Handoffs: forward, return and send back

Promotions happen at several points in the lifecycle: Discovery to Marketing, Marketing to Sales, Sales to Delivery and so on. **One handoff mechanism serves all of them**, so going back works the same way everywhere.

### Promote (forward)

1. After an *Approve* decision, the sponsor proposes a handoff to a destination: **Marketing** (campaign or market validation), **Engineering** (prototype or proof of concept), **Sales / Presales** (a customer-specific pursuit), or **Project Delivery** (an approved internal initiative).
2. The handoff names the destination owner and attaches a **package**: selected approved artifacts, approved claims, target industries, conditions from the decision. Package artifacts are **copied** into the destination, as Ember's Workstream promotion already does, so the confidential Discovery workspace is never exposed.
3. The destination department lead **accepts** it. Acceptance creates the destination record or Workstream, links it to the Trigger, and moves the Trigger to *Promoted*.

Until the Marketing and Sales modules exist, the destination is a new Workstream in the destination department's SLI workspace.

### Return (before acceptance)

The destination owner can **return** a proposed handoff instead of accepting it, with a reason, for example "value proposition not specific enough to market". The Trigger stays *Approved*, and the sponsor revises the package or seeks a new decision.

### Send back (after acceptance)

A later stage can find that the solution is not adequate. This is the "go back" case.

1. The current owner (for example the Engineering prototype team) raises a **send-back** to an earlier stage. It includes a reason category (*solution inadequate*, *insufficient evidence*, *market changed*, *customer feedback*, *cost or risk higher than assessed*), the evidence (test results, customer feedback), and the stage it proposes to return to.
2. The Trigger's sponsor, or a decision authority, accepts the send-back. The Trigger moves back to the agreed stage (*Researching*, *Concept* or *Feasibility*) and the previous decision is marked **superseded**.
3. The downstream work is **paused or closed**, as the send-back states. Nothing is deleted. The destination record keeps its link and history.
4. The Trigger goes through review again and gets a new decision, which may promote it to the same or a different destination.

Send-backs and their reasons are counted. They feed lessons learned (DISC-10) and show where Discovery's feasibility checks need strengthening.

**When a send-back is not the right tool:** a problem found later that doesn't change the original solution (for example a different customer need) becomes a **new Trigger**, linked to the original as its source.

## 8. Data model (indicative)

All tables are prefixed `sli_`, with RLS on and `select apply_oauth_read_only_policies();` at the end of each migration.

| Table | Key columns |
|---|---|
| `sli_triggers` | `id`, `code` (`TRG-nnn`), `title`, `trigger_type` (`management_idea`/`market_event`/`customer_problem`/`technology`/`partner_offering`/`employee_suggestion`/`downstream_lesson`), `source_department_id`, `raised_by`, `sponsor_id`, `summary`, `event_date`, `event_reference` (link or source for market events), `strategic_objective`, `stage`, `priority`, `information_sensitivity` (default `confidential`), `workstream_id`, `source_trigger_id` (for Triggers raised from another), `review_on` (when deferred), audit columns, `archived_at` |
| `sli_trigger_stage_history` | Append-only: `trigger_id`, `from_stage`, `to_stage`, `reason`, `changed_by`, `changed_at`, related `decision_id` or `handoff_id` |
| `sli_trigger_links` | `trigger_id`, `link_type` (`industry`/`customer`/`partner`/`related_trigger`), reference |
| `sli_decisions` | `id`, `trigger_id`, `outcome` (`approve`/`revise`/`defer`/`reject`), `destination` (if approve), `return_to_stage` (if revise), `rationale`, `conditions`, `review_on`, `decided_by`, `authority_type`, `decided_at`, `supersedes_id`, `superseded_by_id`, `superseded_reason` |
| `sli_decision_evidence` | `decision_id`, artifact or source reference |
| `sli_handoffs` | `id`, `trigger_id`, `kind` (`promote`/`send_back`), `from_stage`, `to_stage` or `destination`, `destination_owner_id`, `destination_workstream_id`, `status` (`proposed`/`accepted`/`returned`/`withdrawn`), `reason_category` and `reason` (send-backs and returns), `downstream_action` (`pause`/`close`, send-backs), `proposed_by`, `decided_by`, `decided_at`, `previous_handoff_id` |
| `sli_handoff_package_items` | `handoff_id`, artifact reference, copied artifact reference, `item_type` (`artifact`/`claim`/`condition`/`target_industry`) |

Writes go through `SECURITY DEFINER` functions (`sli_transition_trigger()`, `sli_record_decision()`, `sli_propose_handoff()`, `sli_decide_handoff()`). Each checks the caller's authority and the allowed transitions, and writes history in the same transaction.

The same `sli_handoffs` table is reused, with other subject types, for the Marketing → Sales handoff in S6.

## 9. Permissions

| Action | Who |
|---|---|
| Raise a Trigger | Any active member of any SLI department (a short form: title, type, summary, evidence) |
| See your own submitted Triggers and their stage | The person who raised them |
| See all Triggers and their research | Discovery team: management and appointed analysts (members of the Discovery Project) |
| Contribute to one Trigger | People added to that Trigger's access group |
| Accept or decline a new Trigger; sponsor its research | Discovery team members with the sponsor role |
| Submit for review; propose a handoff | The Trigger's sponsor |
| Decide | Holders of the `discovery_decision` authority |
| Accept or return a handoff | The destination department's lead |
| Raise a send-back | The current owner of the downstream work |
| Accept a send-back | The Trigger's sponsor or a decision authority |

Platform admins keep their bypass in the helpers, with access to confidential Triggers logged.

## 10. Worked example: AI warehouse monitoring

*Illustrative.*

1. **Trigger (management idea):** "AI-powered warehouse monitoring using Zadara GPU infrastructure." Sponsor: Sandz management. Objective: expand the AI solutions business. Industries: warehousing, logistics.
2. **Researching:** the team uses the assistant and web search on computer-vision vendors and warehouse safety needs, uploads partner material, and records candidate concepts.
3. **Concept:** the *Concept development* Method produces a concept paper: solution, target market, business model, partners, dependencies.
4. **Feasibility:** the *Feasibility assessment* Method produces technical, commercial, cost and risk findings, including GPU capacity on Zadara.
5. **Decision:** *Approve* with destination **Engineering**: "limited technical prototype before marketing launch", with a condition on detection accuracy.
6. **Promote:** the Engineering lead accepts the handoff. A prototype Workstream is created with the copied package.
7. **Send back:** the prototype misses the accuracy condition at the lighting levels found in real warehouses. Engineering sends back to *Feasibility* with test results, reason *solution inadequate*, downstream action *pause*. The sponsor accepts, and the first decision is superseded.
8. **Revise and decide again:** feasibility is updated (different camera placement, a better model). New decision: *Approve*, Engineering again. The second prototype meets the condition.
9. **Promote to Marketing:** Marketing receives the value proposition, target industries, validated capabilities, approved claims, demonstrations and campaign recommendations. The original research, both decisions and the send-back stay linked to the Trigger for traceability.

## 11. Scope

### In scope (S2–S3)

- SLI shell (§3); Trigger registry, lifecycle and history; research workspace on Workstreams; two Methods; decisions; promote, return and send back; permissions as in §9.
- Behavioural RLS tests on PGlite for every permission rule and every allowed and refused transition.

### Out of scope (for now)

- Comparison and prioritisation, AI-assisted assessment, the portfolio dashboard, lessons-learned patterns (DISC-07 to DISC-10).
- Marketing, Sales and Delivery records as destinations. Until those modules exist, destinations are Workstreams.
- Notifications beyond Ember's existing Project notes.

## 12. Open questions for Sandz

1. Who is on the Discovery team, and who holds the decision authority? Is it one person or a committee, and does a decision need more than one approver?
2. Should employees outside management see Triggers raised by others, or only their own?
3. Which destinations should exist on day one: Marketing, Engineering, Sales/Presales, Delivery?
4. Who leads Engineering as a destination, since it is not one of the five SLI departments? Add it as a department?
5. What review dates for deferred Triggers: a fixed period, or set per decision?
6. Should the assistant inside SLI keep the name "Ember", or use an SLI or Sandz name?

## 13. Acceptance criteria

1. An SLI-only user sees only SLI navigation. Opening an Ember Core route directly returns them to SLI Home.
2. Any SLI department member can raise a Trigger and follow its stage. They cannot see other Triggers' research unless added.
3. A sponsor moves a Trigger through Researching, Concept and Feasibility, with history recorded. An illegal transition is refused by the database.
4. The two Methods produce a concept paper and a feasibility assessment as artifacts on the Trigger.
5. A decision authority records approve, revise, defer and reject outcomes with rationale and evidence. A sponsor cannot decide their own Trigger unless the policy allows it.
6. An approved Trigger is promoted. The destination lead accepts, and a destination Workstream is created with copied package artifacts. The Discovery workspace stays inaccessible to the destination team.
7. A destination lead can return a proposed handoff with a reason.
8. A downstream owner can send back. The Trigger reopens at the agreed stage, the earlier decision shows as superseded, the downstream work is paused or closed, and nothing is deleted.
9. The worked example (§10) runs end to end on lab with synthetic data.
10. With `EMBER_SLI_ENABLED` off, none of this is visible.
