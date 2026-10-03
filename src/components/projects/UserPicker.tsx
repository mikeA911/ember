'use client'

import { useState } from 'react'

export interface UserOption {
  email: string
  fullName: string | null
}

const OTHER = '__other__'

// Drop-down of existing accounts, with an "enter email" escape hatch so the
// members page's create-account-on-the-fly flow still has a way in. `value` is
// always the chosen email ('' when nothing is picked yet).
export function UserPicker({
  users,
  value,
  onChange,
  excludeEmails = [],
  className = '',
}: {
  users: UserOption[]
  value: string
  onChange: (email: string) => void
  excludeEmails?: string[]
  className?: string
}) {
  const excluded = new Set(excludeEmails.map((e) => e.toLowerCase()))
  const options = users.filter((u) => !excluded.has(u.email.toLowerCase()))
  const [otherMode, setOtherMode] = useState(false)
  const showOther = otherMode || options.length === 0

  if (showOther) {
    return (
      <div className={`flex gap-2 ${className}`}>
        <input
          autoFocus={otherMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Person's email"
          className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
        />
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setOtherMode(false)
              onChange('')
            }}
            className="text-xs text-zinc-500 underline"
          >
            Pick from list
          </button>
        )}
      </div>
    )
  }

  return (
    <select
      value={options.some((u) => u.email === value) ? value : ''}
      onChange={(e) => {
        if (e.target.value === OTHER) {
          setOtherMode(true)
          onChange('')
        } else {
          onChange(e.target.value)
        }
      }}
      className={`rounded border border-zinc-300 px-3 py-2 text-sm ${className}`}
    >
      <option value="">Select a person…</option>
      {options.map((u) => (
        <option key={u.email} value={u.email}>
          {u.fullName ? `${u.fullName} (${u.email})` : u.email}
        </option>
      ))}
      <option value={OTHER}>Someone else (enter email)…</option>
    </select>
  )
}
