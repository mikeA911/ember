'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ProjectMember, ProjectRole, ProjectMemberStatus } from '@/types/database'
import {
  addProjectMemberAction,
  createAndAddProjectMemberAction,
  updateProjectMemberRoleAction,
  updateProjectMemberStatusAction,
  transferOwnershipAction,
} from '@/app/actions/projects'
import { BulkAddMembersForm } from './BulkAddMembersForm'
import { UserPicker, type UserOption } from './UserPicker'

const ROLES: ProjectRole[] = ['owner', 'curator', 'consultant', 'viewer']
// A non-admin (project owner/curator) creating a brand-new account can only
// ever grant 'member' or 'consultant' -- minting a curator/admin account
// stays a platform-admin-only escalation (see createAndAddProjectMember's
// server-side check, which is the real enforcement, not this list).
const PLATFORM_ROLES_ADMIN = ['member', 'consultant', 'curator', 'admin'] as const
const PLATFORM_ROLES_NON_ADMIN = ['member', 'consultant'] as const
type PlatformRole = (typeof PLATFORM_ROLES_ADMIN)[number]

function randomTempPassword(): string {
  // Not shown as a security boundary -- this environment has no email
  // delivery, so an admin always hands this to the new person out of band
  // (Slack, in person, etc) right after creating the account. Just needs to
  // clear the 8-char minimum without the admin having to invent one.
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

interface MemberWithEmail extends ProjectMember {
  email: string
  platformRole: PlatformRole | null
}

export function MembersManager({
  projectId,
  projectName,
  members,
  currentUserId,
  viewerIsAdmin,
  canTransferOwnership,
  selectableUsers,
}: {
  projectId: string
  projectName: string
  members: MemberWithEmail[]
  currentUserId: string
  viewerIsAdmin: boolean
  canTransferOwnership: boolean
  selectableUsers: UserOption[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('consultant')
  const [error, setError] = useState<string | null>(null)

  // Set whenever handleAdd hits "no account for this email" -- offers to
  // create the account and add them in one step instead of bouncing to
  // /admin first. Reaching this page at all already requires admin/owner/
  // curator (see members/page.tsx's canManage), and all three can call
  // createAndAddProjectMemberAction -- a non-admin is just capped to
  // platformRole member/consultant there. addProjectMember's own "No
  // account found for {email}" message (workbench/projects.ts) is matched
  // literally; update both together if that message ever changes.
  const [noAccountEmail, setNoAccountEmail] = useState<string | null>(null)
  const [newAccountPassword, setNewAccountPassword] = useState('')
  const [newAccountPlatformRole, setNewAccountPlatformRole] = useState<PlatformRole>('member')
  const availablePlatformRoles = viewerIsAdmin ? PLATFORM_ROLES_ADMIN : PLATFORM_ROLES_NON_ADMIN
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)

  function run(action: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await action()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    const trimmedEmail = email.trim()
    setNoAccountEmail(null)
    setCreated(null)
    setError(null)
    startTransition(async () => {
      try {
        await addProjectMemberAction(projectId, trimmedEmail, role)
        setEmail('')
        router.refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Action failed'
        if (message === `No account found for ${trimmedEmail}`) {
          setNoAccountEmail(trimmedEmail)
          setNewAccountPassword(randomTempPassword())
        } else {
          setError(message)
        }
      }
    })
  }

  function handleCreateAndAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!noAccountEmail || !newAccountPassword.trim()) return
    const targetEmail = noAccountEmail
    setError(null)
    startTransition(async () => {
      try {
        await createAndAddProjectMemberAction({
          projectId,
          email: targetEmail,
          password: newAccountPassword.trim(),
          projectRole: role,
          platformRole: newAccountPlatformRole,
        })
        setCreated({ email: targetEmail, password: newAccountPassword.trim() })
        setNoAccountEmail(null)
        setEmail('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${projectId}`} className="text-sm underline">
          ← {projectName}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Members</h1>
      </div>

      <div className="rounded border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 font-medium">Project role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-zinc-100 last:border-0">
                <td className="px-4 py-3">
                  <div>
                    {m.email}
                    {m.user_id === currentUserId && <span className="ml-1 text-xs text-zinc-400">(you)</span>}
                  </div>
                  {m.platformRole && <div className="text-xs text-zinc-400">Platform: {m.platformRole}</div>}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={m.role}
                    disabled={isPending}
                    onChange={(e) => run(() => updateProjectMemberRoleAction(m.id, projectId, e.target.value as ProjectRole))}
                    className="rounded border border-zinc-300 px-1.5 py-1 text-xs"
                  >
                    {ROLES.filter((r) => r !== 'owner' || canTransferOwnership || m.role === 'owner').map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={m.status === 'active'}
                      disabled={isPending}
                      onChange={(e) =>
                        run(() => updateProjectMemberStatusAction(m.id, projectId, (e.target.checked ? 'active' : 'inactive') as ProjectMemberStatus))
                      }
                    />
                    {m.status}
                  </label>
                </td>
                <td className="px-4 py-3 text-right">
                  {m.role !== 'owner' && canTransferOwnership && (
                    <button
                      disabled={isPending}
                      onClick={() => {
                        if (!confirm(`Make ${m.email} the project owner? You will be moved to curator.`)) return
                        run(() => transferOwnershipAction(projectId, m.id))
                      }}
                      className="text-xs underline disabled:opacity-50"
                    >
                      Make owner
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleAdd} className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Add member</h2>
        <div className="flex gap-2">
          <UserPicker
            users={selectableUsers}
            value={email}
            onChange={setEmail}
            excludeEmails={members.map((m) => m.email)}
            className="flex-1"
          />
          <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} className="rounded border border-zinc-300 px-3 py-2 text-sm">
            {ROLES.filter((r) => r !== 'owner').map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button disabled={isPending} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Add
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <BulkAddMembersForm projectId={projectId} viewerIsAdmin={viewerIsAdmin} />

      {noAccountEmail && (
        <form onSubmit={handleCreateAndAdd} className="flex flex-col gap-3 rounded border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">No account for {noAccountEmail} yet</h2>
          <p className="text-xs text-amber-800">
            Create an account for them and add them to {projectName} as <strong>{role}</strong> in one step. Share the password below with
            them directly -- this environment doesn&apos;t send invite emails.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newAccountPassword}
              onChange={(e) => setNewAccountPassword(e.target.value)}
              placeholder="Temporary password"
              className="rounded border border-amber-300 px-3 py-2 text-sm"
            />
            <select
              value={newAccountPlatformRole}
              onChange={(e) => setNewAccountPlatformRole(e.target.value as PlatformRole)}
              className="rounded border border-amber-300 px-3 py-2 text-sm"
            >
              {availablePlatformRoles.map((r) => (
                <option key={r} value={r}>
                  Platform: {r}
                </option>
              ))}
            </select>
            <button disabled={isPending} className="rounded bg-amber-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {isPending ? 'Working…' : 'Create & add'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setNoAccountEmail(null)}
              className="rounded border border-amber-300 px-3 py-2 text-sm text-amber-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {created && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          Created <strong>{created.email}</strong> and added them to {projectName}. Password (shown once, share it now):{' '}
          <code className="rounded bg-white px-1.5 py-0.5">{created.password}</code>
        </div>
      )}
    </div>
  )
}
