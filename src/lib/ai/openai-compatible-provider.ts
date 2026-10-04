import 'server-only'
import OpenAI from 'openai'
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
  ToolCall,
} from './provider'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import { AIProviderError, describeError, openAIUsage } from './provider'
import { extractJsonObject, parseToolArguments } from './json-extract'

export interface DiscoveredModel {
  id: string
}

// Generic provider for anything implementing the OpenAI chat/completions
// interface -- Groq is just this class pre-configured with Groq's base URL
// (https://api.groq.com/openai/v1); the same class covers any future local
// (vLLM/Ollama-gateway/LM Studio) or enterprise gateway without a new
// implementation, per the brief's "one reusable compatibility layer".
// Reuses the already-installed `openai` package via its `baseURL` option
// rather than a new SDK dependency.
export class OpenAICompatibleProvider implements AIProvider {
  private client: OpenAI

  constructor(
    readonly name: string,
    apiKey: string,
    private baseURL: string,
    private defaultTextModel?: string,
    // Set only when this provider instance is resolved for an embedding
    // model (registry.ts's getActiveEmbeddingProvider) -- a self-hosted
    // vLLM/Ollama embedding server. embedDimensions is the registry's
    // ai_models.embedding_dimensions: sent as the request's `dimensions`
    // (for models with adjustable output size, e.g. to fit Ember's
    // vector(1536) columns) and checked against what comes back.
    private defaultEmbedModel?: string,
    private embedDimensions?: number
  ) {
    // 60s per attempt -- the SDK default (10 minutes, retried up to 3x) let
    // a single stalled call hang silently for up to ~30 minutes with no
    // visible error, caught live via a Journal generation that never
    // completed or errored within a 2-minute manual test window.
    this.client = new OpenAI({ apiKey, baseURL, timeout: 60_000 })
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const model = this.requireModel(input.model)
    try {
      const res = await this.client.chat.completions.create({
        model,
        messages: [
          ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
          { role: 'user' as const, content: input.prompt },
        ],
        max_completion_tokens: input.maxOutputTokens,
      })
      return {
        text: res.choices[0]?.message?.content ?? '',
        model,
        usage: openAIUsage(res.usage),
      }
    } catch (err) {
      throw new AIProviderError(this.name, 'generate_text', `${this.name} generateText failed: ${describeError(err)}`, err)
    }
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>> {
    const model = this.requireModel(input.model)
    let raw = '{}'
    try {
      const res = await this.client.chat.completions.create({
        model,
        messages: [
          ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
          { role: 'user' as const, content: `${input.prompt}\n\nRespond with a single JSON object only, no prose, no markdown fences.` },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: input.maxOutputTokens,
      })
      raw = res.choices[0]?.message?.content ?? '{}'
      const data = input.schema.parse(extractJsonObject(raw))
      return {
        data,
        model,
        usage: openAIUsage(res.usage),
      }
    } catch (err) {
      throw new AIProviderError(
        this.name,
        'generate_structured',
        `${this.name} generateStructured failed: ${describeError(err)} (raw output: ${raw})`,
        err
      )
    }
  }

  async generateChat(input: GenerateChatInput): Promise<GenerateChatResult> {
    const model = this.requireModel(input.model)
    try {
      const messages: ChatCompletionMessageParam[] = [
        ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
        ...input.messages.map((m): ChatCompletionMessageParam => {
          if (m.role === 'tool') {
            return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content }
          }
          if (m.role === 'assistant') {
            return {
              role: 'assistant',
              content: m.content || null,
              ...(m.toolCalls?.length
                ? {
                    tool_calls: m.toolCalls.map((tc) => ({
                      id: tc.id,
                      type: 'function' as const,
                      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                    })),
                  }
                : {}),
            }
          }
          return { role: 'user', content: m.content }
        }),
      ]

      const tools: ChatCompletionTool[] | undefined = input.tools?.length
        ? input.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
          }))
        : undefined

      const res = await this.client.chat.completions.create({
        model,
        messages,
        tools,
        max_completion_tokens: input.maxOutputTokens,
      })

      const responseMessage = res.choices[0]?.message
      const toolCalls: ToolCall[] = (responseMessage?.tool_calls ?? [])
        .filter((tc) => tc.type === 'function')
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: parseToolArguments(tc.function.arguments),
        }))

      const message: ChatMessage = {
        role: 'assistant',
        content: responseMessage?.content ?? '',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      }

      return {
        message,
        model,
        usage: openAIUsage(res.usage),
      }
    } catch (err) {
      throw new AIProviderError(this.name, 'generate_chat', `${this.name} generateChat failed: ${describeError(err)}`, err)
    }
  }

  // Self-hosted embedding servers (vLLM, Ollama, LM Studio) expose the same
  // POST /v1/embeddings as OpenAI. A provider with no embedding model
  // configured (Groq, or any generation-only gateway) still fails
  // explicitly rather than calling an endpoint that doesn't exist --
  // capability filtering means that should never be reached in normal use.
  async embed(input: EmbedInput): Promise<EmbedResult> {
    const model = input.model ?? this.defaultEmbedModel
    if (!model) {
      throw new AIProviderError(this.name, 'embed', `${this.name} does not support embeddings`, undefined, 'model_unavailable')
    }
    let embedding: number[]
    let inputTokens: number | null
    try {
      const res = await this.client.embeddings.create({
        model,
        input: input.text,
        ...(this.embedDimensions ? { dimensions: this.embedDimensions } : {}),
      })
      embedding = res.data[0]?.embedding ?? []
      inputTokens = res.usage?.prompt_tokens ?? null
    } catch (err) {
      throw new AIProviderError(this.name, 'embed', `${this.name} embed failed: ${describeError(err)}`, err)
    }
    // A mismatch would otherwise surface later as an opaque pgvector
    // dimension error on the kb_vectors/wiki_vectors insert.
    if (this.embedDimensions && embedding.length !== this.embedDimensions) {
      throw new AIProviderError(
        this.name,
        'embed',
        `${this.name} returned a ${embedding.length}-dimension embedding for ${model}, but the model is registered with ${this.embedDimensions} dimensions`,
        undefined,
        'invalid_request'
      )
    }
    return { embedding, model, dimensions: embedding.length, usage: { inputTokens, outputTokens: null } }
  }

  // Best-effort discovery for the admin "Refresh Models" action -- returns
  // what the provider currently lists, never writes anything itself. Not
  // every OpenAI-compatible gateway implements GET /models; a failure here
  // surfaces as a normal thrown error for the caller to handle.
  async listModels(): Promise<DiscoveredModel[]> {
    try {
      const res = await this.client.models.list()
      return res.data.map((m) => ({ id: m.id }))
    } catch (err) {
      throw new AIProviderError(this.name, 'generate_text', `${this.name} model discovery failed: ${describeError(err)}`, err)
    }
  }

  private requireModel(model: string | undefined): string {
    const resolved = model ?? this.defaultTextModel
    if (!resolved) {
      throw new AIProviderError(this.name, 'generate_text', `${this.name} call made with no model specified and no default configured`, undefined, 'invalid_request')
    }
    return resolved
  }
}
