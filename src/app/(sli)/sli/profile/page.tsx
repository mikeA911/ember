import { requireUser } from '@/lib/auth'
import { getSliContext } from '@/lib/sli/api'
import { ProfileForm } from '@/components/ProfileForm'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

export const metadata = { title: 'Profile' }

// The person's own profile in SLI. Ember Core's /profile isn't reachable
// for people whose access is only through SLI departments, so the parts
// they need are here: their name, their departments and their password.
export default async function SliProfilePage() {
  const { user, profile, supabase } = await requireUser()
  const ctx = await getSliContext(supabase)

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="mt-1 text-sm text-zinc-600">{user.email}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Your name</h2>
        <p className="text-sm text-zinc-600">How colleagues see you on Triggers, decisions and handoffs.</p>
        <ProfileForm initialFullName={profile.full_name} />
      </section>

      {ctx && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Your organisation</h2>
          <p className="text-sm">{ctx.organizationName}</p>
          {ctx.departments.length > 0 ? (
            <ul className="space-y-1 text-sm text-zinc-700">
              {ctx.departments.map((d) => (
                <li key={d.id}>
                  {d.name}
                  <span className="text-zinc-500">
                    {d.role === 'lead' ? ' · lead' : ''}
                    {d.canSponsor ? ' · can sponsor Triggers' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">You aren’t in a department yet.</p>
          )}
          <p className="text-xs text-zinc-500">Ask an administrator to change your departments.</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Change your password</h2>
        <ResetPasswordForm redirectTo={null} />
      </section>
    </div>
  )
}
