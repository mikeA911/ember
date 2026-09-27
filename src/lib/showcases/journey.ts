export type ShowcaseAudience = 'Organizations' | 'Builders' | 'Schools'
export type ShowcaseStatus = 'Live demonstrated' | 'Pilot demonstrated' | 'Prototype' | 'Concept'

export interface ShowcaseCard {
  id: string
  title: string
  eyebrow: string
  summary: string
  outcome: string
  status: ShowcaseStatus
  audiences: ShowcaseAudience[]
  capabilities: string[]
  href?: string
  actionLabel?: string
  /** Required whenever the card reproduces (not just links to) HR names, policies or compensation figures. */
  disclosure?: string
}

export interface ShowcaseStage {
  id: 'know' | 'apply' | 'connect' | 'build' | 'learn'
  step: number
  verb: string
  title: string
  description: string
  accent: 'teal' | 'blue' | 'amber' | 'violet' | 'rose'
  cards: ShowcaseCard[]
}

export const FEATURED_SHOWCASES: ShowcaseCard[] = [
  {
    id: 'one-document-two-views',
    title: 'One document, two correctly different answers',
    eyebrow: 'Secure HR knowledge',
    summary:
      'Two active members ask the same question in the same Project. Only the authorized member receives the restricted evidence.',
    outcome: 'One restricted file · two users · zero restricted details leaked',
    status: 'Live demonstrated',
    audiences: ['Organizations'],
    capabilities: ['Knowledge', 'Access control', 'Ember'],
    href: 'https://claude.ai/code/artifact/aa164535-1e6d-4ff0-8446-bea1e9450ff5',
    actionLabel: 'View verified walkthrough',
    disclosure:
      'Demonstration data: The employee names, policies and compensation figures in this walkthrough are synthetic and do not represent actual Sandz HR records or salary bands.',
  },
  {
    id: 'first-conversation-with-ember',
    title: 'From first question to a governed workspace',
    eyebrow: 'Ember onboarding',
    summary:
      'An ordinary employee describes Sandz in plain language. Ember creates the initial departmental structure and stops at the human-only access step.',
    outcome: 'Four turns · zero product jargon required · one human-only step',
    status: 'Live demonstrated',
    audiences: ['Organizations', 'Schools'],
    capabilities: ['Onboarding', 'Projects', 'Governance'],
    href: 'https://claude.ai/code/artifact/888ad696-5f2a-46aa-a7fb-5c7dcb5d55c5',
    actionLabel: 'Read the real conversation',
  },
  {
    id: 'zadara-sales-proposal',
    title: 'Evidence to proposal—with people still in charge',
    eyebrow: 'Sales proposal copilot',
    summary:
      'Combine approved product evidence with customer requirements, identify what is missing and prepare a grounded proposal draft.',
    outcome: 'Cited capabilities · visible gaps · human commercial approval',
    status: 'Pilot demonstrated',
    audiences: ['Organizations', 'Builders'],
    capabilities: ['Sales', 'Evidence', 'Approval'],
  },
]

