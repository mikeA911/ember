import { redirect } from 'next/navigation'
import { AuthError, requireUser } from '@/lib/auth'
import { getDefaultStructuredOutputModel } from '@/lib/ai'
import { JournalGenerator } from '@/components/profile/JournalGenerator'

// Hierarchical generation for longer ranges can involve several sequential
// LLM calls -- raise the default function duration so a 6-month journal has
// room to finish. If the deployment's plan caps function duration below
// this, that's the signal to move generation to the deferred background-job
// design (see docs/dev-request-private-work-journal.md's retention section)
// rather than lower this further.
export const maxDuration = 60

export default async function JournalPage() {
  let ctx
  try {
    ctx = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) redirect('/login')
    throw err
  }
  if (ctx.profile.role === 'anonymous') redirect('/profile')

  let modelLabel = "the platform's configured AI model"
  try {
    const { provider, model } = await getDefaultStructuredOutputModel(ctx.supabase)
    modelLabel = `${provider.display_name} / ${model.display_name}`
  } catch {
    // handled by the fallback label above
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium">My Work Journal</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Generate a private, reflective summary of your own authorized activity in Ember. AI ({modelLabel}) reads and summarizes
          what you choose to include, to help you remember and revisit your work. This document is generated fresh each time, is never
          saved by Ember, and does not become Assistant memory -- only you can see or download it, unless you choose to share the
          file yourself.
        </p>
      </div>
      <JournalGenerator />
    </div>
  )
}
