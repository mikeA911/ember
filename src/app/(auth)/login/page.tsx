import { SectionHero } from '@/components/SectionHero'
import { LoginForm } from '@/components/auth/LoginForm'
import { safeNextPath } from '@/lib/mcp/redirects'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      <div className="w-full">
        <SectionHero image="/images/login-banner.png" height="compact" priority />
      </div>
      <LoginForm next={safeNextPath(next)} />
      <div className="w-full">
        <SectionHero image="/images/login-banner.png" height="compact" />
      </div>
    </div>
  )
}
