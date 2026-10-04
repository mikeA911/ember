import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const suggestProjectOntologyMock = vi.fn()
const applyProjectOntologySuggestionMock = vi.fn()
vi.mock('@/lib/ai', () => ({ aiHostingForProject: async () => 'any' }))
vi.mock('@/lib/workbench/project-ontology-suggestions', () => ({
  suggestProjectOntology: (...args: unknown[]) => suggestProjectOntologyMock(...args),
  applyProjectOntologySuggestion: (...args: unknown[]) => applyProjectOntologySuggestionMock(...args),
}))

const { runSuggestProjectOntology, runCreateProjectOntology } = await import('./project-ontology-tool')

function fakeCtx(supabase: unknown): WorkbenchCallerContext {
  return { user: { id: 'user-1' }, profile: { id: 'user-1', role: 'consultant' }, supabase } as unknown as WorkbenchCallerContext
}

describe('runSuggestProjectOntology', () => {
  it("passes the project's own type/objective/details through, folding a focusHint into the objective", async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { project_type: 'consulting', objective: 'Modernize dispatch', details: { region: 'Cebu' } }, error: null }],
      project_objects: [{ data: [], error: null }],
      project_workstreams: [{ data: [], error: null }],
    })
    suggestProjectOntologyMock.mockResolvedValue({ objects: [{ tempId: 'o1', parentTempId: null, name: 'Incident', description: '...' }], workstreams: [] })

    const result = await runSuggestProjectOntology(fakeCtx(supabase), 'project-1', { focusHint: 'video analytics' })

    expect(suggestProjectOntologyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectType: 'consulting',
        objective: 'Modernize dispatch\n\nFocus especially on: video analytics',
        details: { region: 'Cebu' },
      }),
      { selfHostedOnly: false }
    )
    expect(result.objects).toHaveLength(1)
    expect(result.existingObjectNames).toEqual([])
    expect(result.existingWorkstreamNames).toEqual([])
  })

  it('tells the model what this project already has, so it can avoid repeating it', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { project_type: 'consulting', objective: 'X', details: {} }, error: null }],
      project_objects: [{ data: [{ name: 'Sensor' }, { name: 'AnomalyEvent' }], error: null }],
      project_workstreams: [{ data: [{ name: 'Onboarding' }], error: null }],
    })
    suggestProjectOntologyMock.mockResolvedValue({ objects: [], workstreams: [] })

    const result = await runSuggestProjectOntology(fakeCtx(supabase), 'project-1', {})

    expect(result.existingObjectNames).toEqual(['Sensor', 'AnomalyEvent'])
    expect(result.existingWorkstreamNames).toEqual(['Onboarding'])
    expect(suggestProjectOntologyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: expect.objectContaining({
          existing_domain_objects_do_not_repeat: 'Sensor, AnomalyEvent',
          existing_workstreams_do_not_repeat: 'Onboarding',
        }),
      }),
      { selfHostedOnly: false }
    )
  })
})

describe('runCreateProjectOntology', () => {
  it('refuses when both objects and workstreams are empty, without calling apply', async () => {
    const supabase = createFakeSupabase({})
    await expect(runCreateProjectOntology(fakeCtx(supabase), 'project-1', { objects: [], workstreams: [] })).rejects.toThrow(
      'Nothing to create'
    )
    expect(applyProjectOntologySuggestionMock).not.toHaveBeenCalled()
  })

  it('applies the staged tree and returns a deep link to the Ontology Map', async () => {
    applyProjectOntologySuggestionMock.mockResolvedValue({ objectIds: ['obj-1'], workstreamIds: ['ws-1', 'ws-2'] })
    const supabase = createFakeSupabase({})

    const result = await runCreateProjectOntology(fakeCtx(supabase), 'project-1', {
      objects: [{ tempId: 'o1', parentTempId: null, name: 'Sensor' }],
      workstreams: [
        { tempId: 'w1', parentTempId: null, name: 'Onboarding', goal: 'Get set up' },
        { tempId: 'w2', parentTempId: null, name: 'Rollout' },
      ],
    })

    expect(applyProjectOntologySuggestionMock).toHaveBeenCalledWith(expect.anything(), 'project-1', {
      objects: [{ tempId: 'o1', parentTempId: null, name: 'Sensor', description: '' }],
      workstreams: [
        { tempId: 'w1', parentTempId: null, name: 'Onboarding', goal: 'Get set up' },
        { tempId: 'w2', parentTempId: null, name: 'Rollout', goal: '' },
      ],
    })
    expect(result).toEqual({
      objectsCreated: 1,
      workstreamsCreated: 2,
      workstreamIds: ['ws-1', 'ws-2'],
      ontologyMapUrl: '/projects/project-1#ontology-map',
    })
  })
})
