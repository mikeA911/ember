import { redirect } from 'next/navigation'
import { AuthError, requireUser } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import { exportProjectKnowledge } from '@/lib/projects/knowledge-export'

// A Route Handler, not a Server Action, so the zip can be a real browser
// download (Content-Disposition). Authorization is in exportProjectKnowledge.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) redirect('/login')
    throw err
  }

  try {
    const { filename, bytes } = await exportProjectKnowledge(ctx, id)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.message, { status: 403 })
    if (err instanceof ProjectValidationError) return new Response(err.message, { status: 404 })
    throw err
  }
}
