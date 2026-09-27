import Image from 'next/image'
import Link from 'next/link'
import { SectionHero } from '@/components/SectionHero'

const EXPERIENCES = [
  {
    eyebrow: 'For everyday work', title: 'Ember Workspace',
    description: 'Ask questions, find approved information, prepare documents, continue Project work and use approved agents—all through one conversational interface grounded in the knowledge you are permitted to use.',
    actions: ['Ask Ember', 'View my Projects', 'Continue recent work'], href: '/login', linkLabel: 'Enter the workspace',
  },
  {
    eyebrow: 'For improving how the organization uses AI', title: 'AI Workbench',
    description: 'Curators, consultants and administrators build trusted knowledge, investigate opportunities, compare approaches, establish Methods, evaluate agents and retain human authority over important decisions.',
    actions: ['Build trusted knowledge', 'Apply Workbench Methods', 'Evaluate models and agents'], href: '/knowledge', linkLabel: 'Explore public knowledge',
  },
]

const ROLES = [
  { name: 'Member', description: 'Uses Ember for everyday work.' },
  { name: 'Consultant', description: 'Discovers and designs valuable AI applications.' },
  { name: 'Curator', description: 'A department head or trusted assistant who knows the team and helps staff become more productive with approved knowledge and AI.' },
  { name: 'Administrator', description: 'Operates and secures the organization’s platform.' },
]

const CONNECTIONS = [
  { title: 'Connect knowledge', description: 'Bring approved information from existing document stores and business applications into the knowledge available to the right people.' },
  { title: 'Connect live systems', description: 'Use APIs, connectors and webhooks when Ember or another approved capability needs current information from an existing system.' },
  { title: 'Add governed actions', description: 'Introduce MCP servers and specialist agents when AI should do more than answer—such as prepare a record, start a workflow or request an approval.' },
]

const STEPS = [
  { number: '01', title: 'Discover', description: 'Find where AI could make employees more productive. Begin with real activities, recurring questions, delays, duplicated effort and knowledge people struggle to find.' },
  { number: '02', title: 'Try', description: 'Explore practical ways to help. Use approved evidence, compare models and approaches, decide whether an agent is needed, and determine how AI should connect with existing systems and workflows.' },
  { number: '03', title: 'Apply', description: 'Evaluate what worked, establish the Method and guardrails, obtain human approval, and make the capability available through Ember or the appropriate business workflow.' },
]

const EXAMPLES = [
  'A salesperson prepares for a customer meeting.',
  'A proposal team assembles an evidence-backed solution.',
  'A call-center employee answers a technical question.',
  'An employee understands an approved company policy.',
  'A consultant designs and evaluates an MCP server.',
  'A student develops a controlled, testable AI agent.',
]

const EXPLORE = [
  { title: 'Wiki', description: 'Read approved concepts, guidance and Workbench material.', href: '/knowledge' },
  { title: 'Showcases', description: 'See realistic problems used to develop and test the Workbench.', href: '/examples' },
  { title: 'Blog and insights', description: 'Explore practical thinking about governed enterprise AI.', href: '/blog' },
  { title: 'Document-first AI development', description: 'Learn why architecture and evidence should come before generated code.', href: '/blog/the-document-first-principle-for-enterprise-ai' },
  { title: 'Deployment options', description: 'Consider cloud, dedicated, regional and private deployment choices.', href: '/blog/deployment-and-server-options' },
]

