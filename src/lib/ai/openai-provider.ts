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

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai'
  private client: OpenAI

  constructor(
    apiKey: string,
    private defaultTextModel: string = 'gpt-4o-mini',
    private defaultEmbedModel: string = 'text-embedding-3-small'
  ) {
    // 60s per attempt -- the SDK default (10 minutes, retried up to 3x) let
    // a single stalled call hang silently for up to ~30 minutes with no
    // visible error, caught live via a Journal generation that never
    // completed or errored within a 2-minute manual test window.
    this.client = new OpenAI({ apiKey, timeout: 60_000 })
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const model = input.model ?? this.defaultTextModel
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
      throw new AIProviderError('openai', 'generate_text', `OpenAI generateText failed: ${describeError(err)}`, err)
    }
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>> {
    const model = input.model ?? this.defaultTextModel
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
        'openai',
        'generate_structured',
        `OpenAI generateStructured failed: ${describeError(err)} (raw output: ${raw})`,
        err
      )
    }
  }

  async generateChat(input: GenerateChatInput): Promise<GenerateChatResult> {
    const model = input.model ?? this.defaultTextModel
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
      throw new AIProviderError('openai', 'generate_chat', `OpenAI generateChat failed: ${describeError(err)}`, err)
    }
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const model = input.model ?? this.defaultEmbedModel
    try {
      const res = await this.client.embeddings.create({ model, input: input.text })
      const embedding = res.data[0]?.embedding ?? []
      return {
        embedding,
        model,
        dimensions: embedding.length,
        usage: { inputTokens: res.usage?.prompt_tokens ?? null, outputTokens: null },
      }
    } catch (err) {
      throw new AIProviderError('openai', 'embed', `OpenAI embed failed: ${describeError(err)}`, err)
    }
  }
}
