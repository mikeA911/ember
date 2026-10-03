import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { getAgencyDashboard } from '@/lib/workbench/agency-dashboard'
import { AgencyDashboardView } from '@/components/agency/AgencyDashboardView'
import { AgencySummaryButton } from '@/components/agency/AgencySummaryButton'

// Builder agency dashboard -- see src/lib/workbench/agency-dashboard.ts.
// Gated on the viewer's own session profile role; getAgencyDashboard checks
// it again and scopes every query to the builders the viewer may see.
export default async function AgencyPage() {
  const ctx = await requireUser().catch(() => null)
  if (!ctx) redirect('/login')
  if (ctx.profile.role !== 'admin' && ctx.profile.role !== 'curator') redirect('/dashboard')

  const dashboard = await getAgencyDashboard(ctx)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{dashboard.viewerIsAdmin ? 'Builder Agencies' : 'My Builders'}</h1>
          <AgencySummaryButton dashboard={dashboard} />
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Each builder&apos;s client proposals, the client projects created from accepted ones -- with their workstreams, knowledge
          bases and completion -- and requests waiting on you.
          Status, dates and the progress updates builders choose to
          share -- their notebooks, conversations and drafts stay private to them.
        </p>
      </div>
      <AgencyDashboardView dashboard={dashboard} />
    </div>
  )
}
