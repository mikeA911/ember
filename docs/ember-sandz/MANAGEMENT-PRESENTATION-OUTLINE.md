# Ember Sandz and the Sandz Builder Platform — Management Presentation Outline

**Status:** Outline for the slide deck, v0.1, 25 October 2026  
**Audience:** Sandz management  
**Purpose:** Approve Sandz SLI as the first implementation, the Zadara resource quota and move plan, and the direction for the builder platform.

**Background documents:**

- [Ember Sandz concept paper v0.1](Ember_Sandz_Development_Concept_v0.1.md)
- [S1 Ember codebase assessment](S1-EMBER-CODEBASE-ASSESSMENT.md)
- [ADR-0002: Ember Sandz as a domain module](../architecture-decisions/ADR-0002-ember-sandz-as-a-domain-module.md)
- [ADR-0003: Supabase and hosting to Zadara, source to GitLab](../architecture-decisions/ADR-0003-source-hosting-and-zadara-deployment.md)
- [ADR-0004: Sandz builder platform](../architecture-decisions/ADR-0004-sandz-builder-platform.md)
- [Zadara resource request](../Deployment/zadara-resource-request.md)
- [Moving guide](../guides/moving-to-gitlab-and-zadara.md)

---

## 1. Title

- "Ember Sandz: Solution Lifecycle Intelligence and the Sandz Builder Platform"
- Proposal for approval, date, presenter

## 2. The problem

- Customer and solution information is scattered across apps and departments (Zoho, files, email)
- Knowledge is lost at handoffs: Marketing → Sales → Presales → Delivery → Maintenance
- AI tools are used ad hoc, without governance or traceability

## 3. What we already have: Ember

- A working platform, built and in use: knowledge curation, AI assistant, evaluations, governance, approvals
- Governed AI: human approval, provenance and citations, sensitivity controls on what reaches AI providers
- A builder and agency programme already built: supervision, approvals, metering, fee sharing

## 4. The vision in three steps

- **Step 1: Sandz SLI.** Our own lifecycle intelligence platform (a CRM, project and maintenance system with AI)
- **Step 2: Sandz Builders.** Internal builders create apps on Sandz infrastructure
- **Step 3: Builder community.** Partners and schools build and deploy on Sandz, using shared services
- One-line message: "We use it first, then open it up"

## 5. Step 1: Sandz SLI

- One shared customer and contact registry for every department
- Marketing first: campaigns, telemarketing, lead endorsement to Sales
- Later: Presales, Delivery and Maintenance. Ember's requirements, verification and re-verification features give these a head start
- AI drafts and recommends; people approve. No AI-only approvals or lead qualifications
- Pilot success: a full Marketing → Sales handoff with no lost information, no duplicate records and no unauthorized access

## 6. How we build it

- One codebase, not a fork: SLI is a module of Ember, so it inherits every improvement and security fix
- Separate instances: SLI (internal data) and Builders (partners and schools) never share a database
- Business workflows stay as documented; we digitize them, not redesign them

## 7. Our own infrastructure: moving to Zadara

- Data and apps move to Sandz's own Zadara infrastructure in the Philippines (data residency and control)
- Clean start: no test data carried over
- Five low-risk phases, each with a rollback:
  1. Database to Zadara
  2. Container preparation
  3. Code to GitLab
  4. Apps to Zadara
  5. Retire Vercel, Supabase Cloud and GitHub
- Separate tiers: application, data, operations

## 8. Resource request

- Day one (SLI): 3 production VMs plus 1 lab VM, 14 vCPU / 44 GB RAM / 530 GB SSD in total, and about 500 GB object storage
- Year-one quota to reserve (adds Builders and one more app): 28 vCPU / 88 GB / 870 GB
- Not included yet: the community zone and GPU for self-hosted AI, sized later
- Ask: approve the quota now; provision the day-one sizes

## 9. Steps 2–3: the Sandz Builder Platform

- **Portal:** builders and agencies register apps and get approvals, budgets and keys
- **Shared-services gateway:** one secure access point to AI, speech, maps and messaging. Usage is metered per app and per agency
- **Community zone:** builders' apps run separately from Sandz's internal systems
- **Lifecycle:** sandbox → pilot → production, with review before production

## 10. Shared services and partner ecosystem

- AI models, and Ember knowledge answers with citations
- Voice: speech-to-text and text-to-speech, with local-language support
- Maps: 2D and 3D, including Cesium
- Communications: phone, SMS and WhatsApp through partners such as Dial; voice and BPO bots through partners such as Talk BPO
- Documents and vision, single sign-on, automation, builder tooling
- Message: partners become part of the platform; builders get capabilities without negotiating with each vendor themselves
- Detail: see the appendix

## 11. Governance and security

- Human approval for anything external-facing or formal
- Record-level access control and an audit trail
- Infrastructure separation between Sandz data and external builders' code
- Schools: students may be minors, and the Data Privacy Act applies, so legal review comes before onboarding
- AI policy: sensitive data only goes to approved providers