export const SHOWCASE_STAGES: ShowcaseStage[] = [
  {
    id: 'know',
    step: 1,
    verb: 'Know',
    title: 'Build trusted organizational knowledge',
    description:
      'Give people a useful AI interface to approved knowledge while preserving Project membership, document access and model-processing controls.',
    accent: 'teal',
    cards: [
      FEATURED_SHOWCASES[0],
      {
        id: 'customer-support-knowledge',
        title: 'Answer—or escalate instead of bluffing',
        eyebrow: 'Customer support copilot',
        summary:
          'Support staff receive cited product guidance and a clear escalation boundary when approved evidence does not settle the question.',
        outcome: 'Grounded answer · source citations · responsible escalation',
        status: 'Pilot demonstrated',
        audiences: ['Organizations'],
        capabilities: ['Support', 'Knowledge', 'Escalation'],
      },
      {
        id: 'policy-change-comparison',
        title: 'See what changed—and who needs to act',
        eyebrow: 'Policy comparison',
        summary:
          'Compare two policy versions, identify material changes and trace each finding back to the relevant clauses.',
        outcome: 'Change summary · evidence map · human policy decision',
        status: 'Prototype',
        audiences: ['Organizations', 'Schools'],
        capabilities: ['Policy', 'Comparison', 'Evidence'],
      },
    ],
  },
  {
    id: 'apply',
    step: 2,
    verb: 'Apply',
    title: 'Turn evidence into useful work',
    description:
      'Move beyond question-answering to proposals, comparisons and investigations without pretending that AI owns the final decision.',
    accent: 'blue',
    cards: [
      FEATURED_SHOWCASES[2],
      {
        id: 'vendor-rfp-comparison',
        title: 'Compare vendors against one requirement set',
        eyebrow: 'Procurement and RFPs',
        summary:
          'Score candidate proposals against the buyer’s requirements rather than against each vendor’s marketing language.',
        outcome: 'Comparison matrix · unsupported claims · questions for review',
        status: 'Prototype',
        audiences: ['Organizations', 'Schools'],
        capabilities: ['Procurement', 'Scoring', 'Human review'],
      },
      {
        id: 'semiconductor-8d',
        title: 'Structure an investigation without inventing root cause',
        eyebrow: 'Semiconductor quality',
        summary:
          'Organize incident evidence through an 8D investigation and expose the evidence still required before closure.',
        outcome: '8D report · evidence map · quality-manager approval',
        status: 'Prototype',
        audiences: ['Organizations', 'Builders', 'Schools'],
        capabilities: ['Manufacturing', 'Investigation', 'Governance'],
      },
    ],
  },
  {
    id: 'connect',
    step: 3,
    verb: 'Connect',
    title: 'Bring in live systems and events',
    description:
      'Knowledge explains what has been established. Connectors add current information; webhooks report what just changed.',
    accent: 'amber',
    cards: [
      {
        id: 'customer-ticket-connector',
        title: 'Combine approved guidance with a live support case',
        eyebrow: 'Customer ticket connector',
        summary:
          'Use governed product knowledge alongside live ticket status without copying an entire support system into the prompt.',
        outcome: 'Current case data · approved guidance · auditable handoff',
        status: 'Concept',
        audiences: ['Organizations', 'Builders'],
        capabilities: ['Action Connector', 'Support', 'REST API'],
      },
      {
        id: 'invoice-exceptions',
        title: 'Route invoice exceptions instead of automating judgment',
        eyebrow: 'Invoice processing',
        summary:
          'Validate structured fields deterministically, compare supporting evidence and send discrepancies to the right person.',
        outcome: 'Validated fields · exception route · preserved audit trail',
        status: 'Concept',
        audiences: ['Organizations', 'Builders'],
        capabilities: ['Accounting', 'Webhook', 'Human gate'],
      },
      {
        id: 'operations-evidence-collector',
        title: 'Collect logs without the copy-and-paste errors',
        eyebrow: 'Operations evidence',
        summary:
          'Retrieve bounded diagnostic windows from monitoring platforms and return normalized evidence to an investigation Project.',
        outcome: 'Correlation IDs · bounded evidence · reproducible investigation',
        status: 'Concept',
        audiences: ['Builders', 'Schools'],
        capabilities: ['Action Connector', 'Metrics', 'REST API'],
      },
    ],
  },
  {
    id: 'build',
    step: 4,
    verb: 'Build',
    title: 'Create portable tools and agents',
    description:
      'Use Ember to discover, specify and evaluate an integration; build and host it externally; expose only approved capabilities to Ember. Registration, certification and Project availability stay visibly distinct states — a registered capability is not yet connected, certified or available to Ember.',
    accent: 'violet',
    cards: [
      {
        id: 'legacy-application-to-mcp',
        title: 'Turn a legacy application into an AI-ready service',
        eyebrow: 'Legacy application to MCP',
        summary:
          'Recover workflows and business rules, validate the API contract, then build and evaluate a narrowly scoped MCP server.',
        outcome: 'Evidence-backed specification · tested tools · versioned contract',
        status: 'Prototype',
        audiences: ['Builders', 'Schools'],
        capabilities: ['OpenAPI', 'MCP', 'Modernization'],
        href: '/examples/carecall-openapi-discovery',
        actionLabel: 'See the discovery foundation',
      },
      {
        id: 'order-food-through-ember',
        title: 'Order food through Ember—with confirmation',
        eyebrow: 'Everyday business',
        summary:
          'Builder-hosted outlet and delivery tools let Ember check options and prepare an order while the user confirms before spending.',
        outcome: 'Reusable MCP tools · explicit confirmation · portable service',
        status: 'Concept',
        audiences: ['Organizations', 'Builders', 'Schools'],
        capabilities: ['MCP Server', 'Ordering', 'Human confirmation'],
      },
      {
        id: 'proposal-agent',
        title: 'Add a specialist agent only when the workflow needs one',
        eyebrow: 'External proposal agent',
        summary:
          'Coordinate research, approved tools and commercial gates through a versioned external agent when a bounded Ember tool loop is insufficient.',
        outcome: 'Declared graph · governed tools · evaluated human gates',
        status: 'Concept',
        audiences: ['Builders'],
        capabilities: ['External Agent', 'MCP', 'Certification'],
      },
    ],
  },
  {
    id: 'learn',
    step: 5,
    verb: 'Learn',
    title: 'Develop the next generation of AI builders',
    description:
      'Turn genuine regional problems into evidence, specifications, deployed capabilities and portfolio-quality demonstrations.',
    accent: 'rose',
    cards: [
      {
        id: 'school-ai-builder-lab',
        title: 'From student idea to deployed AI capability',
        eyebrow: 'School AI Builder Laboratory',
        summary:
          'Students learn the foundations, specify a real problem, build with assisted coding, test the result and demonstrate it through Ember.',
        outcome: 'Evidence · architecture · implementation · tests · deployment',
        status: 'Concept',
        audiences: ['Schools', 'Builders'],
        capabilities: ['Education', 'Hackathon', 'Deployment'],
      },
      {
        id: 'model-experiment-lab',
        title: 'Compare models on the same evidence and method',
        eyebrow: 'Reproducible AI experiment',
        summary:
          'Students and practitioners compare models or execution strategies without changing the benchmark halfway through.',
        outcome: 'Repeatable runs · comparable evidence · honest limitations',
        status: 'Live demonstrated',
        audiences: ['Schools', 'Builders'],
        capabilities: ['Evaluation', 'Models', 'Reproducibility'],
        href: '/examples/single-pass-vs-graph-retry',
        actionLabel: 'View a published experiment',
      },
    ],
  },
]

export const BUILDER_LIFECYCLE = [
  'Business problem',
  'Discovery and Method',
  'Architecture and specification',
  'External implementation',
  'Registration and evaluation',
  'Human approval',
  'Available to Ember',
] as const

export const SCHOOL_LAB_STEPS = [
  'Learn the foundations',
  'Choose a real regional problem',
  'Create evidence and architecture',
  'Build with assisted coding',
  'Register and test the capability',
  'Deploy on approved infrastructure',
  'Demonstrate it through Ember',
] as const

