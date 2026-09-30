'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addMcpAccessUserAction,
  removeMcpAccessUserAction,
  removeMcpApprovedClientAction,
  saveMcpApprovedClientAction,
} from '@/app/actions/mcp-access'
import type { McpActivityRow, McpAccessUserRow } from '@/lib/mcp/admin'
import type { McpApprovedClient, McpClientSensitivity } from '@/types/database'

const SENSITIVITIES: McpClientSensitivity[] = ['public', 'internal', 'confidential']

// Admin -> AI app access: who may connect a chatbot to Ember's read-only MCP
// server, which chatbots (by OAuth redirect URI), and recent activity.
export function AgentAccessSettings({
  enabled,
  mcpUrl,
  users,
  clients,
  activity,
}: {
  enabled: boolean
  mcpUrl: string
  users: McpAccessUserRow[]
  clients: McpApprovedClient[]
  activity: McpActivityRow[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [redirectUri, setRedirectUri] = useState('')
  const [label, setLabel] = useState('')
  const [maxSensitivity, setMaxSensitivity] = useState<McpClientSensitivity>('internal')

  function run(fn: () => Promise<void>, after?: () => void) {
    setError(null)
    startTransition(async () => {
      try {
        await fn()
        after?.()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  return (
    <section className="flex flex-col gap-6 text-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">AI app access (MCP)</h2>
        <p className="text-zinc-600">
          Lets named users ask their own AI chatbot about their Ember projects, read-only. Endpoint: <code>{mcpUrl}</code>. Status:{' '}
          <span className={enabled ? 'font-medium text-emerald-700' : 'font-medium text-zinc-700'}>
            {enabled ? 'On' : 'Off (set EMBER_MCP_ENABLED=true)'}
          </span>
        </p>
      </div>

      {error && <p className="text-red-600">{error}</p>}

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Who can connect</h3>
        {users.length === 0 ? (
          <p className="text-zinc-500">Nobody yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {users.map((u) => (
              <li key={u.userId} className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2">
                <span>
                  {u.email ?? u.userId}
                  {u.note && <span className="text-zinc-500"> &mdash; {u.note}</span>}
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => removeMcpAccessUserAction(u.userId))}
                  className="text-xs text-zinc-500 underline hover:text-red-700"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(() => addMcpAccessUserAction(email, note), () => {
              setEmail('')
              setNote('')
            })
          }}
          className="flex flex-wrap gap-2"
        >
          <input type="email" required placeholder="Email of an existing account" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1 rounded border border-zinc-300 px-2 py-1" />
          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="w-40 rounded border border-zinc-300 px-2 py-1" />
          <button disabled={isPending} className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
            Add
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Approved apps</h3>
        <p className="text-zinc-500">
          An app can only complete sign-in if its OAuth redirect URI is listed here. The sensitivity level is the most sensitive
          information Ember will send to that app&rsquo;s provider.
        </p>
        <ul className="flex flex-col gap-1">
          {clients.map((c) => (
            <li key={c.redirect_uri} className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="block truncate text-xs text-zinc-500">{c.redirect_uri}</span>
              </span>
              <span className="flex items-center gap-2">
                <select
                  value={c.max_sensitivity}
                  disabled={isPending}
                  onChange={(e) => run(() => saveMcpApprovedClientAction(c.redirect_uri, c.label, e.target.value as McpClientSensitivity))}
                  className="rounded border border-zinc-300 px-1 py-0.5 text-xs"
                >
                  {SENSITIVITIES.map((s) => (
                    <option key={s} value={s}>
                      up to {s}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => removeMcpApprovedClientAction(c.redirect_uri))}
                  className="text-xs text-zinc-500 underline hover:text-red-700"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(() => saveMcpApprovedClientAction(redirectUri, label, maxSensitivity), () => {
              setRedirectUri('')
              setLabel('')
            })
          }}
          className="flex flex-wrap gap-2"
        >
          <input required placeholder="https://… redirect URI" value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} className="flex-1 rounded border border-zinc-300 px-2 py-1" />
          <input required placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} className="w-32 rounded border border-zinc-300 px-2 py-1" />
          <select value={maxSensitivity} onChange={(e) => setMaxSensitivity(e.target.value as McpClientSensitivity)} className="rounded border border-zinc-300 px-1 py-1 text-xs">
            {SENSITIVITIES.map((s) => (
              <option key={s} value={s}>
                up to {s}
              </option>
            ))}
          </select>
          <button disabled={isPending} className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
            Approve app
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Recent activity</h3>
        {activity.length === 0 ? (
          <p className="text-zinc-500">No requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">When</th>
                  <th className="py-1 pr-3 font-medium">User</th>
                  <th className="py-1 pr-3 font-medium">Tool</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 font-medium">Results</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id} className="border-t border-zinc-100 align-top">
                    <td className="py-1 pr-3 whitespace-nowrap text-zinc-500">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="py-1 pr-3">{a.email ?? '—'}</td>
                    <td className="py-1 pr-3">{a.tool ?? 'request'}</td>
                    <td className="py-1 pr-3" title={a.error ?? undefined}>
                      {a.status}
                    </td>
                    <td className="py-1 pr-3">
                      {a.result_count ?? '—'}
                      {a.withheld_count ? ` (${a.withheld_count} withheld)` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
