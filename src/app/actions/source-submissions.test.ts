import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProjectValidationError } from '@/lib/projects/errors'

const requireUserMock = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
const submitFileSourceMock = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireUser: (...args: unknown[]) => requireUserMock(...args) }
})
vi.mock('@/lib/curator/documents', () => ({ DocumentValidationError: class DocumentValidationError extends Error {} }))
vi.mock('@/lib/workbench/source-submissions', () => ({
  submitFileSource: (...args: unknown[]) => submitFileSourceMock(...args),
  submitArtifactSource: vi.fn(),
  submitWorkingKnowledgeSource: vi.fn(),
  listSourceSubmissions: vi.fn(),
  approveSourceSubmission: vi.fn(),
  rejectSourceSubmission: vi.fn(),
  SourceApprovalError: class SourceApprovalError extends Error {},
}))

const { submitFileSourceAction } = await import('./source-submissions')
const { DocumentValidationError } = await import('@/lib/curator/documents')

function formWith(file: File | null) {
  const fd = new FormData()
  fd.set('projectId', 'proj-1')
  fd.set('knowledgeBaseId', 'kb-1')
  if (file) fd.set('file', file)
  return fd
}

const pdf = () => new File(['%PDF-1.4'], 'infographic.pdf', { type: 'application/pdf' })

// A thrown Server Action error reaches the browser only as React #441 in
// production, so failures must come back as a value with a real message.
describe('submitFileSourceAction', () => {
  beforeEach(() => {
    submitFileSourceMock.mockReset()
  })

  it('returns the submission id on success', async () => {
    submitFileSourceMock.mockResolvedValue({ submissionId: 'sub-1' })
    await expect(submitFileSourceAction(formWith(pdf()))).resolves.toEqual({ ok: true, submissionId: 'sub-1' })
  })

  it('returns a missing file as an error instead of throwing', async () => {
    await expect(submitFileSourceAction(formWith(null))).resolves.toEqual({ ok: false, error: 'No file provided' })
    expect(submitFileSourceMock).not.toHaveBeenCalled()
  })

  it('passes validation messages through verbatim', async () => {
    submitFileSourceMock.mockRejectedValue(new DocumentValidationError('Unsupported file type: image/png'))
    await expect(submitFileSourceAction(formWith(pdf()))).resolves.toEqual({ ok: false, error: 'Unsupported file type: image/png' })

    submitFileSourceMock.mockRejectedValue(new ProjectValidationError('This knowledge base is not attached to this project'))
    await expect(submitFileSourceAction(formWith(pdf()))).resolves.toEqual({
      ok: false,
      error: 'This knowledge base is not attached to this project',
    })
  })

  it('surfaces a Supabase Storage rejection', async () => {
    const storageError = Object.assign(new Error('The object exceeded the maximum allowed size'), { __isStorageError: true })
    submitFileSourceMock.mockRejectedValue(storageError)
    await expect(submitFileSourceAction(formWith(pdf()))).resolves.toEqual({
      ok: false,
      error: 'Storing the file failed: The object exceeded the maximum allowed size',
    })
  })

  it('hides unexpected errors behind a generic message and logs them', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    submitFileSourceMock.mockRejectedValue(new Error('connection reset'))
    const result = await submitFileSourceAction(formWith(pdf()))
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('error', 'connection reset')
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
