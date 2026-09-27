import 'server-only'
import { getToolSpecs } from '@/lib/mcp/tools'
import { ASSISTANT_PROMPT_VERSION, MAX_TOOL_ITERATIONS, SEARCH_WIKI_LIMIT, getSystemPromptText } from '@/lib/chat/loop'

// Phase 1 of docs/dev-request-workbench-assistant-agent-flow-visibility.md:
// a read-only, server-owned description of the Workbench Assistant's agent
// harness for the /agents/workbench-assistant page and the chat panel's
// compact "How this Assistant works" entry point. Every value with a real
// runtime source (promptVersion, maxToolIterations, the search-limit
// guardrail, every tool's name/description/parameters) is imported from
// src/lib/chat/loop.ts / src/lib/mcp/tools.ts, never restated as a second
// literal -- so this file can't silently drift from the actual runtime.

export type AssistantNodeType = 'model' | 'context' | 'decision' | 'tool' | 'guardrail' | 'persistence'

export interface AssistantFlowNode {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'
  label: string
  implementationType: AssistantNodeType
  purpose: string
  inputsOutputs: string
  failureBehavior: string
  provenance: string
  next: { onLabel?: string; targetId: string }[]
}

export type AssistantEnforcement = 'kb_sandbox_enforced' | 'declared'

export interface AssistantToolDescriptor {
  name: string
  description: string
  parametersSchema: unknown
  requiredPermission: string
  enforcement: AssistantEnforcement
  enforcedBy: string
}

export interface AssistantGuardrailDescriptor {
  id: string
  label: string
  limit?: number
  description: string
  enforcement: AssistantEnforcement
  enforcedBy: string
}

export interface AssistantDescriptor {
  id: 'workbench-assistant'
  name: string
  purpose: string
  status: 'active'
  owner: string
  promptVersion: string
  modelRole: 'conversational'
  maxToolIterations: number
  plainLanguageExplanation: string
  nodes: AssistantFlowNode[]
  tools: AssistantToolDescriptor[]
  guardrails: AssistantGuardrailDescriptor[]
}

