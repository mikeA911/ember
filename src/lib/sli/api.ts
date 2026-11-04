import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { sliErrorMessage } from './errors'
import type { SliContext, TriggerDetail, TriggerSummary, TriggerType } from './types'

// Reads for SLI pages, as the signed-in person. The SLI functions aren't in
// the generated Database type, so they are called through an untyped rpc.
type Client = Awaited<ReturnType<typeof createClient>>

export class SliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SliError'
  }
}

export async function sliRpc<T>(supabase: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)(fn, args)
  if (error) throw new SliError(sliErrorMessage(error))
  return data as T
}

export async function getSliContext(supabase: Client): Promise<SliContext | null> {
  return sliRpc<SliContext | null>(supabase, 'sli_context')
}

export async function listTriggers(supabase: Client, opts: { includeArchived?: boolean; search?: string } = {}): Promise<TriggerSummary[]> {
  return sliRpc<TriggerSummary[]>(supabase, 'sli_list_triggers', { p_include_archived: opts.includeArchived ?? false, p_search: opts.search ?? null })
}

export async function getTrigger(supabase: Client, code: string): Promise<TriggerDetail | null> {
  return sliRpc<TriggerDetail | null>(supabase, 'sli_get_trigger', { p_code: code })
}

export async function listTriggerTypes(supabase: Client): Promise<TriggerType[]> {
  return sliRpc<TriggerType[]>(supabase, 'sli_list_trigger_types')
}
