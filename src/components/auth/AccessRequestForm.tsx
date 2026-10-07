'use client'

import { useState } from 'react'
import Link from 'next/link'
import { accessRequestMailto } from './access-request'

// Self-registration is off. A builder writes why they want to build with
// Ember, and this opens their email app with the request addressed to the
// platform owner, who replies to accept or decline.
export function AccessRequestForm({ to }: { to: string | null }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [opened, setOpened] = useState(false)

  if (!to) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4 text-sm text-zinc-600">
        <p>Ember accounts are created by an administrator. Ask yours to set one up for you.</p>
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </div>
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    window.location.href = accessRequestMailto(to as string, { name, email, reason })
    setOpened(true)
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <h2 className="font-medium">Request builder access</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Tell us why you want to build with Ember. This opens your email app with the request; we&apos;ll reply to let you know if
          you&apos;re accepted.{' '}
          <Link href="/builders" className="underline">
            Read the Builder&apos;s Journey
          </Link>
        </p>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="name">Name</label>
        <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-zinc-300 px-3 py-2" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="reason">Reason</label>
        <textarea
          id="reason"
          required
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="The clients or problems you'd use Ember for, and your experience."
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </div>
      <button type="submit" className="rounded bg-zinc-900 py-2 font-medium text-white">
        Email my request
      </button>
      {opened && (
        <p className="text-sm text-zinc-600">
          Didn&apos;t open? Email <span className="font-medium">{to}</span> with your name and reason.
        </p>
      )}
      <Link href="/login" className="text-sm text-zinc-600 underline">
        Back to sign in
      </Link>
    </form>
  )
}
