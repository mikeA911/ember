import { describe, it, expect } from 'vitest'
import { computeOntologyMapLayout, type OntologyMapData } from './ontology-map'

function emptyData(overrides: Partial<OntologyMapData> = {}): OntologyMapData {
  return { objects: [], workstreams: [], flowEdges: [], linkEdges: [], ...overrides }
}

describe('computeOntologyMapLayout', () => {
  it('returns an empty layout for a project with no ontology data', () => {
    const layout = computeOntologyMapLayout(emptyData())
    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
  })

  it('places a parent before its children (increasing x by depth) and adds an object-parent edge', () => {
    const layout = computeOntologyMapLayout(
      emptyData({
        objects: [
          { id: 'root', name: 'PhysicalAsset', parentId: null },
          { id: 'child-1', name: 'Camera', parentId: 'root' },
          { id: 'child-2', name: 'Sensor', parentId: 'root' },
        ],
      })
    )
    const root = layout.nodes.find((n) => n.id === 'root')!
    const child1 = layout.nodes.find((n) => n.id === 'child-1')!
    const child2 = layout.nodes.find((n) => n.id === 'child-2')!
    expect(root.x).toBeLessThan(child1.x)
    expect(root.x).toBeLessThan(child2.x)
    // Two children at the same depth get distinct rows (no vertical overlap).
    expect(child1.y).not.toEqual(child2.y)
    // The parent sits at the average row of its children.
    expect(root.y).toBeCloseTo((child1.y + child2.y) / 2)

    expect(layout.edges).toContainEqual(expect.objectContaining({ fromId: 'root', toId: 'child-1', kind: 'object-parent' }))
    expect(layout.edges).toContainEqual(expect.objectContaining({ fromId: 'root', toId: 'child-2', kind: 'object-parent' }))
  })

  it('treats a dangling parentId (pointing at a row outside this project) as standalone, without a phantom edge', () => {
    const layout = computeOntologyMapLayout(emptyData({ objects: [{ id: 'orphan', name: 'Orphan', parentId: 'does-not-exist' }] }))
    expect(layout.nodes).toHaveLength(1)
    expect(layout.nodes[0]).toMatchObject({ x: 20, compact: true }) // PADDING -- a standalone table cell, not nested
    expect(layout.edges).toEqual([])
  })

  it('stacks connected objects, then workstreams, then the standalone-objects table, top to bottom', () => {
    const layout = computeOntologyMapLayout(
      emptyData({
        objects: [
          { id: 'root', name: 'Organization', parentId: null },
          { id: 'child', name: 'Vendor', parentId: 'root' },
          { id: 'linked', name: 'Incident', parentId: null },
          { id: 'solo', name: 'Benchmark', parentId: null },
        ],
        workstreams: [{ id: 'ws-1', name: 'Dispatch', parentId: null }],
        linkEdges: [{ workstreamId: 'ws-1', objectId: 'linked', accessModes: ['reads'] }],
      })
    )
    const node = (id: string) => layout.nodes.find((n) => n.id === id)!
    const connectedBottom = Math.max(...['root', 'child', 'linked'].map((id) => node(id).y + node(id).height))
    expect(node('ws-1').y).toBeGreaterThan(connectedBottom)
    expect(node('solo').y).toBeGreaterThan(node('ws-1').y + node('ws-1').height)
    // Only the object with no parent, children or workstream link is a table cell.
    expect(layout.nodes.filter((n) => n.compact).map((n) => n.id)).toEqual(['solo'])
    expect(layout.headings.map((h) => h.text)).toEqual([
      'Connected domain objects -- hierarchies and workstream links',
      'Workstreams',
      'Other domain objects -- not nested or linked (1)',
    ])
    expect(layout.height).toBeGreaterThanOrEqual(node('solo').y + node('solo').height)
  })

  it('packs standalone objects into an alphabetical table filled column by column, with no overlapping cells', () => {
    const names = Array.from({ length: 30 }, (_, i) => `Class${String(i).padStart(2, '0')}`)
    const layout = computeOntologyMapLayout(
      emptyData({ objects: [...names].reverse().map((name) => ({ id: name, name, parentId: null })) })
    )
    const cells = layout.nodes
    expect(cells.every((c) => c.compact)).toBe(true)
    const columns = new Set(cells.map((c) => c.x)).size
    expect(columns).toBeGreaterThan(1)
    // Alphabetical down the first column, then on to the next.
    const first = cells.find((c) => c.label === 'Class00')!
    const second = cells.find((c) => c.label === 'Class01')!
    expect(second.x).toBe(first.x)
    expect(second.y).toBeGreaterThan(first.y)
    const positions = new Set(cells.map((c) => `${c.x},${c.y}`))
    expect(positions.size).toBe(cells.length)
    expect(layout.headings).toEqual([expect.objectContaining({ text: 'Other domain objects -- not nested or linked (30)' })])
  })

  it('produces a workstream-flow edge for a pipeline edge between two workstreams', () => {
    const layout = computeOntologyMapLayout(
      emptyData({
        workstreams: [
          { id: 'ws-1', name: 'Upstream', parentId: null },
          { id: 'ws-2', name: 'Downstream', parentId: null },
        ],
        flowEdges: [{ upstreamId: 'ws-1', downstreamId: 'ws-2' }],
      })
    )
    expect(layout.edges).toContainEqual(expect.objectContaining({ fromId: 'ws-1', toId: 'ws-2', kind: 'workstream-flow' }))
  })

  it('produces a labeled object-link edge for a workstream_object_links row', () => {
    const layout = computeOntologyMapLayout(
      emptyData({
        objects: [{ id: 'obj-1', name: 'Sensor', parentId: null }],
        workstreams: [{ id: 'ws-1', name: 'Ingest', parentId: null }],
        linkEdges: [{ workstreamId: 'ws-1', objectId: 'obj-1', accessModes: ['reads', 'writes'] }],
      })
    )
    expect(layout.edges).toContainEqual(
      expect.objectContaining({ fromId: 'ws-1', toId: 'obj-1', kind: 'object-link', label: 'reads, writes' })
    )
  })

  it('drops an edge whose referenced node is not in this layout (defensive, should not happen from real data)', () => {
    const layout = computeOntologyMapLayout(
      emptyData({
        workstreams: [{ id: 'ws-1', name: 'Solo', parentId: null }],
        flowEdges: [{ upstreamId: 'ws-1', downstreamId: 'missing' }],
      })
    )
    expect(layout.edges).toEqual([])
  })
})
