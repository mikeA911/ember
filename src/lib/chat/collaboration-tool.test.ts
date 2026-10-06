import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { ChatMessageRow } from '@/types/database'

const { listMessages } = vi.hoisted(() => ({ listMessages: vi.fn() }))
vi.mock('./conversations', () => ({ listMessages }))
import {
  PREVIEW_COLLABORATION_INVITATION_TOOL_NAME,
  previewedInEarlierTurn,
  runPreviewCollaborationInvitation,
  runSendCollaborationInvitation,
} from './collaboration-tool'

const P = '11111111-1111-4111-8111-111111111111'
const GIL = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

const rpc = vi.fn()
function fakeCtx(): WorkbenchCallerContext {
  const supabase = {
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Test Project' }, error: null }) }) }) }),
  }
  return { user: { id: 'me' }, profile: { id: 'me', role: 'member' }, supabase } as unknown as WorkbenchCallerContext
}

const row = (r: Partial<ChatMessageRow>) => r as ChatMessageRow
const preview = (recipientUserId: string) =>
  row({ role: 'tool', tool_name: PREVIEW_COLLABORATION_INVITATION_TOOL_NAME, content: JSON.stringify({ recipientUserId, canInvite: true }) })

beforeEach(() => {
  rpc.mockReset()
  listMessages.mockReset()
})

describe('preview_collaboration_invitation', () => {
  it('returns the person’s name for another active member, and sends nothing', async () => {
    rpc.mockResolvedValueOnce({ data: [{ userId: GIL, name: 'Gil Guest', role: 'viewer' }], error: null })
    const out = await runPreviewCollaborationInvitation(fakeCtx(), P, { recipientUserId: GIL })
    expect(out).toMatchObject({ recipientUserId: GIL, recipientName: 'Gil Guest', projectName: 'Test Project', canInvite: true })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('collaboration_candidates', { p_project: P })
  })

  it('refuses someone who is not another active member', async () => {
    rpc.mockResolvedValueOnce({ data: [{ userId: GIL, name: 'Gil Guest', role: 'viewer' }], error: null })
    await expect(runPreviewCollaborationInvitation(fakeCtx(), P, { recipientUserId: OTHER })).rejects.toThrow('not another active member')
  })

  it('rejects a recipient that isn’t an id', async () => {
    await expect(runPreviewCollaborationInvitation(fakeCtx(), P, { recipientUserId: 'Gil' })).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('send_collaboration_invitation', () => {
  it('needs a preview of the same person before the user’s latest message', () => {
    const user = row({ role: 'user', content: 'yes, invite Gil' })
    expect(previewedInEarlierTurn([row({ role: 'user', content: 'invite Gil' }), preview(GIL), user], GIL)).toBe(true)
    // Previewed in this same turn: the user hasn't confirmed yet.
    expect(previewedInEarlierTurn([row({ role: 'user', content: 'invite Gil' }), preview(GIL)], GIL)).toBe(false)
    // A preview of someone else doesn't count.
    expect(previewedInEarlierTurn([row({ role: 'user', content: 'x' }), preview(OTHER), user], GIL)).toBe(false)
  })

  it('refuses without a confirmed preview and never calls the database', async () => {
    listMessages.mockResolvedValueOnce([row({ role: 'user', content: 'invite Gil' }), preview(GIL)])
    await expect(runSendCollaborationInvitation(fakeCtx(), P, 'conv-1', { recipientUserId: GIL })).rejects.toThrow('Not sent')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends after confirmation, recorded as from Ember in this conversation', async () => {
    listMessages.mockResolvedValueOnce([row({ role: 'user', content: 'invite Gil' }), preview(GIL), row({ role: 'user', content: 'yes' })])
    rpc.mockResolvedValueOnce({
      data: { id: 'inv-1', inviteeName: 'Gil Guest', status: 'pending', expiresAt: '2026-10-06T12:00:00Z' },
      error: null,
    })
    const out = await runSendCollaborationInvitation(fakeCtx(), P, 'conv-1', { recipientUserId: GIL })
    expect(out).toMatchObject({ invitationId: 'inv-1', recipientName: 'Gil Guest', status: 'pending' })
    expect(rpc).toHaveBeenCalledWith('collaboration_invite', {
      p_project: P,
      p_invitee: GIL,
      p_conversation: null,
      p_created_via: 'assistant',
      p_assistant_conversation: 'conv-1',
    })
  })

  it('passes on the database’s own reason, and hides anything internal', async () => {
    listMessages.mockResolvedValue([row({ role: 'user', content: 'invite Gil' }), preview(GIL), row({ role: 'user', content: 'yes' })])
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'EC001', message: 'You are already in a live session -- leave or end it first' } })
    await expect(runSendCollaborationInvitation(fakeCtx(), P, 'conv-1', { recipientUserId: GIL })).rejects.toThrow('already in a live session')
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'internal detail' } })
    await expect(runSendCollaborationInvitation(fakeCtx(), P, 'conv-1', { recipientUserId: GIL })).rejects.toThrow('unavailable right now')
  })
})
