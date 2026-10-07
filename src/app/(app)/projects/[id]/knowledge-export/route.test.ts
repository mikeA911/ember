import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthError } from '@/lib/auth'

const requireUserMock = vi.fn()
const exportMock = vi.fn()

vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }) }))
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireUser: (...args: unknown[]) => requireUserMock(...args) }
})
vi.mock('@/lib/projects/knowledge-export', () => ({ exportProjectKnowledge: (...args: unknown[]) => exportMock(...args) }))

const { GET } = await import('./route')

const call = () => GET(new Request('http://localhost/projects/proj-1/knowledge-export'), { params: Promise.resolve({ id: 'proj-1' }) })

beforeEach(() => {
  requireUserMock.mockReset()
  exportMock.mockReset()
})

describe('GET /projects/[id]/knowledge-export', () => {
  it('streams the zip as an attachment', async () => {
    requireUserMock.mockResolvedValue({ user: { id: 'builder-1' }, profile: { role: 'consultant' }, supabase: {} })
    exportMock.mockResolvedValue({ filename: 'acme-knowledge-2026-10-07.zip', bytes: new Uint8Array([80, 75]) })
    const res = await call()
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="acme-knowledge-2026-10-07.zip"')
  })

  it("answers 403 when the caller can't export this project", async () => {
    requireUserMock.mockResolvedValue({ user: { id: 'viewer-1' }, profile: { role: 'member' }, supabase: {} })
    exportMock.mockRejectedValue(new AuthError('nope'))
    expect((await call()).status).toBe(403)
  })

  it('sends a signed-out visitor to sign in', async () => {
    requireUserMock.mockRejectedValue(new AuthError('Not signed in'))
    await expect(call()).rejects.toThrow('redirect:/login')
  })
})