// The flow itself has no runtime "node list" to derive from -- it's
// imperative control flow in loop.ts's runAssistantTurn. This mirrors that
// doc's own mermaid diagram node-for-node, edge-for-edge, so the two never
// disagree; each node's provenance names the real code it represents.
const NODES: AssistantFlowNode[] = [
  {
    id: 'A',
    label: 'User message',
    implementationType: 'persistence',
    purpose: 'The user\'s message is recorded as the start of this turn.',
    inputsOutputs: 'Input: the text the user submitted. Output: a persisted user-role message.',
    failureBehavior: 'A persistence failure here fails the turn before any model call is made.',
    provenance: 'src/lib/chat/loop.ts runAssistantTurn() -- appendMessage(role: "user")',
    next: [{ targetId: 'B' }],
  },
  {
    id: 'B',
    label: 'Resolve identity and permissions',
    implementationType: 'guardrail',
    purpose: 'Confirms who is asking before anything else happens.',
    inputsOutputs: 'Input: the signed-in session. Output: an authorized user identity, or the turn is rejected.',
    failureBehavior: 'An unauthenticated or invalid session is rejected before a conversation or model call is created.',
    provenance: 'src/lib/auth.ts requireUser() -- called by src/app/actions/chat.ts before runAssistantTurn()',
    next: [{ targetId: 'C' }],
  },
  {
    id: 'C',
    label: 'Assemble conversation and approved context',
    implementationType: 'context',
    purpose: 'Builds the bounded set of recent messages (and a summary of older ones) the model will actually see.',
    inputsOutputs: 'Input: full conversation history. Output: a token-bounded working set, truncated/summarized as needed.',
    failureBehavior: 'Falls back to a smaller working set rather than failing the turn if the full history would not fit.',
    provenance: 'src/lib/chat/context.ts composeWorkingContext(), src/lib/chat/summary.ts',
    next: [{ targetId: 'D' }],
  },
  {
    id: 'D',
    label: 'Call conversational model',
    implementationType: 'model',
    purpose: 'The assembled context and system prompt are sent to the currently configured (or user-selected) model.',
    inputsOutputs: 'Input: system prompt, working context, available tools. Output: a reply, optionally with tool calls.',
    failureBehavior: 'A provider error or timeout (60s per request) surfaces as a visible failure with a Retry action, never a silent hang.',
    provenance: 'src/lib/chat/loop.ts runAssistantTurn() -- chatProvider.provider.generateChat()',
    next: [{ targetId: 'E' }],
  },
  {
    id: 'E',
    label: 'Tool requested?',
    implementationType: 'decision',
    purpose: 'Checks whether the model\'s reply asked to use a tool or is a final answer.',
    inputsOutputs: 'Input: the model\'s reply. Output: branches to either returning the reply or applying tool guardrails.',
    failureBehavior: 'Not applicable -- this is a pure branch on the model\'s own response.',
    provenance: 'src/lib/chat/loop.ts runAssistantTurn() -- result.message.toolCalls check',
    next: [
      { onLabel: 'No', targetId: 'J' },
      { onLabel: 'Yes', targetId: 'F' },
    ],
  },
  {
    id: 'F',
    label: 'Apply tool permissions and guardrails',
    implementationType: 'guardrail',
    purpose: 'Checks the requested tool against per-turn limits before it runs.',
    inputsOutputs: 'Input: the requested tool call. Output: allowed, or refused with an explanatory result.',
    failureBehavior: 'A refused call returns a safe explanatory message to the model instead of running.',
    provenance: 'src/lib/chat/loop.ts runAssistantTurn() -- SEARCH_WIKI_LIMIT check, then src/lib/mcp/tools.ts callTool() dispatch',
    next: [{ targetId: 'G' }],
  },
  {
    id: 'G',
    label: 'Allowed?',
    implementationType: 'decision',
    purpose: 'The outcome of the guardrail/permission check above.',
    inputsOutputs: 'Input: the guardrail result. Output: branches to executing the tool or returning a safe refusal.',
    failureBehavior: 'Not applicable -- this is a pure branch on the guardrail outcome.',
    provenance: 'src/lib/chat/loop.ts runAssistantTurn() -- same check as node F',
    next: [
      { onLabel: 'No', targetId: 'H' },
      { onLabel: 'Yes', targetId: 'I' },
    ],
  },
  {
    id: 'H',
    label: 'Return safe tool result',
    implementationType: 'guardrail',
    purpose: 'A refused or failed tool call is turned into a safe, explanatory result rather than exposing a raw error.',
    inputsOutputs: 'Input: the refusal or caught error. Output: a JSON error message the model can read and explain.',
    failureBehavior: 'This is itself the failure-handling path -- it never throws further.',
    provenance: 'src/lib/chat/loop.ts runAssistantTurn() -- refusal/catch JSON',
    next: [{ targetId: 'D', onLabel: 'Loops back to' }],
  },
  {
    id: 'I',
    label: 'Execute tool and persist result',
    implementationType: 'tool',
    purpose: 'Runs the permitted tool and records what it did and returned.',
    inputsOutputs: 'Input: the tool name and arguments. Output: the tool\'s result, persisted as a tool-role message.',
    failureBehavior: 'A tool-level error is caught and turned into a safe result (see node H), not an unhandled exception.',
    provenance: 'src/lib/mcp/tools.ts callTool() + src/lib/chat/loop.ts stampProvenance() + appendMessage(role: "tool")',
    next: [{ targetId: 'D', onLabel: 'Loops back to' }],
  },
  {
    id: 'J',
    label: 'Return and persist response',
    implementationType: 'persistence',
    purpose: 'The model\'s final answer is recorded and returned to the user.',
    inputsOutputs: 'Input: the model\'s final reply. Output: a persisted assistant-role message with provider/model provenance.',
    failureBehavior: 'A persistence failure here is surfaced as a turn failure with a Retry action.',
    provenance: 'src/lib/chat/loop.ts runAssistantTurn() -- return statement + appendMessage(role: "assistant")',
    next: [],
  },
]

