'use server'

import { redirect } from 'next/navigation'
import { evaluateConsent, listApprovedClients } from '@/lib/mcp/consent'
import { findApprovedClient } from '@/lib/mcp/redirects'

// Allow / Deny on the OAuth consent page. Each re-runs evaluateConsent from
// scratch rather than trusting the rendered page: the allowlist, the kill
// switch and the approved-client list are all checked again at the moment
// the authorization code is actually issued.

export async function approveMcpConsentAction(authorizationId: string) {
  const { state, ctx } = await evaluateConsent(authorizationId)
  if (state.kind === 'already_approved') redirect(state.redirectUrl)
  if (state.kind !== 'needs_consent' || !ctx) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`)

  const { data, error } = await ctx.supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
  if (error || !data) throw new Error(error?.message ?? 'Could not approve this sign-in request')

  // Belt and braces: the code only ever goes to an approved destination.
  if (!findApprovedClient(data.redirect_url, await listApprovedClients(ctx))) {
    throw new Error('Refusing to send an authorization code to an unapproved app')
  }
  redirect(data.redirect_url)
}

export async function denyMcpConsentAction(authorizationId: string) {
  const { state, ctx } = await evaluateConsent(authorizationId)
  // Tell an approved chatbot the user said no (it shows its own error);
  // never redirect anywhere for an unapproved client.
  if ((state.kind === 'needs_consent' || state.kind === 'not_allowed') && ctx) {
    const { data } = await ctx.supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
    if (data && findApprovedClient(data.redirect_url, await listApprovedClients(ctx))) redirect(data.redirect_url)
  }
  redirect('/dashboard')
}
