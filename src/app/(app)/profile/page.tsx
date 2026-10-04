import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProfileForm } from '@/components/ProfileForm'
import { BuilderLlmCredentialForm } from '@/components/profile/BuilderLlmCredentialForm'
import { getBuilderSpendSummary } from '@/lib/ai'
import { getBuilderLlmCredentialStatus } from '@/lib/workbench/builder-llm-credentials'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { env } from '@/lib/env'
import { ConnectedAiApps, type ConnectedAppActivity, type ConnectedAppGrant } from '@/components/profile/ConnectedAiApps'
import { listMcpActivity } from '@/lib/mcp/admin'
import type { Profile, UserRole } from '@/types/database'

const ROLE_LABELS: Record<UserRole, string> = {
  anonymous: 'Anonymous visitor',
  member: 'Member',
  consultant: 'Consultant',
  curator: 'Curator',
  admin: 'Admin',
}

export default async function ProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profileRow) redirect('/login')
  const profile = profileRow as Profile

  // Builder AI Usage Metering + BYOLLM: only ever relevant to a builder
  // (consultant role) -- a member or platform staff never sees either card.
  const isBuilder = profile.role === 'consultant'
  let spendSummary: Awaited<ReturnType<typeof getBuilderSpendSummary>> | null = null
  let llmCredentialStatus: Awaited<ReturnType<typeof getBuilderLlmCredentialStatus>> = null
  if (isBuilder) {
    const ctx = { user, profile, supabase } as unknown as WorkbenchCallerContext
    ;[spendSummary, llmCredentialStatus] = await Promise.all([
      getBuilderSpendSummary(createAdminClient(), user.id),
      getBuilderLlmCredentialStatus(ctx),
    ])
  }

  // Connected AI apps (external MCP server). Grants come from Supabase
  // Auth's OAuth server; if that isn't enabled in the Supabase project yet,
  // listGrants errors and the list is simply empty.
  const mcpEnabled = env.mcpEnabled()
  let mcpAllowlisted = false
  let mcpGrants: ConnectedAppGrant[] = []
  let mcpActivity: ConnectedAppActivity[] = []
  if (mcpEnabled && profile.role !== 'anonymous') {
    const ctx = { user, profile, supabase } as unknown as WorkbenchCallerContext
    const [{ data: allowRow }, { data: grants }, activity] = await Promise.all([
      supabase.from('mcp_access_users').select('user_id').eq('user_id', user.id).maybeSingle(),
      supabase.auth.oauth.listGrants(),
      listMcpActivity(ctx, { ownOnly: true, limit: 15 }),
    ])
    mcpAllowlisted = allowRow !== null
    mcpGrants = (grants ?? []).map((g) => ({ clientId: g.client.id, name: g.client.name || 'AI app', uri: g.client.uri || null, grantedAt: g.granted_at }))
    mcpActivity = activity.map((a) => ({
      id: a.id,
      tool: a.tool,
      status: a.status,
      resultCount: a.result_count,
      withheldCount: a.withheld_count,
      createdAt: a.created_at,
    }))
  }

  return (
    <div className="flex max-w-lg flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Your profile</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {profile.email ?? 'Browsing anonymously -- create an account to keep your work'} ·{' '}
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{ROLE_LABELS[profile.role]}</span>
        </p>
      </div>

      {profile.role === 'anonymous' ? (
        <p className="rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          You&rsquo;re exploring Ember anonymously. Create an account to save preferences and unlock consultant
          features like running evaluations.
        </p>
      ) : (
        <ProfileForm initialFullName={profile.full_name} />
      )}

      <div className="flex flex-col gap-2 rounded border border-zinc-200 bg-white p-4 text-sm">
        <Row label="Role" value={ROLE_LABELS[profile.role]} />
        <Row label="Status" value={profile.is_active ? 'Active' : 'Deactivated'} />
        {(profile.role === 'curator' || profile.role === 'admin') && (
          <Row label="Assigned knowledge bases" value={profile.assigned_kbs.length ? profile.assigned_kbs.join(', ') : 'None'} />
        )}
        <Row label="Member since" value={new Date(profile.created_at).toLocaleDateString()} />
      </div>

      {profile.role !== 'anonymous' && (
        <div className="rounded border border-zinc-200 bg-white p-4 text-sm">
          <span className="font-medium">Journal</span>
          <p className="mt-1 text-zinc-500">
            Generate a private, reflective summary of your own activity in Ember -- your Assistant conversations, projects, and
            more -- as a Word document. Only you can see or download it, unless you choose to share the file yourself.
          </p>
          <Link href="/profile/journal" className="mt-2 inline-block rounded border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-400">
            Open my journal
          </Link>
        </div>
      )}

      {isBuilder && spendSummary && (
        <div className="rounded border border-zinc-200 bg-white p-4 text-sm">
          <span className="font-medium">AI usage</span>
          <p className="mt-1 text-zinc-500">
            You have <span className="font-medium text-zinc-700">${Math.max(spendSummary.remainingUsd, 0).toFixed(2)}</span> of AI credit
            remaining this month. {spendSummary.remainingUsd <= 0 && spendSummary.stopAtAllowance
              ? 'Ember replies are paused until your operator adds more credit, or you configure your own LLM below.'
              : 'Ask your operator if you need more.'}
          </p>
        </div>
      )}

      {isBuilder && (
        <BuilderLlmCredentialForm
          initialStatus={
            llmCredentialStatus
              ? {
                  configured: true,
                  providerType: llmCredentialStatus.providerType,
                  baseUrl: llmCredentialStatus.baseUrl,
                  modelId: llmCredentialStatus.modelId,
                  isActive: llmCredentialStatus.isActive,
                }
              : null
          }
        />
      )}

      {profile.role !== 'anonymous' && (
        <ConnectedAiApps
          enabled={mcpEnabled}
          allowlisted={mcpAllowlisted}
          mcpUrl={`${env.siteUrl()}/api/mcp`}
          grants={mcpGrants}
          activity={mcpActivity}
        />
      )}

      {profile.role === 'admin' && (
        <Link href="/admin" className="rounded border border-zinc-300 bg-white p-4 text-sm hover:border-zinc-400">
          <span className="font-medium">Administration</span>
          <p className="mt-1 text-zinc-500">Manage users, knowledge bases, and AI provider configuration.</p>
        </Link>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
