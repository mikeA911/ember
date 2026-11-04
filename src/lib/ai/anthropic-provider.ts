import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type {
  AIProvider,
  ChatMessage,
  EmbedInput,
  EmbedResult,
  GenerateChatInput,
  GenerateChatResult,
  GenerateStructuredInput,
  GenerateStructuredResult,
  GenerateTextInput,
  GenerateTextResult,
  TokenUsage,
  ToolCall,
} from './provider'
import { AIProviderError, describeError } from './provider'
import { extractJsonObject } from './json-extract'

// Claude, through Anthropic's own SDK and Messages API. Current Claude
// models always think before answering (adaptive thinking); thinking counts
// against max_tokens, so short-answer calls get a floor (MIN_OUTPUT_TOKENS)
// and low effort, so a requested 300-token answer isn't cut off by its own
// reasoning. Claude has no embeddings: embedding stays with an OpenAI or
// Gemini model (the registry's separate embedding default).

const DEFAULT_MODEL = 'claude-opus-5-5'
const DEFAULT_MAX_TOKENS = 16000
const MIN_OUTPUT_TOKENS = 4096

// What a refused request returns instead of an answer (stop_reason
// 'refusal'): plain text the chat shows, so the person can rephrase or pick
// another model.
export const CLAUDE_REFUSAL_MESSAGE = 'Claude declined to answer this request. Try rephrasing it, or choose a different model.'

function outputTokens(requested: number | undefined): number {
  return Math.max(requested ?? DEFAULT_MAX_TOKENS, MIN_OUTPUT_TOKENS)
}

function usageOf(message: Anthropic.Message): TokenUsage {
  return {
    inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
    outputTokens: message.usage.output_tokens,
    cachedInputTokens: message.usage.cache_read_input_tokens ?? null,
  }
}

function textOf(message: Anthropic.Message): string {
  if (message.stop_reason === 'refusal') return CLAUDE_REFUSAL_MESSAGE
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

// Tool parameters arrive as JSON Schema (zod's toJSONSchema); the Messages
// API takes an object schema without the $schema marker.
function inputSchema(parameters: unknown): Anthropic.Tool.InputSchema {
  const schema = { ...((parameters as Record<string, unknown>) ?? {}) }
  delete schema.$schema
  return { ...schema, type: 'object' } as Anthropic.Tool.InputSchema
}

// Ember's history -> Messages API turns. An assistant turn that called
// tools is sent back exactly as Claude produced it (its thinking and
// tool_use blocks, kept in the first call's providerData), which the API
// needs to continue reasoning across tool calls. Consecutive tool results
// go back together in one user turn.
export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      const result: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(result)
      } else {
        out.push({ role: 'user', content: [result] })
      }
      continue
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    const original = m.toolCalls?.[0]?.providerData?.anthropicContent
    if (Array.isArray(original)) {
      out.push({ role: 'assistant', content: original as Anthropic.ContentBlockParam[] })
      continue
    }
    const blocks: Anthropic.ContentBlockParam[] = []
    if (m.content) blocks.push({ type: 'text', text: m.content })
    for (const tc of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
    if (blocks.length > 0) out.push({ role: 'assistant', content: blocks })
  }
  return out
}

export function fromAnthropicMessage(message: Anthropic.Message): ChatMessage {
  const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const toolCalls: ToolCall[] = toolUses.map((b, i) => ({
    id: b.id,
    name: b.name,
    arguments: (b.input as Record<string, unknown>) ?? {},
    ...(i === 0 ? { providerData: { anthropicContent: message.content } } : {}),
  }))
  return {
    role: 'assistant',
    content: textOf(message),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }
}

export class AnthropicProvider implements AIProvider {
  readonly name: string
  private client: Anthropic

  constructor(
    apiKey: string,
    private defaultTextModel: string = DEFAULT_MODEL,
    name = 'anthropic'
  ) {
    this.name = name
    // Longer than the other providers' 60s: Claude reasons before it
    // answers, and research turns can take a while.
    this.client = new Anthropic({ apiKey, timeout: 180_000 })
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const model = input.model ?? this.defaultTextModel
    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: outputTokens(input.maxOutputTokens),
        output_config: { effort: 'low' },
        ...(input.system ? { system: input.system } : {}),
        messages: [{ role: 'user', content: input.prompt }],
      })
      return { text: textOf(res), model, usage: usageOf(res) }
    } catch (err) {
      throw new AIProviderError(this.name, 'generate_text', `Claude generateText failed: ${describeError(err)}`, err)
    }
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>> {
    const model = input.model ?? this.defaultTextModel
    let raw = '{}'
    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: outputTokens(input.maxOutputTokens),
        output_config: { effort: 'low' },
        ...(input.system ? { system: input.system } : {}),
        messages: [{ role: 'user', content: `${input.prompt}\n\nRespond with a single JSON object only, no prose, no markdown fences.` }],
      })
      raw = textOf(res) || '{}'
      const data = input.schema.parse(extractJsonObject(raw))
      return { data, model, usage: usageOf(res) }
    } catch (err) {
      throw new AIProviderError(this.name, 'generate_structured', `Claude generateStructured failed: ${describeError(err)} (raw output: ${raw})`, err)
    }
  }

  async generateChat(input: GenerateChatInput): Promise<GenerateChatResult> {
    const model = input.model ?? this.defaultTextModel
    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: outputTokens(input.maxOutputTokens),
        // The system prompt and tools are the same on every turn of a
        // conversation; caching them makes later turns cheaper and faster.
        cache_control: { type: 'ephemeral' },
        ...(input.system ? { system: input.system } : {}),
        ...(input.tools?.length
          ? {
              tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: inputSchema(t.parameters) })),
            }
          : {}),
        messages: toAnthropicMessages(input.messages),
      })
      return { message: fromAnthropicMessage(res), model, usage: usageOf(res) }
    } catch (err) {
      throw new AIProviderError(this.name, 'generate_chat', `Claude generateChat failed: ${describeError(err)}`, err)
    }
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    throw new AIProviderError(
      this.name,
      'embed',
      `Claude has no embedding models (asked for ${input.model ?? 'the default'}). Use an OpenAI or Gemini embedding model.`,
      undefined,
      'model_unavailable'
    )
  }
}
