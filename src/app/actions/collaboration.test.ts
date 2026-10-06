import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, requireUser } = vi.hoisted(() => ({ rpc: vi.fn(), requireUser: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireUser }))
import { collaborationAction } from './collaboration'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_EMBER_COLLABORATION', 'true')
  requireUser.mockResolvedValue({ supabase: { rpc } })
  rpc.mockResolvedValue({ data: [], error: null })
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('collaboration server action', () => {
  it('fails closed before querying when the feature is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_EMBER_COLLABORATION', 'false')
    expect(await collaborationAction({ command: 'history' })).toEqual({ error: 'Collaboration is not enabled.' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects forged actor fields and arbitrary routes', async () => {
    expect(await collaborationAction({ command: 'navigate', actor: 'admin', route: '/admin' })).toEqual({ error: 'Invalid collaboration request.' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('uses the authenticated caller RPC without accepting a caller identity', async () => {
    expect(await collaborationAction({ command: 'history' })).toEqual({ data: [] })
    expect(requireUser).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('collaboration_command', expect.objectContaining({ p_command: 'history' }))
  })
  it('preserves actionable conflict messages but hides unexpected database details', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'Workspace changed; refresh before retrying' } })
    expect(await collaborationAction({ command: 'history' })).toEqual({ error: 'Workspace changed; refresh before retrying' })
    rpc.mockResolvedValueOnce({ error: { message: 'internal connection secret' } })
    expect(await collaborationAction({ command: 'history' })).toEqual({ error: 'Collaboration is unavailable. Try again later.' })
  })
})
