import { redirect } from 'next/navigation'
import { evaluateConsent } from '@/lib/mcp/consent'
import { approveMcpConsentAction, denyMcpConsentAction } from '@/app/actions/mcp-consent'

// Supabase Auth's OAuth 2.1 server redirects here (Authentication -> OAuth
// Server -> authorization path) when a chatbot such as Claude or ChatGPT asks
// to connect to Ember's MCP server. See docs/guides/ember-mcp-oauth-setup.md.

const SENSITIVITY_TEXT: Record<'public' | 'internal' | 'confidential', string> = {
  public: 'Public information only',
  internal: 'Public and Internal information',
  confidential: 'Public, Internal and Confidential information',
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full max-w-md flex-col gap-4 rounded border border-zinc-200 bg-white p-6 text-sm text-zinc-700">{children}</div>
}

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = await searchParams
  if (!authorizationId) {
    return (
      <Card>
        <p>This page is opened by an AI app during sign-in. There is nothing to approve here.</p>
      </Card>
    )
  }

  const { state } = await evaluateConsent(authorizationId)

  if (state.kind === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`)
  }
  if (state.kind === 'already_approved') redirect(state.redirectUrl)

  if (state.kind === 'disabled') {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-zinc-900">AI app access is turned off</h2>
        <p>Connecting AI apps to Ember is not enabled on this deployment. Ask an Ember administrator.</p>
      </Card>
    )
  }

  if (state.kind === 'error') {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-zinc-900">This sign-in request can&apos;t be used</h2>
        <p>{state.message}</p>
        <p>Start the connection again from your AI app.</p>
      </Card>
    )
  }

  if (state.kind === 'unapproved_client') {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-zinc-900">This app is not approved for Ember</h2>
        <p>
          <strong>{state.clientName}</strong> asked to connect, but it would receive access at <code className="break-all">{state.redirectUri}</code>,
          which is not on Ember&apos;s list of approved AI apps. No access has been granted.
        </p>
        <p>If you didn&apos;t start this, you can close this page. If you did, ask an Ember administrator to approve the app.</p>
      </Card>
    )
  }

  if (state.kind === 'not_allowed') {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-zinc-900">AI app access isn&apos;t enabled for your account</h2>
        <p>
          You&apos;re signed in as <strong>{state.email}</strong>. Connecting {state.clientLabel} to Ember is currently limited to named
          users. Ask an Ember administrator to add you.
        </p>
        <form action={denyMcpConsentAction.bind(null, authorizationId)}>
          <button type="submit" className="rounded border border-zinc-300 px-4 py-2 font-medium">
            Return to {state.clientLabel}
          </button>
        </form>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-zinc-900">Connect {state.clientLabel} to Ember?</h2>
      <p>
        <strong>{state.clientName}</strong>
        {state.clientUri ? <span className="text-zinc-500"> ({state.clientUri})</span> : null} wants to read your Ember projects as{' '}
        <strong>{state.email}</strong>.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Read-only.</strong> It can look up projects, summaries, workstreams, notes and approved knowledge you can already
          see. It can&apos;t create, change, approve or delete anything.
        </li>
        <li>
          Answers are sent to {state.clientLabel}. It receives <strong>{SENSITIVITY_TEXT[state.maxSensitivity]}</strong>; anything more
          sensitive is withheld.
        </li>
        <li>Every request is logged. You can disconnect it at any time from your Profile.</li>
      </ul>
      <p className="rounded bg-amber-50 p-3 text-amber-900">
        Only allow this if <strong>you</strong> just started connecting Ember from your own {state.clientLabel} account. If someone sent
        you this link, choose Deny &mdash; allowing it would give their {state.clientLabel} access to your Ember projects.
      </p>
      <div className="flex gap-3">
        <form action={approveMcpConsentAction.bind(null, authorizationId)}>
          <button type="submit" className="rounded bg-zinc-900 px-4 py-2 font-medium text-white">
            Allow read-only access
          </button>
        </form>
        <form action={denyMcpConsentAction.bind(null, authorizationId)}>
          <button type="submit" className="rounded border border-zinc-300 px-4 py-2 font-medium">
            Deny
          </button>
        </form>
      </div>
    </Card>
  )
}
