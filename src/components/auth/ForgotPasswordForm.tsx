'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/browser'

// expired: the reset link they opened had expired, was already used, or was
// opened in a different browser (/auth/confirm sends them back here).
export function ForgotPasswordForm({ expired = false }: { expired?: boolean }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      // /auth/confirm turns the emailed link into a session, then opens
      // /reset-password to choose the new password.
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    })

    setSubmitting(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setSent(true)
  }

  if (sent) {
    return <p className="text-sm text-zinc-700 max-w-sm">If an account exists for {email}, a reset link has been sent.</p>
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      {expired ? (
        <p className="text-sm text-amber-800">
          That reset link has expired or was already used. Ask for a new one below, and open it in this same browser.
        </p>
      ) : (
        <p className="text-sm text-zinc-600">Enter your email and we’ll send you a link to choose a new password. Open it in this same browser.</p>
      )}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-zinc-900 text-white py-2 font-medium disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send reset link'}
      </button>
      <Link href="/login" className="text-sm underline text-zinc-600">Back to sign in</Link>
    </form>
  )
}
