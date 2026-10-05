import 'server-only'
import type { z } from 'zod'

// Generic AI provider contract. Nothing here names a specific vendor, model,
// or embedding dimension -- callers get back whatever the active provider
// actually produced (model name, dimensions) and record it as provenance,
// rather than assuming a fixed shape. Swapping OpenAI <-> Gemini <-> a future
// local/OpenAI-compatible provider means writing a new class that implements
// this interface, not touching call sites.

export interface TokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  // The part of inputTokens the provider served from its prompt cache, when
  // it reports one -- providers cache repeated prompt openings automatically
  // and bill those tokens at a discount. null when not reported. Optional so
  // results that never involve a cache (embeddings) can leave it out.
  cachedInputTokens?: number | null
}

// OpenAI and OpenAI-compatible chat usage: OpenAI, Groq and xAI report
// prompt_tokens_details.cached_tokens; DeepSeek reports
// prompt_cache_hit_tokens instead.
export function openAIUsage(
  usage:
    | {
        prompt_tokens?: number | null
        completion_tokens?: number | null
        prompt_tokens_details?: { cached_tokens?: number | null } | null
        prompt_cache_hit_tokens?: number | null
      }
    | null
    | undefined
): TokenUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? null,
  }
}

export interface GenerateTextInput {
  prompt: string
  system?: string
  maxOutputTokens?: number
  // Overrides the provider instance's constructor-supplied default model --
  // this is what lets an Eval run pick a specific model per call while every
  // other caller (chunk enrichment, Wiki synthesis) keeps using whatever the
  // provider was built with.
  model?: string
}

export interface GenerateTextResult {
  text: string
  model: string
  usage: TokenUsage
}

export interface GenerateStructuredInput<T> {
  prompt: string
  system?: string
  schema: z.ZodType<T>
  maxOutputTokens?: number
  model?: string
}

export interface GenerateStructuredResult<T> {
  data: T
  model: string
  usage: TokenUsage
}

// M6D: multi-turn, tool-calling chat -- additive to the interface, existing
// generateText/generateStructured/embed callers are untouched. A ToolCall's
// `arguments` and a tool result's `content` are both caller-defined JSON;
// this interface doesn't know or care what a "tool" is, just how to carry
// one across a provider's own function-calling wire format.
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  // Opaque, provider-specific data a provider needs echoed back on a later
  // turn to correctly resume from this exact call -- e.g. Gemini's
  // thought_signature (required on any function-call part sent back to a
  // "thinking" model, or the API rejects the request). Other providers
  // never set or read this; it round-trips through chat_messages.tool_calls
  // (jsonb) like the rest of a ToolCall.
  providerData?: Record<string, unknown>
}

export interface ToolSpec {
  name: string
  description: string
  // A JSON Schema object (e.g. from zod's `z.toJSONSchema()`), not a zod
  // schema itself -- keeps this interface independent of any particular
  // schema library.
  parameters: unknown
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  // Empty/omitted on an assistant message that is purely a tool call.
  content: string
  toolCalls?: ToolCall[]
  // Required on a 'tool' role message -- which call this is the result of.
  toolCallId?: string
  toolName?: string
}

export interface GenerateChatInput {
  messages: ChatMessage[]
  system?: string
  tools?: ToolSpec[]
  maxOutputTokens?: number
  model?: string
  // Groups calls that share a long prompt opening (system prompt + tools)
  // so the provider can serve it from its prompt cache. Only OpenAI takes
  // it (prompt_cache_key); others cache by prefix on their own and ignore it.
  cacheKey?: string
}

export interface GenerateChatResult {
  message: ChatMessage
  model: string
  usage: TokenUsage
}

export interface EmbedInput {
  text: string
  model?: string
}

export interface EmbedResult {
  embedding: number[]
  model: string
  dimensions: number
  usage: TokenUsage
}

export type ProviderErrorCode =
  | 'rate_limit'
  | 'quota_exceeded'
  | 'model_unavailable'
  | 'authentication'
  | 'invalid_request'
  | 'unknown'

export class AIProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly operation: 'generate_text' | 'generate_structured' | 'generate_chat' | 'embed',
    message: string,
    public readonly cause?: unknown,
    public readonly errorCode: ProviderErrorCode = classifyProviderError(cause)
  ) {
    super(message)
    this.name = 'AIProviderError'
  }
}

// Distinguishes *why* a provider call failed from the caught SDK error's
// status/message, so callers (eval failure classification in particular)
// don't have to re-derive this from a generic "request failed" string. Not
// full quota-header telemetry -- just enough to tell "we're rate limited"
// from "this model doesn't exist" from "the API key is wrong".
export function classifyProviderError(err: unknown): ProviderErrorCode {
  const status = (err as { status?: number })?.status
  const message = String((err as { message?: string })?.message ?? err ?? '').toLowerCase()

  if (status === 401 || status === 403 || message.includes('api key') || message.includes('unauthorized')) {
    return 'authentication'
  }
  if (status === 404 || message.includes('does not exist') || message.includes('not found') || message.includes('no longer available')) {
    return 'model_unavailable'
  }
  // Groq's TPM (tokens-per-minute) ceiling returns 413 "Request too large"
  // rather than 429 -- same capacity-limit family as a plain rate limit
  // (observed live: `code: 'rate_limit_exceeded'` in the SDK error body, but
  // that substring is on `.code`, not `.message`, so it needs its own check
  // rather than falling out of the 'rate limit' text match below).
  if (status === 429 || status === 413 || message.includes('rate limit') || message.includes('tokens per minute') || message.includes('rate_limit_exceeded')) {
    return message.includes('quota') || message.includes('credit') ? 'quota_exceeded' : 'rate_limit'
  }
  if (message.includes('quota') || message.includes('insufficient_quota') || message.includes('credit')) {
    return 'quota_exceeded'
  }
  if (status === 400 || message.includes('invalid')) {
    return 'invalid_request'
  }
  return 'unknown'
}

// The human-readable half of what classifyProviderError classifies --
// every provider's catch block folds this into its AIProviderError message,
// which is what actually lands in ai_operation_logs.error_message via
// withLogging. Before this existed, every provider threw a hard-coded
// generic string ("groq generateChat failed") and the real SDK error was
// only ever attached as .cause, never persisted anywhere -- caught live via
// a real failure that turned out to be undiagnosable after the fact.
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface AIProvider {
  readonly name: string
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>
  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>>
  generateChat(input: GenerateChatInput): Promise<GenerateChatResult>
  embed(input: EmbedInput): Promise<EmbedResult>
}
