import 'server-only'
import { GoogleGenAI } from '@google/genai'
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
import type { Content } from '@google/genai'
import { AIProviderError, describeError } from './provider'
import { extractJsonObject } from './json-extract'

// gemini-embedding-001's native output is much larger than older models';
// pin it down to match kb_vectors/wiki_vectors' vector(1536) column instead
// of letting it default to a size Postgres would reject on insert.
const DEFAULT_EMBED_DIMENSIONS = 1536

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini'
  private client: GoogleGenAI

  constructor(
    apiKey: string,
    private defaultTextModel: string = 'gemini-3.5-flash',
    private defaultEmbedModel: string = 'gemini-embedding-001',
    private embedDimensions: number = DEFAULT_EMBED_DIMENSIONS
  ) {
    // 60s per attempt -- see openai-provider.ts's constructor comment for
    // why an explicit timeout matters (a stalled call with no timeout can
    // hang far longer than any UI would wait, with no visible error).
    this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60_000 } })
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const model = input.model ?? this.defaultTextModel
    try {
      const res = await this.client.models.generateContent({
        model,
        contents: input.prompt,
        config: {
          systemInstruction: input.system,
          maxOutputTokens: input.maxOutputTokens,
          // Observed live: with thinking left on its default (AUTOMATIC),
          // this model spends part of maxOutputTokens on invisible reasoning
          // and can truncate the actual answer before it finishes. Disabled
          // since these calls need a direct answer, not shown reasoning.
          thinkingConfig: { thinkingBudget: 0 },
        },
      })
      return {
        text: res.text ?? '',
        model,
        usage: {
          inputTokens: res.usageMetadata?.promptTokenCount ?? null,
          outputTokens: res.usageMetadata?.candidatesTokenCount ?? null,
          cachedInputTokens: res.usageMetadata?.cachedContentTokenCount ?? null,
        },
      }
    } catch (err) {
      throw new AIProviderError('gemini', 'generate_text', `Gemini generateText failed: ${describeError(err)}`, err)
    }
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>> {
    const model = input.model ?? this.defaultTextModel
    let raw = '{}'
    try {
      const res = await this.client.models.generateContent({
        model,
        contents: `${input.prompt}\n\nRespond with a single JSON object only, no prose, no markdown fences.`,
        config: {
          systemInstruction: input.system,
          responseMimeType: 'application/json',
          maxOutputTokens: input.maxOutputTokens,
          // See generateText's comment -- this is what was actually causing
          // the truncated-JSON failures observed against the live API.
          thinkingConfig: { thinkingBudget: 0 },
        },
      })
      raw = res.text ?? '{}'
      const data = input.schema.parse(extractJsonObject(raw))
      return {
        data,
        model,
        usage: {
          inputTokens: res.usageMetadata?.promptTokenCount ?? null,
          outputTokens: res.usageMetadata?.candidatesTokenCount ?? null,
          cachedInputTokens: res.usageMetadata?.cachedContentTokenCount ?? null,
        },
      }
    } catch (err) {
      throw new AIProviderError(
        'gemini',
        'generate_structured',
        `Gemini generateStructured failed: ${describeError(err)} (raw output: ${raw})`,
        err
      )
    }
  }

  // Gemini's Content.role only accepts 'user'/'model' (per the SDK's own
  // type comment) -- there is no distinct 'function' role in this API
  // version. A tool result therefore goes back as a 'user'-role Content
  // carrying a functionResponse part, not a separate role.
  async generateChat(input: GenerateChatInput): Promise<GenerateChatResult> {
    const model = input.model ?? this.defaultTextModel
    try {
      const contents: Content[] = input.messages.map((m) => {
        if (m.role === 'user') return { role: 'user', parts: [{ text: m.content }] }
        if (m.role === 'tool') {
          return {
            role: 'user',
            parts: [{ functionResponse: { id: m.toolCallId, name: m.toolName, response: { result: m.content } } }],
          }
        }
        return {
          role: 'model',
          parts: [
            ...(m.content ? [{ text: m.content }] : []),
            // thoughtSignature must be echoed back on the same part as the
            // functionCall it belongs to -- Gemini rejects the next request
            // with "Function call is missing a thought_signature" otherwise
            // (a thinking model needs to reconstruct the reasoning that led
            // to that specific call). Absent for calls from a non-thinking
            // provider's history, if a conversation ever mixes providers.
            ...(m.toolCalls ?? []).map((tc) => ({
              functionCall: { id: tc.id, name: tc.name, args: tc.arguments },
              ...(typeof tc.providerData?.thoughtSignature === 'string'
                ? { thoughtSignature: tc.providerData.thoughtSignature }
                : {}),
            })),
          ],
        }
      })

      const res = await this.client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: input.system,
          maxOutputTokens: input.maxOutputTokens,
          thinkingConfig: { thinkingBudget: 0 },
          tools: input.tools?.length
            ? [
                {
                  functionDeclarations: input.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.parameters,
                  })),
                },
              ]
            : undefined,
        },
      })

      // Walk the raw parts (not the res.functionCalls convenience getter --
      // it discards thoughtSignature, which sits on the same Part as
      // functionCall, not on FunctionCall itself) so each call's signature
      // can be captured and later echoed back on the same turn's request.
      const functionCallParts = (res.candidates?.[0]?.content?.parts ?? []).filter((p) => p.functionCall)
      const toolCalls: ToolCall[] = functionCallParts.map((p, i) => ({
        id: p.functionCall?.id ?? `${p.functionCall?.name ?? 'call'}-${i}`,
        name: p.functionCall?.name ?? '',
        arguments: p.functionCall?.args ?? {},
        ...(p.thoughtSignature ? { providerData: { thoughtSignature: p.thoughtSignature } } : {}),
      }))

      const message: ChatMessage = {
        role: 'assistant',
        content: res.text ?? '',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      }

      return {
        message,
        model,
        usage: {
          inputTokens: res.usageMetadata?.promptTokenCount ?? null,
          outputTokens: res.usageMetadata?.candidatesTokenCount ?? null,
          cachedInputTokens: res.usageMetadata?.cachedContentTokenCount ?? null,
        },
      }
    } catch (err) {
      throw new AIProviderError('gemini', 'generate_chat', `Gemini generateChat failed: ${describeError(err)}`, err)
    }
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const model = input.model ?? this.defaultEmbedModel
    try {
      const res = await this.client.models.embedContent({
        model,
        contents: [input.text],
        config: { outputDimensionality: this.embedDimensions },
      })
      const embedding = res.embeddings?.[0]?.values ?? []
      return {
        embedding,
        model,
        dimensions: embedding.length,
        usage: { inputTokens: null, outputTokens: null },
      }
    } catch (err) {
      throw new AIProviderError('gemini', 'embed', `Gemini embed failed: ${describeError(err)}`, err)
    }
  }
}
