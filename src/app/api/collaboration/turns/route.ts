import { NextResponse } from 'next/server'
import { AuthError, requireUser } from '@/lib/auth'
import { CollaborationError } from '@/lib/collaboration/errors'
import { collaborationEnabled } from '@/lib/collaboration/flag'
import { runSharedChatTurns } from '@/lib/collaboration/shared-turn'

// Shared workspace sessions, Phase 3: runs a shared conversation's waiting
// Ember turns (src/lib/collaboration/shared-turn.ts). A Route Handler, not
// a Server Action, so a long answer never holds up the browser's other
// Server Actions. Posted by a participant's browser after asking, and
// again whenever the polled chat state says work is waiting with nobody
// running it; calling it twice is harmless (one turn runs at a time).
export const maxDuration = 120

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  if (!collaborationEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let ctx
  try {
    ctx = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: 'Sign in again' }, { status: 401 })
    throw err
  }
  const body = (await request.json().catch(() => null)) as { conversationId?: unknown } | null
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
  if (!UUID.test(conversationId)) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  try {
    return NextResponse.json(await runSharedChatTurns(ctx, conversationId))
  } catch (err) {
    if (err instanceof CollaborationError) {
      return NextResponse.json({ error: err.message }, { status: err.kind === 'denied' ? 403 : 409 })
    }
    console.error('Shared chat runner failed', err)
    return NextResponse.json({ error: 'Ember couldn’t start answering' }, { status: 500 })
  }
}
