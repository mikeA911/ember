import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CERTIFICATION_LABELS, CERTIFICATION_STYLES, KIND_LABELS } from '@/components/builder-integrations/certification'

const PROTOCOL_LABELS: Record<string, string> = { mcp: 'MCP', https: 'HTTPS' }

export default async function AgentRegistryPage() {
  const supabase = await createClient()

  const { data: integrations } = await supabase
    .from('builder_integrations')
    .select('id, name, purpose, kind, protocol, endpoint_url, status, project_id, active_version_id')
    .order('created_at', { ascending: false })

  const versionIds = (integrations ?? []).map((a) => a.active_version_id).filter((id): id is string => !!id)
  const { data: versions } =
    versionIds.length > 0
      ? await supabase.from('builder_integration_versions').select('id, certification_status, version_number').in('id', versionIds)
      : { data: [] }
  const versionById = new Map((versions ?? []).map((v) => [v.id, v]))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Builder Registry</h1>
          <p className="mt-1 text-sm text-zinc-600">
            External agents and MCP servers built by builders (students, founders, software houses) and registered here for
            Ember to govern -- versioned spec, certification status, evidence, and which Projects may use it. See the{' '}
            <Link href="/wiki/what-kb-sandbox-actually-does-a-capability-overview" className="underline">
              Workbench Handbook
            </Link>{' '}
            for the Agent Design method this registry supports.
          </p>
        </div>
        <Link href="/agent-registry/new" className="shrink-0 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          Register
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(integrations ?? []).map((a) => {
          const version = a.active_version_id ? versionById.get(a.active_version_id) : undefined
          return (
            <Link key={a.id} href={`/agent-registry/${a.id}`} className="rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium">{a.name}</h3>
                {version && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CERTIFICATION_STYLES[version.certification_status]}`}>
                    {CERTIFICATION_LABELS[version.certification_status]}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {KIND_LABELS[a.kind]} · {PROTOCOL_LABELS[a.protocol] ?? a.protocol}
                {version && ` · v${version.version_number}`}
                {a.endpoint_url ? ` · ${a.endpoint_url}` : ' · no endpoint yet'}
              </p>
              <p className="mt-1 text-sm text-zinc-600">{a.purpose}</p>
            </Link>
          )
        })}
        {(integrations ?? []).length === 0 && (
          <p className="text-sm text-zinc-500 sm:col-span-2">
            Nothing registered yet. Register the first one to demonstrate the pattern -- name, purpose, kind (external
            agent or MCP server), protocol (MCP or HTTPS), skills, credential references (never the secrets themselves),
            spending limits, and an approval policy.
          </p>
        )}
      </div>
    </div>
  )
}
