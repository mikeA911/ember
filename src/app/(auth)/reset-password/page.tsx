import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const { first } = await searchParams
  return <ResetPasswordForm firstSignIn={first === '1'} />
}
