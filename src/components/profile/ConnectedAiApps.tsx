'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { disconnectAiAppAction } from '@/app/actions/mcp-access'

export interface ConnectedAppGrant {
  clientId: string
  name: string
  uri: string | null
  grantedAt: string
}

export interface ConnectedAppActivity {
  id: number
  tool: string | null
  status: string
  resultCount: number | null
  withheldCount: number | null
  createdAt: string
}

// Profile -> Connected AI apps: ask Claude, ChatGPT and other MCP-capable
// chatbots about your Ember projects (docs/guides/ember-mcp-oauth-setup.md).
export function ConnectedAiApps({
  enabled,
  allowlisted,
  mcpUrl,
  grants,
  activity,
}: {
  enabled: boolean
  allowlisted: boolean
  mcpUrl: string
  grants: ConnectedAppGrant[]
  activity: ConnectedAppActivity[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  function disconnect(clientId: string) {
    setError(null)
    startTransition(async () => {
      try {
        await disconnectAiAppAction(clientId)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to disconnect')
      }
    })
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4 text-sm">
      <span className="font-medium">Connected AI apps</span>
      {!enabled ? (
        <p className="text-zinc-500">Connecting AI apps to Ember isn&rsquo;t turned on for this deployment.</p>
      ) : !allowlisted ? (
        <p className="text-zinc-500">
          Ask your AI chatbot about your Ember projects on the go. Access is currently limited to named users &mdash; ask an Ember
          administrator to enable it for you.
        </p>
      ) : (
        <>
          <p className="text-zinc-500">
            Ask Claude, ChatGPT or another MCP-capable app about your projects. Add a custom connector with this URL, then sign in to
            Ember when asked. Access is read-only.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-zinc-50 px-2 py-1 text-xs">{mcpUrl}</code>
            <button type="button" onClick={copyUrl} className="rounded border border-zinc-300 px-2 py-1 text-xs">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {grants.length === 0 ? (
            <p className="text-zinc-500">No apps connected yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {grants.map((g) => (
                <li key={g.clientId} className="flex items-center justify-between gap-2 rounded border border-zinc-100 p-2">
                  <span>
                    <span className="font-medium">{g.name}</span>
                    <span className="block text-xs text-zinc-500">Connected {new Date(g.grantedAt).toLocaleDateString()}</span>
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => disconnect(g.clientId)}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:border-red-400 hover:text-red-700 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-red-600">{error}</p>}
          {activity.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-zinc-500">Recent activity</summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-600">
                {activity.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span>
                      {a.tool ?? 'request'} &middot; {a.status}
                      {a.withheldCount ? ` · ${a.withheldCount} withheld` : ''}
                    </span>
                    <span className="text-zinc-400">{new Date(a.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}
