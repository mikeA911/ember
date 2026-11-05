import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/mcp/redirects'

// Where a password-reset email lands (ForgotPasswordForm's redirectTo).
// Turns the link into a signed-in session, then goes on to choose a new
// password. Accepts both forms Supabase sends: ?code= (the default email
// template; works in the browser that asked for the link) and
// ?token_hash=&type= (a template pointing here; works in any browser).
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const next = safeNextPath(url.searchParams.get('next')) ?? '/reset-password'
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const supabase = await createClient()

  let ok = false
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error
  }

  const target = new URL(ok ? next : '/forgot-password?expired=1', url.origin)
  return NextResponse.redirect(target)
}