// Tool permission/enforcement metadata has no declarative source anywhere
// in the codebase (verified: src/lib/mcp/tools.ts carries no permission
// data; checks live inline in src/lib/workbench/projects.ts and
// workstreams.ts, plus RLS). This table is therefore hand-authored and
// hand-verified against those files as of this writing -- if their role
// checks change, this table needs a matching update; nothing keeps it in
// sync mechanically the way promptVersion/maxToolIterations/tool
// name-description-parameters are kept in sync above.
const TOOL_METADATA: Record<string, Pick<AssistantToolDescriptor, 'requiredPermission' | 'enforcement' | 'enforcedBy'>> = {
  get_navigation_guide: {
    requiredPermission: 'Any signed-in user; reads a file committed with the application, not a database-gated resource.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'docs/ember/KB-SANDBOX-CAPABILITY-AND-NAVIGATION-CATALOGUE.md, read directly -- no approval workflow (see src/lib/mcp/tools.ts)',
  },
  create_wiki_draft: {
    requiredPermission: 'Curator or admin only -- fails via RLS for any other role.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'wiki_articles_insert_staff row-level security; always status=\'draft\', never approved by this or any AI-generated path',
  },
  search_wiki: {
    requiredPermission: 'Any signed-in user; results are already-approved Wiki content only.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'wiki_articles row-level security',
  },
  list_project_notes: {
    requiredPermission: 'Any signed-in user; results are scoped to projects they can access.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'project_notes row-level security',
  },
  search_projects: {
    requiredPermission: 'Any signed-in user; results are scoped to projects they can already access.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'projects row-level security',
  },
  classify_project: {
    requiredPermission: "Project owner, or platform admin -- fails via RLS for any other caller.",
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'projects_update_managers row-level security (can_manage_project)',
  },
  list_discoverable_projects: {
    requiredPermission: 'Any signed-in (non-anonymous) account; returns only Projects marked discoverability=\'platform\', safe metadata only.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'src/lib/projects/directory.ts (explicit role check, admin client for a narrow safe-column projection -- not an RLS policy change)',
  },
  request_project_membership: {
    requiredPermission: "Any signed-in (non-anonymous) account; the target Project must already be visible to the caller or discoverability='platform'.",
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'project_join_requests_insert_self row-level security',
  },
  create_project: {
    requiredPermission: 'Any signed-in (non-anonymous) account.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'src/lib/workbench/projects.ts',
  },
  approve_project: {
    requiredPermission: 'Curator or admin, or the project\'s own owner/curator member.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'src/lib/workbench/projects.ts',
  },
  create_workstream: {
    requiredPermission: 'Any signed-in (non-anonymous) account.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'src/lib/workbench/workstreams.ts',
  },
  attach_workstream_artifact: {
    requiredPermission: 'Any signed-in (non-anonymous) account.',
    enforcement: 'kb_sandbox_enforced',
    enforcedBy: 'src/lib/workbench/workstreams.ts',
  },
}

function buildTools(): AssistantToolDescriptor[] {
  return getToolSpecs().map((spec) => {
    const metadata = TOOL_METADATA[spec.name]
    return {
      name: spec.name,
      description: spec.description,
      parametersSchema: spec.parameters,
      requiredPermission: metadata?.requiredPermission ?? 'Not documented -- add an entry to TOOL_METADATA.',
      enforcement: metadata?.enforcement ?? 'declared',
      enforcedBy: metadata?.enforcedBy ?? 'Not documented -- add an entry to TOOL_METADATA.',
    }
  })
}

function buildGuardrails(): AssistantGuardrailDescriptor[] {
  return [
    {
      id: 'search-wiki-limit',
      label: 'Wiki search limit',
      limit: SEARCH_WIKI_LIMIT,
      description: `The Assistant may call search_wiki at most ${SEARCH_WIKI_LIMIT} times in a single turn; a further call is refused with an explanatory message.`,
      enforcement: 'kb_sandbox_enforced',
      enforcedBy: 'src/lib/chat/loop.ts runAssistantTurn()',
    },
    {
      id: 'tool-loop-iterations',
      label: 'Tool-loop iteration limit',
      limit: MAX_TOOL_ITERATIONS,
      description: `The model/tool loop runs at most ${MAX_TOOL_ITERATIONS} iterations per turn before the Assistant returns a fallback message asking the user to rephrase or narrow the request.`,
      enforcement: 'kb_sandbox_enforced',
      enforcedBy: 'src/lib/chat/loop.ts runAssistantTurn()',
    },
    {
      id: 'document-first-boundary',
      label: 'Document-first boundary',
      description:
        'The Assistant cannot modify a target repository, commit code, open pull requests, or deploy anything -- there is no tool for it. It is also instructed not to claim otherwise.',
      enforcement: 'kb_sandbox_enforced',
      enforcedBy: 'No code-modification tool exists in src/lib/mcp/tools.ts (structural); also stated in the system prompt (declared)',
    },
  ]
}

export function getAssistantDescriptor(): AssistantDescriptor {
  return {
    id: 'workbench-assistant',
    name: 'Workbench Assistant',
    purpose:
      'Helps users navigate and operate Ember: choosing the right Workbench method, searching approved platform knowledge, and setting up projects and workstreams.',
    status: 'active',
    owner: 'Ember platform team',
    promptVersion: ASSISTANT_PROMPT_VERSION,
    modelRole: 'conversational',
    maxToolIterations: MAX_TOOL_ITERATIONS,
    plainLanguageExplanation:
      'A single conversational agent with a bounded tool loop -- not a multi-agent system. It reads a user message, assembles relevant context, asks the configured model for a reply, and if the model asks to use a tool, checks that request against permissions and per-turn limits before running it. This can repeat a few times in one turn (for example: search, then answer) before the Assistant returns a final response.',
    nodes: NODES,
    tools: buildTools(),
    guardrails: buildGuardrails(),
  }
}

// Re-exported so callers needing the raw prompt text (the Agent Flow page's
// curator/admin-only disclosure) don't import src/lib/chat/loop.ts's other
// internals just to reach it.
export function getAssistantSystemPromptText(): string {
  return getSystemPromptText()
}
