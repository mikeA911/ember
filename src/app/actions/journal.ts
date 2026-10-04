'use server'

import { z } from 'zod'
import { AuthError, requireUser } from '@/lib/auth'
import { getActiveStructuredOutputProvider, getDefaultStructuredOutputModel } from '@/lib/ai'
import { generateJournal, type JournalContent, type JournalSourceConversation, type RelatedActivityItem } from '@/lib/journal/generate'

const JournalOptionsSchema = z.object({
  range: z.enum(['last_30_days', 'last_6_months', 'this_year', 'custom']),
  from: z.string().optional(),
  to: z.string().optional(),
  includeRelatedActivity: z.boolean(),
  detail: z.enum(['brief', 'standard', 'detailed']),
  style: z.enum(['reflective', 'factual']),
  excludedConversationIds: z.array(z.string()).default([]),
  excludedProjectIds: z.array(z.string()).default([]),
})

export interface JournalPreviewResult {
  content: JournalContent
  conversations: JournalSourceConversation[]
  relatedActivity: RelatedActivityItem[]
  projects: { id: string; name: string }[]
  truncated: boolean
  rangeLabel: string
  providerDisplayName: string
  modelDisplayName: string
}

// Nothing here is written to the database -- generateJournal() is a pure
// read + in-memory generation. See docs/dev-request-private-work-journal.md
// ("no implicit persistence") -- the client holds this result between
// preview and download; see /profile/journal/export/route.ts.
export async function previewJournalAction(input: unknown): Promise<JournalPreviewResult> {
  const ctx = await requireUser()
  if (ctx.profile.role === 'anonymous') throw new AuthError('Journals are not available for anonymous accounts')

  const options = JournalOptionsSchema.parse(input)

  const [{ provider: providerRow, model: modelRow }, provider] = await Promise.all([
    getDefaultStructuredOutputModel(ctx.supabase),
    getActiveStructuredOutputProvider(ctx.supabase, { task: 'journal', requestedBy: ctx.user.id }),
  ])

  const result = await generateJournal(ctx, provider, options)

  return {
    ...result,
    providerDisplayName: providerRow.display_name,
    modelDisplayName: modelRow.display_name,
  }
}
