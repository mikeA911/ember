import { describe, it, expect } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { formatMessageWithAttachment, formatMessageWithAttachments } from './attachments'
import { runImportOntologyFile, runPreviewOntologyFileImport, PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL_NAME } from './ontology-file-import-tool'

const TTL = `@prefix ex: <https://example.org/x#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Asset a owl:Class ; rdfs:label "Asset"@en .
ex:Vehicle a owl:Class ; rdfs:subClassOf ex:Asset ; rdfs:label "Vehicle"@en .`

const attachMessage = { role: 'user', content: formatMessageWithAttachment('Import this ontology', { name: 'fleet.ttl', text: TTL, truncated: false }) }
const previewRow = { role: 'tool', tool_name: PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL_NAME, content: JSON.stringify({ fileName: 'fleet.ttl' }) }
const confirmRow = { role: 'user', content: 'Yes, import it' }

function fakeCtx(supabase: unknown, role = 'consultant'): WorkbenchCallerContext {
  return { user: { id: 'user-1' }, profile: { id: 'user-1', role }, supabase } as unknown as WorkbenchCallerContext
}

describe('runPreviewOntologyFileImport', () => {
  it('previews from the attached file, flagging what is already on the map and who can import', async () => {
    const supabase = createFakeSupabase({
      chat_messages: [{ data: [attachMessage], error: null }],
      project_objects: [{ data: [{ id: 'existing-1', name: 'asset', slug: 'asset' }], error: null }],
      project_members: [{ data: { role: 'member' }, error: null }],
    })

    const preview = await runPreviewOntologyFileImport(fakeCtx(supabase), 'proj-1', 'conv-1', {})

    expect(preview).toMatchObject({ fileName: 'fleet.ttl', classes: 2, objectsToCreate: 1, alreadyOnMap: ['Asset'], canImport: false })
    expect(preview.outline).toBe('- Asset\n  - Vehicle')
    expect(supabase._calls.some((c) => c.method === 'insert')).toBe(false)
  })

  it('refuses a truncated attachment rather than previewing part of it', async () => {
    const truncated = { role: 'user', content: formatMessageWithAttachment('', { name: 'big.ttl', text: TTL, truncated: true }) }
    const supabase = createFakeSupabase({ chat_messages: [{ data: [truncated], error: null }] })

    await expect(runPreviewOntologyFileImport(fakeCtx(supabase), 'proj-1', 'conv-1', {})).rejects.toThrow(/too large/)
  })

  it('picks the ontology over a shapes file attached with it (e.g. from one zip)', async () => {
    const shapes = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/x#> .
ex:AssetShape a sh:NodeShape ; sh:targetClass ex:Asset .`
    const both = {
      role: 'user',
      content: formatMessageWithAttachments('Import these', [
        { name: 'files/fleet.ttl', text: TTL, truncated: false },
        { name: 'files/fleet-shapes.ttl', text: shapes, truncated: false },
      ]),
    }
    const supabase = createFakeSupabase({
      chat_messages: [{ data: [both], error: null }],
      project_objects: [{ data: [], error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
    })

    expect((await runPreviewOntologyFileImport(fakeCtx(supabase), 'proj-1', 'conv-1', {})).fileName).toBe('files/fleet.ttl')

    const byBareName = createFakeSupabase({
      chat_messages: [{ data: [both], error: null }],
      project_objects: [{ data: [], error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
    })
    expect((await runPreviewOntologyFileImport(fakeCtx(byBareName), 'proj-1', 'conv-1', { fileName: 'fleet.ttl' })).classes).toBe(2)
  })
})

describe('runImportOntologyFile', () => {
  it('refuses in the same turn as the preview, before writing anything', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      chat_messages: [{ data: [attachMessage, previewRow], error: null }],
    })

    await expect(runImportOntologyFile(fakeCtx(supabase), 'proj-1', 'conv-1', { fileName: 'fleet.ttl' })).rejects.toThrow(/preview_ontology_file_import/)
    expect(supabase._calls.some((c) => c.table === 'project_objects' && c.method === 'insert')).toBe(false)
  })

  it('imports the previewed tree after the user confirms', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      chat_messages: [{ data: [attachMessage, previewRow, confirmRow], error: null }],
      project_objects: [
        { data: [], error: null },
        { data: [{ id: 'obj-asset' }], error: null },
        { data: [{ id: 'obj-vehicle' }], error: null },
      ],
    })

    const result = await runImportOntologyFile(fakeCtx(supabase), 'proj-1', 'conv-1', { fileName: 'fleet.ttl' })

    expect(result).toEqual({ objectsCreated: 2, skippedAlreadyOnMap: 0, ontologyMapUrl: '/projects/proj-1#ontology-map' })
    const inserts = supabase._calls.filter((c) => c.table === 'project_objects' && c.method === 'insert').map((c) => c.args)
    expect(inserts).toEqual([
      [expect.objectContaining({ name: 'Asset', slug: 'asset', parent_object_id: null, project_id: 'proj-1', created_by: 'user-1' })],
      [expect.objectContaining({ name: 'Vehicle', slug: 'vehicle', parent_object_id: 'obj-asset' })],
    ])
  })

  it('skips objects already on the map and hangs new children off them', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'curator' }, error: null }],
      chat_messages: [{ data: [attachMessage, previewRow, confirmRow], error: null }],
      project_objects: [
        { data: [{ id: 'existing-asset', name: 'Asset', slug: 'asset' }], error: null },
        { data: [{ id: 'obj-vehicle' }], error: null },
      ],
    })

    const result = await runImportOntologyFile(fakeCtx(supabase), 'proj-1', 'conv-1', { fileName: 'fleet.ttl' })

    expect(result.objectsCreated).toBe(1)
    expect(result.skippedAlreadyOnMap).toBe(1)
    const inserts = supabase._calls.filter((c) => c.table === 'project_objects' && c.method === 'insert').map((c) => c.args)
    expect(inserts).toEqual([[expect.objectContaining({ name: 'Vehicle', parent_object_id: 'existing-asset' })]])
  })

  it("refuses a caller who isn't this project's owner or curator", async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'member' }, error: null }] })

    await expect(runImportOntologyFile(fakeCtx(supabase), 'proj-1', 'conv-1', { fileName: 'fleet.ttl' })).rejects.toThrow(/owner or curator/)
  })
})