## 12. Roadmap

- **B0:** SLI (Marketing pilot) and the move to Zadara
- **B1:** Builders instance for internal builders
- **B2:** App hosting and the shared-services gateway (internal builders)
- **B3:** External builders: partners, then schools
- **B4:** Community catalogue and showcase
- Each phase starts only when the previous one is in use

## 13. Business value

- **Internal:** one source of customer truth, faster handoffs, reusable knowledge, governed AI
- **External:** a new offering. Platform and hosting for partners, revenue sharing (already modelled in Ember), an ecosystem around Sandz infrastructure
- **Education:** a talent pipeline through schools

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Running more infrastructure ourselves | Phased move, monitoring, rehearsed backups |
| Security of hosting external builders' code | A separate zone and app review before production |
| Scope creep | Marketing pilot first, then expand on evidence |
| Dependence on partners | Everything goes through the gateway, so providers can be swapped |

## 15. Questions for Sandz management

These are for management to decide. The technical work does not set them.

**Costs and budget**

- What budget is available for Zadara capacity (day one and the year-one quota)?
- What budget is available for AI provider usage (models, speech, web search) for SLI and, later, for builders?
- Which commercial licences are acceptable (for example Cesium ion), and on what terms?

**Partners**

- Which partners to approach first (Dial, Talk BPO, Cesium, others)?
- What commercial model with partners: resale, revenue share, referral, or builders contract directly?
- What partner fees are acceptable to pass on to builders?

**Team and timeline**

- What team size and roles for SLI development, platform operations and the builder programme?
- What timeline is expected for the Marketing pilot, and for each later phase?
- Who owns platform operations (Zadara, backups, monitoring, support)?

**Business model for the builder community**

- Pricing for builders: hosting, shared-service use, and the platform's share of client fees
- Terms for schools: free, subsidised or paid, and what support Sandz provides
- Revenue expectations, if any, for the community in years one to three

## 16. Decisions needed today

- Approve SLI as the first implementation (Marketing pilot)
- Approve the Zadara resource quota and the move plan
- Endorse the builder platform direction (detailed design per phase, not yet a build commitment)
- Name department owners for SLI workflows and permissions
- Agree how to proceed with partners (Dial, Talk BPO, Cesium)

## 17. Next steps (30–60 days)

- Provision VMs and do the clean Supabase install
- Confirm the SLI permission matrix with department heads
- Settle open questions: which Zoho data to migrate, how Sales accepts a handoff
- Begin S2: the customer and contact registry
- Hold initial technical conversations with partners

---

## Appendix: candidate shared services

Three ways to bring a service in: self-host open source on Zadara, license a commercial product, or plug in a partner through the gateway or MCP (Ember's builder-integrations registry). Suggested rule: add a service to the gateway only when at least two apps need it; until then it is a recommended SDK in the builder template.

| Area | Candidates | Type | Why it fits Sandz |
|---|---|---|---|
| Maps and geospatial | CesiumJS (3D, open source, Apache 2.0) with Cesium ion (commercial; a self-hosted edition is sold by annual licence); PostGIS (in Supabase); OpenStreetMap tiles, geocoding and routing (Protomaps, Nominatim, OSRM or Valhalla) | Open source + commercial | Field operations, assets and incidents on maps; 3D for sites and facilities |
| Voice and language | Whisper or faster-whisper (speech-to-text); Piper (text-to-speech); LibreTranslate or NLLB (translation) | Open source | Filipino, Cebuano and other local languages; accuracy to be checked per language |
| Telephony and messaging | Dial (phone numbers, SMS, WhatsApp and voice for AI agents, via SDK or MCP); local SMS gateways; email; push notifications | Partner | AI agents that reach customers on the channels people use |
| Voice agents and BPO | Talk BPO bots; LiveKit (open source real-time voice and video) | Partner + open source | Contact-centre and BPO automation |
| Documents and vision | OCR (Tesseract, PaddleOCR); document parsing (Docling; Ember already parses PDF and Word); object detection for cameras (YOLO family) | Open source | Forms, permits, invoices; edge camera use cases |
| Knowledge and AI | Ember knowledge retrieval with citations as an API; AI model gateway; Tavily web search | Ember + commercial | Governed, cited answers from approved knowledge |
| Identity | Keycloak or Authentik (single sign-on) | Open source | One login across the portal, GitLab and builders' apps |
| Automation | n8n (self-hostable workflows) | Open source | Low-code integration for non-developer builders |
| Builder tooling | GlitchTip (error tracking, Sentry-compatible); Umami (analytics); Metabase (dashboards); Meilisearch (search) | Open source | Every app needs these; operated once for all |
| Payments | Philippine payment gateways (for example PayMongo, Xendit) | Partner | Apps that charge end users |

Partner descriptions for Dial and Talk BPO are based on Sandz's own information and should be confirmed with each partner.
