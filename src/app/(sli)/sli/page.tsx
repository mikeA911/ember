import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { getDecisionSettings, getHandoffInbox, getSliContext, listTriggers } from '@/lib/sli/api'
import { CalmHome, type HomeNote } from '@/components/sli/CalmHome'
import type { TriggerStage } from '@/lib/sli/types'

export const metadata = { title: 'Home' }

const RESEARCH: TriggerStage[] = ['researching', 'concept', 'feasibility', 'under_review', 'targeting']
const MAX_NOTES = 3

// The calm Home (docs/design-notes/ember-sli-calm-workspace.md §2): what
// is waiting, said once and quietly, a couple of suggestions from the
// person's own work, and a general conversation with Ember. The lists are
// in My work (/sli/my-work).
export default async function SliHomePage() {
  const supabase = await createClient()
  const [{ profile }, ctx, triggers, decisionSettings, inbox] = await Promise.all([
    requireUser(),
    getSliContext(supabase),
    listTriggers(supabase),
    getDecisionSettings(supabase),
    getHandoffInbox(supabase),
  ])

  const waiting: HomeNote[] = []
  for (const d of decisionSettings?.waitingForMe ?? []) {
    waiting.push({ text: `${d.code} is waiting for your decision`, href: `/sli/discovery/${d.code}` })
  }
  for (const h of inbox?.toAnswer ?? []) {
    waiting.push({
      text: h.kind === 'promote' ? `${h.code} is waiting for your answer on its handoff to ${h.department}` : `${h.department} sent ${h.code} back; it’s waiting for your answer`,
      href: `/sli/discovery/${h.code}`,
    })
  }
  if (ctx?.canSponsor) {
    for (const t of triggers.filter((x) => x.stage === 'new')) {
      waiting.push({ text: `${t.code} is waiting for a sponsor`, href: `/sli/discovery/${t.code}` })
    }
  }

  const suggestions: HomeNote[] = triggers
    .filter((t) => t.access === 'full' && (t.sponsoredByMe || ctx?.isDiscoveryMember) && RESEARCH.includes(t.stage))
    .sort((a, b) => Number(b.sponsoredByMe) - Number(a.sponsoredByMe))
    .slice(0, 2)
    .map((t) => ({ text: `Continue ${t.code} · ${t.title}`, href: `/sli/discovery/${t.code}/workspace` }))

  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? null
  return (
    <CalmHome
      firstName={firstName}
      productName={ctx?.productName ?? 'Ember SLI'}
      organizationName={ctx?.organizationName ?? ''}
      notes={waiting.slice(0, MAX_NOTES)}
      moreWaiting={Math.max(0, waiting.length - MAX_NOTES)}
      suggestions={suggestions}
      canRaise={!!ctx?.isDepartmentMember}
    />
  )
}
