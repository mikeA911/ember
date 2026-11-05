import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams
  return <ForgotPasswordForm expired={expired === '1'} />
}
