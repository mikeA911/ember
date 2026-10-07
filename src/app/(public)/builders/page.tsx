import type { Metadata } from 'next'
import Link from 'next/link'

// The Ember Builder's Journey (Builder edition): how an independent builder
// goes from first prospect to recurring income. Keep it to what the app
// does today -- the rules are in
// supabase/migrations/20261028100001_builder_edition_agency_rules.sql and
// src/lib/workbench/workstream-promotions.ts.

export const metadata: Metadata = {
  title: "The Builder's Journey · Ember",
  description: 'How an Ember builder goes from first prospect to recurring income: proposals, client projects, maintenance and reuse.',
}

const STAGES = [
  {
    number: '01',
    title: 'Presales',
    summary: 'Win the work.',
    description: 'Each client proposal is its own workstream in your workspace, with the objective, problem and outcome captured from the start.',
  },
  {
    number: '02',
    title: 'Deployment',
    summary: 'Build with evidence.',
    description: 'You work through Ember, so requirements, tests and results are recorded as you go and every claim has evidence behind it.',
  },
  {
    number: '03',
    title: 'Promotion',
    summary: 'Turn the proposal into a project.',
    description: 'When your client agrees, you request promotion. Ember approves it and the workstream becomes its own client project.',
  },
  {
    number: '04',
    title: 'Management & Maintenance',
    summary: 'Keep the client confident.',
    description: 'You maintain the project through Ember and the client sees the evidence there. Fixes and new features are new workstreams.',
  },
  {
    number: '05',
    title: 'Reuse',
    summary: 'Start ahead next time.',
    description: 'Work that proved itself becomes a Method you and other builders can start new workstreams from.',
  },
]

const RULES = [
  {
    title: 'Ember is your agency',
    description:
      'Ember approves your promotions and, when a project goes live, takes ownership to protect the client relationship. You stay on the project as its curator and keep maintaining it.',
  },
  {
    title: 'Only promoted projects are paid',
    description:
      'Proposals in your workspace are unpaid. A client maintenance fee is recorded only on a project promoted from a workstream, together with how it is split.',
  },
  {
    title: 'You found the client: you keep most of it',
    description:
      'Ember takes 5–10% of the maintenance fee and you keep the rest. Ember keeps the documentation, and you maintain the project through new workstreams in it.',
  },
  {
    title: 'Ember found the client: you share in it',
    description: 'You earn 5–10% of the maintenance fee for building and maintaining the project; Ember keeps the rest.',
  },
  {
    title: 'Your terms improve as you succeed',
    description:
      'Each builder has their own rates, and each project can be set on its own. As you bring more paid projects, your terms can improve.',
  },
  {
    title: 'Contract value is negotiable',
    description:
      'Commission on a project’s contract value is agreed with Ember case by case. Only the builder who requested the promotion is paid; if you invite other builders to help, how you share with them is up to you.',
  },
]

const PROMOTION_STEPS = [
  'Complete the workstream, with at least one approved artifact.',
  'Confirm your client has agreed to the project.',
  'Name the client people who should see it, and the maintenance fee you agreed.',
  'Ember reviews and approves the request.',
  'A new client project is created: you own it, the client people are added as viewers, and only your approved artifacts are carried over. Your other workstreams and notes stay in your workspace.',
]

const TOOLS = [
  {
    stage: 'Getting started',
    items: [
      'Request access with a short note on why you want to build with Ember. We reply to let you know if you are accepted.',
      'Your builder workspace is ready when your account is: no setup before you can start.',
      'Your workspace holds up to 20 workstreams. Need more? Ask from the New Workstream page with a reason, and Ember reviews it. Workstreams in your client projects don’t count.',
    ],
  },
  {
    stage: 'Presales: win the work',
    items: [
      'Workspace as sales funnel: each client proposal is its own workstream, and Ember can research the web for it.',
      "Builder Ontology: Ember suggests a map of the client's domain objects, or imports a Turtle file, which you can export as SVG or PNG for your proposal.",
      'Proposals and presentations: Ember drafts a proposal summary and slides from the workstream. Reviewers comment per slide, and comments become tracked actions.',
    ],
  },
  {
    stage: 'Deployment: build with evidence',
    items: [
      'Requirements register: requirements traced to standards, regulations, contract terms and vendor claims, each with a verification method and pass criteria. Ember drafts them from your project knowledge and cites the clauses.',
      'Verification records: append-only pass/fail results backed by evidence, so the client can see what was tested and when.',
      'Curated knowledge: upload sources, review and approve them, and build a project wiki. Ember answers from approved project knowledge.',
      'Knowledge from Ember: Ember can give you knowledge bases suited to your work, including ones you could not attach yourself. They appear in your workspace, marked Assigned by Ember.',
      'Your tools, your model: bring your own LLM, hosted or local (e.g. Ollama), or connect your own AI assistant to Ember through MCP.',
    ],
  },
  {
    stage: 'Promotion: turn proposals into projects',
    items: [
      'Workstream promotion: an accepted proposal becomes a client project with the client as viewers, and nothing else from your workspace is exposed.',
      'Cloning: copy a project or workstream to compare approaches side by side.',
    ],
  },
  {
    stage: 'Management & Maintenance: keep the client confident',
    items: [
      'Conformance decisions: frozen baselines, waivers and approvals. You cannot approve your own unless the project allows it.',
      'Automatic re-verification: a component change, a new version of a cited source, or an operational measure out of range flags the affected requirements for re-testing.',
      "Ember readiness: test how well Ember knows each project and see the score on the project page. Questions Ember can't answer are logged as knowledge gaps for you to fill.",
      'Billing: maintenance fees, the platform share and your share are recorded for invoicing, and AI usage is metered against your allowance.',
      'More work, same project: bug fixes and new features are new workstreams, and you can promote them too.',
    ],
  },
  {
    stage: 'Reuse: start ahead next time',
    items: [
      'Methods: promote a workstream that worked into a reusable Method. Once published, you and other builders can start new workstreams from it.',
      'Your knowledge, portable: export a project’s knowledge bases at any time from its page, as a zip of each source’s original file and approved text plus the project’s wiki articles.',
    ],
  },
]

