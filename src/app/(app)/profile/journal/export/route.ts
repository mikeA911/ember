import { redirect } from 'next/navigation'
import { z } from 'zod'
import { AuthError, requireUser } from '@/lib/auth'
import { JournalContentSchema } from '@/lib/journal/generate'
import { renderJournalDocx } from '@/lib/journal/docx'

// A Route Handler, not a Server Action, is required here specifically
// because only it can set Content-Disposition and stream a binary body for
// a real browser download. The body is data the requesting user already
// generated and previewed moments ago in their own browser (see
// previewJournalAction) -- validated here for shape/type safety before
// rendering, not re-authorized, since it never touches the database and is
// streamed back only to the same authenticated requester who sent it.
const ExportBodySchema = z.object({
  content: JournalContentSchema,
  conversations: z.array(z.object({ id: z.string(), title: z.string(), date: z.string() })),
  relatedActivity: z.array(
    z.object({ id: z.string(), date: z.string(), actorName: z.string(), line: z.string(), projectId: z.string(), projectName: z.string() })
  ),
  truncated: z.boolean(),
  rangeLabel: z.string(),
  providerDisplayName: z.string(),
  modelDisplayName: z.string(),
})

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) redirect('/login')
    throw err
  }
  if (ctx.profile.role === 'anonymous') redirect('/profile')

  const parsed = ExportBodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return new Response('Invalid journal export payload', { status: 400 })
  }
  const body = parsed.data

  const buffer = await renderJournalDocx({
    title: 'My Ember Journal',
    rangeLabel: body.rangeLabel,
    content: body.content,
    conversations: body.conversations,
    relatedActivity: body.relatedActivity,
    truncated: body.truncated,
    providerDisplayName: body.providerDisplayName,
    modelDisplayName: body.modelDisplayName,
  })

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="kb-sandbox-journal-${new Date().toISOString().slice(0, 10)}.docx"`,
    },
  })
}
