import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const updateProjectObjectiveMock = vi.fn()
vi.mock('@/lib/workbench/projects', () => ({ updateProjectObjective: (...args: unknown[]) => updateProjectObjectiveMock(...args) }))

const { runUpdateProjectDescription } = await import('./project-description-tool')

const ctx = { user: { id: 'user-1' }, profile: { id: 'user-1', role: 'consultant' }, supabase: {} } as unknown as WorkbenchCallerContext

describe('runUpdateProjectDescription', () => {
  beforeEach(() => {
    updateProjectObjectiveMock.mockReset().mockResolvedValue(undefined)
  })

  it('writes the description to the bound project and returns a route back to it', async () => {
    const result = await runUpdateProjectDescription(ctx, 'proj-1', { description: '  Pilot Ember for the helpdesk  ' })

    expect(updateProjectObjectiveMock).toHaveBeenCalledWith(ctx, 'proj-1', '  Pilot Ember for the helpdesk  ')
    expect(result).toEqual({ description: 'Pilot Ember for the helpdesk', route: '/projects/proj-1' })
  })

  it('reports a cleared description as null', async () => {
    const result = await runUpdateProjectDescription(ctx, 'proj-1', { description: '' })
    expect(result.description).toBeNull()
  })

  it('surfaces the role refusal instead of swallowing it', async () => {
    updateProjectObjectiveMock.mockRejectedValue(new Error("Requires this project's owner or curator role (or platform admin) to edit its description"))
    await expect(runUpdateProjectDescription(ctx, 'proj-1', { description: 'X' })).rejects.toThrow('owner or curator role')
  })

  it('rejects input without a description string', async () => {
    await expect(runUpdateProjectDescription(ctx, 'proj-1', {})).rejects.toThrow()
    expect(updateProjectObjectiveMock).not.toHaveBeenCalled()
  })
})
