import Link from 'next/link'

// The person's own corner of every SLI header: their initials and first
// name, opening their profile (name, departments, password).
export function AccountLink({ name, className = '' }: { name: string | null; className?: string }) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  const initials = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase()
  return (
    <Link
      href="/sli/profile"
      title="Your profile and password"
      className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-3 text-sm hover:bg-white ${className}`}
    >
      <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-xs font-semibold text-white">
        {initials}
      </span>
      <span>{parts[0] ?? 'Profile'}</span>
      <span className="sr-only">: your profile and password</span>
    </Link>
  )
}
