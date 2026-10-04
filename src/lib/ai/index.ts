import 'server-only'

export type { AIProvider } from './provider'
export { AIProviderError, classifyProviderError } from './provider'
export type { ProviderErrorCode } from './provider'
export type { ChatMessage, ToolCall, ToolSpec, GenerateChatInput, GenerateChatResult } from './provider'

// Provider/model resolution now lives in registry.ts (DB-backed registry,
// replacing the old hard-coded 'openai' | 'gemini' switch) -- this file
// stays as the stable import path (`@/lib/ai`) the rest of the app already
// uses.
export {
  AIConfigError,
  toRoleOption,
  listProviders,
  listModels,
  resolveModel,
  getDefaultModel,
  assertModelCapability,
  getProviderByName,
  getActiveProvider,
  getActiveEmbeddingProvider,
  getActiveStructuredOutputProvider,
  getDefaultStructuredOutputModel,
  resolveChatProvider,
  listChatCapableModels,
  listStructuredOutputCapableModels,
  listEmbeddingCapableModels,
  instantiateProvider,
} from './registry'
export type { ChatProviderInfo, ChatModelOption } from './registry'

export {
  AISensitivityError,
  SENSITIVITY_RANK,
  getEffectiveSensitivity,
  assertProviderEligible,
  evaluatePolicy,
  withPolicyGate,
  gateProvider,
  mergeManifests,
} from './sensitivity'
export {
  manifestForDocuments,
  manifestForProject,
  manifestForWorkstream,
  manifestForArtifact,
  manifestForWikiVersion,
  inheritedProjectSensitivityForKnowledgeBases,
} from './policy-manifests'
export type { ContextManifest, ContextManifestEntry, PolicySubject, PolicyDecision } from './sensitivity'

export { withLogging } from './logging'
export type { LogContext } from './logging'

export {
  BuilderAllowanceError,
  computeCost,
  getBuilderSpendSummary,
  withAllowanceGate,
  grantBuilderCredit,
  setBuilderAllowance,
} from './metering'
export type { BuilderSpendSummary, SetBuilderAllowanceInput } from './metering'
