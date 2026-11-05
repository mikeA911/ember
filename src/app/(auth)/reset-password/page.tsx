import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import { sliEnabled } from '@/lib/sli/flag'

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const { first } = await searchParams
  // On an SLI instance, go to SLI Home (people without SLI access are sent
  // on to Ember from there).
  return <ResetPasswordForm firstSignIn={first === '1'} redirectTo={sliEnabled() ? '/sli' : '/dashboard'} />
}
