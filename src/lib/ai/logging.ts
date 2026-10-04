import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { AIProviderError } from './provider'
import { computeCost } from './metering'
import type {
  AIProvider,
  EmbedInput,
  GenerateChatInput,
  GenerateStructuredInput,
  GenerateTextInput,
} from './provider'
import type { AITask } from './tasks'

// Every provider's own catch block already classifies its cause (see
// classifyProviderError in provider.ts) -- reuse that instead of losing it
// here. A plain thrown Error (not an AIProviderError) has no such
// classification, so it's recorded as null rather than a guessed default.
function errorCodeOf(err: unknown): string | null {
  return err instanceof AIProviderError ? err.errorCode : null
}

export interface LogContext {
  // Required, so every call site says what its AI calls are for -- the
  // basis of cost reporting per task (src/lib/ai/tasks.ts).
  task: AITask
  documentId?: string
  chunkId?: string
  requestedBy?: string
  evalRunId?: string
  evalCaseId?: string
  graphRunId?: string
  graphStepId?: string
  // Builder AI Usage Metering (src/lib/ai/metering.ts): projectId attributes
  // this call to a builder's own builder_lab Project for spend rollups.
  // isByoLlm marks a call made through a builder's own supplied credential
  // (src/lib/workbench/builder-llm-credentials.ts) -- its cost is never
  // computed/counted against the platform's own budget, so it's recorded
  // with estimated_cost_usd left null rather than priced.
  projectId?: string
  isByoLlm?: boolean
  // Fired with the new ai_operation_logs row's id right after insert -- this
  // is how a graph node wrapper (src/lib/graph/persistence.ts) links
  // graph_steps.ai_operation_log_id to the log row its own AI call produced.
  // A plain return value from record() can't reach the node's calling code
  // (record() fires inside this wrapper, several layers removed) -- a
  // callback works because JS is single-threaded, so it fires before the
  // awaited generateText()/etc. call resolves back to the caller.
  onLogged?: (id: string) => void
}

// Wraps any AIProvider so every call is recorded in ai_operation_logs --
// provider, model, latency, token counts, success/failure -- without each
// call site having to remember to log. Logging itself always uses the
// service-role client (this is infrastructure bookkeeping, not user data;
// see the ai_operation_logs RLS policy, which has no client insert path).
export function withLogging(provider: AIProvider, context: LogContext): AIProvider {
  const record = async (
    operation: 'generate_text' | 'generate_structured' | 'generate_chat' | 'embed',
    model: string,
    startedAt: number,
    outcome:
      | { success: true; inputTokens: number | null; outputTokens: number | null; cachedInputTokens?: number | null }
      | { success: false; error: string; errorCode: string | null }
  ) => {
    const admin = createAdminClient()
    const isByoLlm = context.isByoLlm ?? false
    const estimatedCostUsd =
      outcome.success && !isByoLlm ? await computeCost(admin, provider.name, model, outcome.inputTokens, outcome.outputTokens) : null
    const { data } = await admin
      .from('ai_operation_logs')
      .insert({
        operation,
        task: context.task,
        provider: provider.name,
        model,
        document_id: context.documentId ?? null,
        chunk_id: context.chunkId ?? null,
        requested_by: context.requestedBy ?? null,
        eval_run_id: context.evalRunId ?? null,
        eval_case_id: context.evalCaseId ?? null,
        graph_run_id: context.graphRunId ?? null,
        graph_step_id: context.graphStepId ?? null,
        project_id: context.projectId ?? null,
        is_byo_llm: isByoLlm,
        estimated_cost_usd: estimatedCostUsd,
        latency_ms: Date.now() - startedAt,
        input_tokens: outcome.success ? outcome.inputTokens : null,
        output_tokens: outcome.success ? outcome.outputTokens : null,
        cached_input_tokens: outcome.success ? (outcome.cachedInputTokens ?? null) : null,
        success: outcome.success,
        error_message: outcome.success ? null : outcome.error,
        error_code: outcome.success ? null : outcome.errorCode,
      })
      .select('id')
      .single()
    if (data) context.onLogged?.(data.id)
  }

  return {
    name: provider.name,

    async generateText(input: GenerateTextInput) {
      const startedAt = Date.now()
      try {
        const result = await provider.generateText(input)
        await record('generate_text', result.model, startedAt, { success: true, ...result.usage })
        return result
      } catch (err) {
        await record('generate_text', 'unknown', startedAt, { success: false, error: (err as Error).message, errorCode: errorCodeOf(err) })
        throw err
      }
    },

    async generateStructured<T>(input: GenerateStructuredInput<T>) {
      const startedAt = Date.now()
      try {
        const result = await provider.generateStructured(input)
        await record('generate_structured', result.model, startedAt, { success: true, ...result.usage })
        return result
      } catch (err) {
        await record('generate_structured', 'unknown', startedAt, {
          success: false,
          error: (err as Error).message,
          errorCode: errorCodeOf(err),
        })
        throw err
      }
    },

    async generateChat(input: GenerateChatInput) {
      const startedAt = Date.now()
      try {
        const result = await provider.generateChat(input)
        await record('generate_chat', result.model, startedAt, { success: true, ...result.usage })
        return result
      } catch (err) {
        await record('generate_chat', 'unknown', startedAt, { success: false, error: (err as Error).message, errorCode: errorCodeOf(err) })
        throw err
      }
    },

    async embed(input: EmbedInput) {
      const startedAt = Date.now()
      try {
        const result = await provider.embed(input)
        await record('embed', result.model, startedAt, { success: true, ...result.usage })
        return result
      } catch (err) {
        await record('embed', 'unknown', startedAt, { success: false, error: (err as Error).message, errorCode: errorCodeOf(err) })
        throw err
      }
    },
  }
}
