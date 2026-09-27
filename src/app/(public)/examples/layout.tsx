import { notFound } from 'next/navigation'
import { PUBLIC_EXAMPLES_ENABLED } from '@/lib/showcases/public-examples'

// Gates every /examples route (index, project, workstream, assessment) in
// one place while public Examples are hidden.
export default function ExamplesLayout({ children }: { children: React.ReactNode }) {
  if (!PUBLIC_EXAMPLES_ENABLED) notFound()
  return children
}