const COMMUNITY = [
  'Invite other builders to your projects, or ask to join a project that is open to the platform.',
  'Project members, shared notes, working-knowledge notebooks you share with named teammates, and progress updates you share with Ember by choice.',
]

const TRUST = [
  'Your projects are private by default: only the members you add can open them.',
  'Your conversations with Ember are yours alone, and your private notebooks and drafts never move into a client project.',
  'Your project knowledge is yours: export it whenever you like. Builder-only knowledge bases are coming next.',
  'Per-resource access groups, AI sensitivity levels that decide which models may see what, approval policies, and an audit log of every access change.',
]

export default function BuildersJourneyPage() {
  return (
    <div className="flex flex-col gap-12 pb-8">
      <section className="max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">The Builder&apos;s Journey</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">From first prospect to recurring income.</h1>
        <div className="mt-6 max-w-3xl space-y-4 text-base leading-7 text-zinc-700">
          <p>
            Ember gives every builder a workspace that works as their sales funnel. Each client proposal is a workstream. When a client
            agrees, that workstream becomes its own client project, which you build and then maintain for a share of the client&apos;s
            maintenance fee. Whether you or Ember found the client decides the split.
          </p>
          <p className="font-medium text-zinc-950">Over time you have one workspace, plus every project you&apos;ve won.</p>
        </div>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/register" className="rounded bg-amber-800 px-5 py-3 text-sm font-medium text-white hover:bg-amber-900">
            Request builder access
          </Link>
          <Link href="/login" className="rounded border border-zinc-300 bg-white px-5 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
            Sign in
          </Link>
        </div>
      </section>

      <section>
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">The stages</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Presales → Deployment → Promotion → Maintenance → Reuse</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STAGES.map((stage) => (
            <li key={stage.title} className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-sm font-semibold text-amber-700">{stage.number}</p>
              <h3 className="mt-2 text-base font-semibold text-zinc-950">{stage.title}</h3>
              <p className="mt-1 text-sm font-medium text-zinc-800">{stage.summary}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{stage.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">How you earn</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Clear rules for who approves and who is paid</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {RULES.map((rule) => (
            <article key={rule.title} className="rounded-xl border border-amber-100 bg-white/90 p-5">
              <h3 className="text-base font-semibold text-zinc-950">{rule.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-700">{rule.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">From proposal to client project</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">How a workstream is promoted</h2>
        <ol className="mt-5 max-w-3xl space-y-3">
          {PROMOTION_STEPS.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-6 text-zinc-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 max-w-3xl text-sm leading-6 text-zinc-600">
          When the project goes live, Ember becomes its owner and you stay on as curator. New workstreams in that project, such as the
          next phase or a feature request, can be promoted the same way, and you are the builder of record for each.
        </p>
      </section>

      <section>
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">What Ember gives you at each stage</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Tools for every step</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {TOOLS.map((group) => (
            <article key={group.stage} className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="text-base font-semibold text-zinc-950">{group.stage}</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-700">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden className="text-amber-700">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <article className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Working together</p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-950">A community of builders</h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-700">
            {COMMUNITY.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Trust, built in</p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-950">Your work, under your control</h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-700">
            {TRUST.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="flex flex-col items-center gap-3 rounded-3xl border border-zinc-200 bg-white p-6 text-center sm:p-10">
        <h2 className="text-xl font-semibold text-zinc-950">Ready to build with Ember?</h2>
        <p className="max-w-xl text-sm text-zinc-600">Tell us why you want to build with Ember, and we&apos;ll let you know if you&apos;re accepted.</p>
        <Link href="/register" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          Request builder access
        </Link>
      </section>
    </div>
  )
}
