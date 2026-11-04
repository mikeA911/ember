'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'

// firstSignIn: the person signed in with a temporary password
// (scripts/sli-add-members.mjs) and must choose their own before going on.
export function ResetPasswordForm({ firstSignIn = false }: { firstSignIn?: boolean }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    // Clears the first-sign-in flag in the same call (src/lib/password-change.ts).
    const { error: updateError } = await supabase.auth.updateUser({ password, data: { must_change_password: false } })

    setSubmitting(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      {firstSignIn && (
        <div className="text-sm text-zinc-700">
          <p className="font-medium">Welcome. Choose your own password</p>
          <p className="mt-1 text-zinc-600">You signed in with a temporary password. Choose a new one to continue; the temporary one stops working.</p>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="password">New password</label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="confirm">Confirm new password</label>
        <input
          id="confirm"
          type="password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-zinc-900 text-white py-2 font-medium disabled:opacity-50"
      >
        {submitting ? 'Updating…' : firstSignIn ? 'Save and continue' : 'Update password'}
      </button>
    </form>
  )
}