export default function AboutPage() {
  return (
    <div className="flex flex-col gap-12 pb-8">
      <SectionHero image="/images/sections/kb-sandbox.png" height="standard" position="center 30%" />

      <section className="max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">About Ember</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
          Bring AI into the enterprise—without losing the knowledge, judgment and control that make the enterprise work.
        </h1>
        <div className="mt-6 max-w-3xl space-y-4 text-base leading-7 text-zinc-700">
          <p>People are already using tools such as ChatGPT, Claude, Gemini and NotebookLM to research, understand documents and complete work faster. That individual productivity is valuable—but an enterprise needs more than a collection of private AI conversations and independently assembled notebooks.</p>
          <p>Ember helps organizations turn rapid, individual AI adoption into shared organizational capability. It brings approved knowledge, employees, AI models, specialist agents, evidence and human authority together within governed Projects.</p>
          <p className="font-medium text-zinc-950">Ember&apos;s goal is to enable organizations to discover where AI can genuinely make their people more productive—and establish the safest, most effective way to do it.</p>
        </div>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/login" className="rounded bg-amber-800 px-5 py-3 text-sm font-medium text-white hover:bg-amber-900">Sign in to Ember</Link>
          <Link href="/examples" className="rounded border border-zinc-300 bg-white px-5 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50">Explore showcases</Link>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">The adoption gap</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">From individual productivity to organizational capability</h2>
        <div className="mt-4 max-w-4xl space-y-4 text-sm leading-6 text-zinc-700 sm:text-base sm:leading-7">
          <p>AI adoption did not begin with an enterprise transformation programme. It began with people discovering that an AI assistant could make ordinary tasks easier.</p>
          <p>Instead of searching through several recipes and deciding which instructions to follow, someone can ask an assistant how to cook beef stroganoff using the ingredients already in the kitchen. The same person can use AI to plan a trip, understand a difficult document, summarize a long email or draft a response.</p>
          <p>At work, employees naturally apply the same approach: they summarize reports, research customers, interpret policies, prepare proposals and work through unfamiliar technical problems. This is valuable, but individual adoption does not automatically become organizational capability.</p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            'Is the assistant using current, approved organizational knowledge?',
            'Can useful work be shared instead of repeatedly recreated?',
            'May this employee—and this AI provider—use the information?',
            'Can another person inspect the sources behind the result?',
            'Who approves a recommendation or action when consequences matter?',
            'Can a successful practice become repeatable across the organization?',
          ].map((question) => <div key={question} className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">{question}</div>)}
        </div>
        <p className="mt-6 text-sm font-medium text-zinc-900">Personal AI assistance → Shared organizational knowledge → Governed Projects → Repeatable Methods and approved agents → Measurable organizational capability</p>
      </section>

      <section>
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Two experiences, one platform</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Useful for employees. Governable by the enterprise.</h2>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {EXPERIENCES.map((experience, index) => (
            <article key={experience.title} className={`flex flex-col rounded-2xl border p-6 ${index === 0 ? 'border-amber-200 bg-amber-50' : 'border-sky-200 bg-sky-50'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${index === 0 ? 'text-amber-800' : 'text-sky-800'}`}>{experience.eyebrow}</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-950">{experience.title}</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-700">{experience.description}</p>
              <ul className="mt-5 space-y-2 text-sm text-zinc-700">{experience.actions.map((action) => <li key={action}>✓ {action}</li>)}</ul>
              <Link href={experience.href} className="mt-6 text-sm font-semibold text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900">{experience.linkLabel} →</Link>
            </article>
          ))}
        </div>
        <figure className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          <Image src="/images/about-workplace-experiences.png" alt="People using shared knowledge, evidence and governed AI in their everyday workplaces" width={1672} height={941} className="h-auto w-full" sizes="(max-width: 1024px) 100vw, 1024px" />
          <figcaption className="border-t border-zinc-200 px-5 py-3 text-sm text-zinc-600">One shared platform supports different kinds of work while keeping knowledge, evidence and approval connected.</figcaption>
        </figure>
      </section>

      <section>
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Designed around organizational roles</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">People remain part of the system</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role) => <div key={role.name} className="rounded-lg border border-zinc-200 bg-white p-4"><h3 className="text-sm font-semibold text-zinc-950">{role.name}</h3><p className="mt-1 text-sm text-zinc-600">{role.description}</p></div>)}
        </div>
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><span className="font-semibold">The Curator is central to adoption.</span> Usually a department head or a trusted assistant, the Curator understands the team, its responsibilities and the work people are trying to complete. Their purpose is not simply to manage documents—it is to help staff become more productive by turning departmental knowledge and practical AI use into a trusted everyday capability.</p>
        <p className="mt-4 text-sm text-zinc-600">Platform roles determine what someone may do. Project membership, knowledge permissions and assigned approval authority determine where they may do it and which decisions they may make.</p>
      </section>

      <section>
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">A simple adoption journey</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Discover → Try → Apply</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {STEPS.map((step) => <article key={step.title} className="rounded-xl border border-zinc-200 bg-white p-5"><p className="text-sm font-semibold text-amber-700">{step.number}</p><h3 className="mt-2 text-lg font-semibold text-zinc-950">{step.title}</h3><p className="mt-2 text-sm leading-6 text-zinc-700">{step.description}</p></article>)}
        </div>
        <p className="mt-5 text-center text-sm font-medium text-zinc-600">Observe → Learn → Improve</p>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">Build on what the organization already uses</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">AI should improve existing work—not force everything to start again</h2>
        <p className="mt-4 max-w-4xl text-sm leading-6 text-zinc-700 sm:text-base sm:leading-7">Organizations already have document stores, CRM and HR systems, service desks, finance applications and established workflows. Ember helps teams understand where those tools should supply knowledge, provide live information or support a governed action. The Workbench can then guide the design and evaluation of the appropriate connector, API integration, MCP server or specialist agent.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {CONNECTIONS.map((connection, index) => <article key={connection.title} className="rounded-xl border border-amber-100 bg-white/90 p-5 shadow-sm"><p className="text-sm font-semibold text-amber-700">0{index + 1}</p><h3 className="mt-2 text-base font-semibold text-zinc-950">{connection.title}</h3><p className="mt-2 text-sm leading-6 text-zinc-700">{connection.description}</p></article>)}
        </div>
        <p className="mt-5 text-sm font-medium text-amber-950">Existing tools and workflows → governed connections → approved AI assistance and action</p>
      </section>

      <section className="grid gap-7 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Start with real work</p>
          <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Help people with activities they already perform</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-700">Ember does not begin by declaring an enterprise inefficient. It begins by finding where approved knowledge and well-governed AI can remove friction, improve judgment and preserve useful learning.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">{EXAMPLES.map((example) => <div key={example} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">{example}</div>)}</div>
        <figure className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 lg:col-span-2">
          <Image src="/images/about-team-collaboration.png" alt="A team collaborating around documents and a shared AI knowledge workbench" width={1672} height={941} className="h-auto w-full" sizes="(max-width: 1024px) 100vw, 1024px" />
          <figcaption className="border-t border-amber-200 px-5 py-3 text-sm text-amber-950">AI adoption becomes organizational capability when people can work from shared evidence, learn together and improve the way work gets done.</figcaption>
        </figure>
      </section>

      <section className="rounded-2xl border border-orange-200 bg-gradient-to-r from-amber-100 via-orange-50 to-rose-50 p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">Governance that enables adoption</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">The safe path must also be the useful path.</h2>
        <div className="mt-4 grid gap-6 text-sm leading-6 text-zinc-700 md:grid-cols-2">
          <p>Employees should not have to choose between productivity and governance. Ember gives them a sanctioned, useful interface grounded in the knowledge available to their Project.</p>
          <p>The organization can govern which knowledge, people, models and agents participate; evaluate important results; preserve evidence; and keep consequential decisions under explicit human authority.</p>
        </div>
      </section>

      <section>
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Why “Sandbox”?</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">A safe place to learn what deserves to become normal work</h2>
        <div className="mt-4 max-w-4xl space-y-4 text-sm leading-6 text-zinc-700 sm:text-base sm:leading-7">
          <p>New AI uses should begin within clear boundaries. A sandbox is somewhere people can try an idea, compare alternatives, challenge assumptions and learn without confusing a convincing answer with a trusted one—or a successful demonstration with a production-ready capability.</p>
          <p>The sandbox is not the final destination. Successful approaches can become approved knowledge, repeatable Methods and governed agents used through Ember and existing business workflows. Evidence and feedback from everyday use then return to the Workbench so the organization keeps learning.</p>
        </div>
      </section>

      <section>
        <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Explore further</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Go deeper—learn about the latest AI trends here</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600">
          These links open material published for public viewing. Some organizational knowledge is
          protected; <Link href="/login" className="font-medium text-amber-800 underline underline-offset-4 hover:text-amber-900">sign in first</Link> to
          see the additional Wiki and Project knowledge available to you.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EXPLORE.map((item) => <Link key={item.title} href={item.href} className="group rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400 hover:shadow-sm"><h3 className="text-sm font-semibold text-zinc-950 group-hover:underline">{item.title} →</h3><p className="mt-2 text-sm leading-5 text-zinc-600">{item.description}</p></Link>)}
        </div>
      </section>
    </div>
  )
}
