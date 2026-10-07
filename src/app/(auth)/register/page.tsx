import { connection } from 'next/server'
import { AccessRequestForm } from '@/components/auth/AccessRequestForm'
import { env } from '@/lib/env'

// Self-serve registration is off -- an admin creates accounts from /admin's
// User Management panel (createUserAction). A builder asks for one here by
// email, with a reason; the platform owner replies to accept or decline.
// connection(): read EMBER_ACCESS_REQUEST_EMAIL at request time, not build.
export default async function RegisterPage() {
  await connection()
  return <AccessRequestForm to={env.accessRequestEmail() ?? null} />
}
