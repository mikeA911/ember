import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, OntologyMapData } from '@/types/database'

// Ontology Map: a visual node-link diagram of a Project's Builder Ontology
// (Parts A-D) -- project_objects (domain-object tree), project_workstreams
// (its own nesting tree, plus workstream_flow pipeline edges), and
// workstream_object_links connecting the two. Split into a data-fetch step
// and a pure layout-computation step (no React, no DOM) so the layout math
// is unit-testable on its own.
//
// OntologyMapData itself is declared in src/types/database.ts (not here) so
// PresentationSlide.diagramData (Workstream Presentation & Review) can
// reference it without that leaf types file importing application code.
export type { OntologyMapData }

// project_objects/project_workstreams/workstream_flow/workstream_object_links
// were all added by the Builder Ontology work this session -- a project
// created before that (most of the 49 real projects already in this
// deployment) simply has none of these rows, which every query below
// already handles by returning an empty array, not an error.
export async function getOntologyMapData(supabase: SupabaseClient<Database>, projectId: string): Promise<OntologyMapData> {
  const [{ data: objects, error: objectsError }, { data: workstreams, error: workstreamsError }] = await Promise.all([
    supabase.from('project_objects').select('id, name, parent_object_id').eq('project_id', projectId),
    supabase.from('project_workstreams').select('id, name, parent_workstream_id').eq('project_id', projectId),
  ])
  if (objectsError) throw objectsError
  if (workstreamsError) throw workstreamsError

  const workstreamIds = (workstreams ?? []).map((w) => w.id)
  const objectIds = (objects ?? []).map((o) => o.id)

  const [{ data: flow, error: flowError }, { data: links, error: linksError }] = await Promise.all([
    workstreamIds.length > 0
      ? supabase.from('workstream_flow').select('upstream_workstream_id, downstream_workstream_id').in('upstream_workstream_id', workstreamIds)
      : Promise.resolve({ data: [], error: null }),
    workstreamIds.length > 0 && objectIds.length > 0
      ? supabase.from('workstream_object_links').select('workstream_id, object_id, access_modes').in('workstream_id', workstreamIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (flowError) throw flowError
  if (linksError) throw linksError

  return {
    objects: (objects ?? []).map((o) => ({ id: o.id, name: o.name, parentId: o.parent_object_id })),
    workstreams: (workstreams ?? []).map((w) => ({ id: w.id, name: w.name, parentId: w.parent_workstream_id })),
    flowEdges: (flow ?? []).map((f) => ({ upstreamId: f.upstream_workstream_id, downstreamId: f.downstream_workstream_id })),
    linkEdges: (links ?? []).map((l) => ({ workstreamId: l.workstream_id, objectId: l.object_id, accessModes: l.access_modes })),
  }
}

export interface OntologyMapNode {
  id: string
  label: string
  kind: 'object' | 'workstream'
  x: number
  y: number
  width: number
  height: number
  // A cell of the compact "standalone objects" table at the bottom, drawn
  // smaller and left-aligned rather than as a free-floating box.
  compact?: boolean
}

export interface OntologyMapEdge {
  id: string
  fromId: string
  toId: string
  kind: 'object-parent' | 'workstream-parent' | 'workstream-flow' | 'object-link'
  label?: string
}

// A band title ("Connected domain objects", "Workstreams", ...) drawn above
// its band.
export interface OntologyMapHeading {
  text: string
  x: number
  y: number
}

export interface OntologyMapLayout {
  nodes: OntologyMapNode[]
  edges: OntologyMapEdge[]
  headings: OntologyMapHeading[]
  width: number
  height: number
}

const NODE_HEIGHT = 32
const ROW_HEIGHT = 44
const COLUMN_GAP = 48
const BAND_GAP = 28
const HEADING_HEIGHT = 26
const PADDING = 20
const CHAR_WIDTH = 7
const MIN_NODE_WIDTH = 90
const MAX_NODE_WIDTH = 220
// Standalone-objects table: small cells, as many per row as fit the
// diagram's width (never narrower than this, so a small ontology still gets
// a few columns instead of one long list).
const CELL_HEIGHT = 24
const CELL_CHAR_WIDTH = 6.5
const MIN_TABLE_WIDTH = 760

function nodeWidth(label: string): number {
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, label.length * CHAR_WIDTH + 24))
}

// Lays out one tree (objects, or workstreams via parent_workstream_id) left
// to right by depth, with siblings ordered alphabetically for a
// deterministic, presentable diagram. Uses the classic leaf-counting
// technique: a leaf gets the next sequential row slot; a parent's row is
// the average of its children's rows -- guarantees no vertical overlap
// without a general force-directed layout, and works for a forest (many
// disconnected roots) as well as a single tree.
function layoutTree(
  items: { id: string; label: string; parentId: string | null }[],
  kind: OntologyMapNode['kind'],
  startX: number,
  startY: number
): OntologyMapNode[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const childrenByParent = new Map<string | null, typeof items>()
  for (const item of items) {
    const key = item.parentId && byId.has(item.parentId) ? item.parentId : null
    if (!childrenByParent.has(key)) childrenByParent.set(key, [])
    childrenByParent.get(key)!.push(item)
  }
  for (const list of childrenByParent.values()) list.sort((a, b) => a.label.localeCompare(b.label))

  const rowById = new Map<string, number>()
  const depthById = new Map<string, number>()
  let nextLeafRow = 0

  function place(id: string, depth: number): number {
    depthById.set(id, depth)
    const children = childrenByParent.get(id) ?? []
    let row: number
    if (children.length === 0) {
      row = nextLeafRow
      nextLeafRow += 1
    } else {
      const childRows = children.map((c) => place(c.id, depth + 1))
      row = childRows.reduce((a, b) => a + b, 0) / childRows.length
    }
    rowById.set(id, row)
    return row
  }
  for (const root of childrenByParent.get(null) ?? []) place(root.id, 0)

  // Column x-offsets: each column's width is its own widest label, so
  // dense columns don't force sparse ones to sit further right than needed.
  const widthByDepth: number[] = []
  for (const item of items) {
    const depth = depthById.get(item.id) ?? 0
    widthByDepth[depth] = Math.max(widthByDepth[depth] ?? 0, nodeWidth(item.label))
  }
  const xByDepth: number[] = []
  let cursor = startX
  for (let d = 0; d < widthByDepth.length; d++) {
    xByDepth[d] = cursor
    cursor += (widthByDepth[d] ?? MIN_NODE_WIDTH) + COLUMN_GAP
  }

  return items.map((item) => {
    const depth = depthById.get(item.id) ?? 0
    return {
      id: item.id,
      label: item.label,
      kind,
      x: xByDepth[depth],
      y: startY + (rowById.get(item.id) ?? 0) * ROW_HEIGHT,
      width: nodeWidth(item.label),
      height: NODE_HEIGHT,
    }
  })
}

function bottomOf(nodes: OntologyMapNode[]): number {
  return nodes.reduce((max, n) => Math.max(max, n.y + n.height), 0)
}

// Top to bottom, so the part worth looking at comes first (and a printout
// doesn't spend its first page on a list):
//   1. Connected domain objects -- every object in a parent/child hierarchy
//      or read/written/created by a workstream, as left-to-right trees.
//   2. Workstreams, with their nesting and pipeline order.
//   3. Every other domain object -- standalone classes with no parent,
//      children or workstream link -- as a compact alphabetical table,
//      filled column by column.
export function computeOntologyMapLayout(data: OntologyMapData): OntologyMapLayout {
  const objectIds = new Set(data.objects.map((o) => o.id))
  const workstreamIds = new Set(data.workstreams.map((w) => w.id))
  const connected = new Set<string>()
  for (const o of data.objects) {
    if (o.parentId && objectIds.has(o.parentId)) {
      connected.add(o.id)
      connected.add(o.parentId)
    }
  }
  for (const l of data.linkEdges) {
    if (objectIds.has(l.objectId) && workstreamIds.has(l.workstreamId)) connected.add(l.objectId)
  }
  const connectedObjects = data.objects.filter((o) => connected.has(o.id))
  const standaloneObjects = data.objects.filter((o) => !connected.has(o.id)).sort((a, b) => a.name.localeCompare(b.name))

  const headings: OntologyMapHeading[] = []
  const nodes: OntologyMapNode[] = []
  let cursorY = PADDING

  function band(text: string, place: (startY: number) => OntologyMapNode[]) {
    headings.push({ text, x: PADDING, y: cursorY + 14 })
    const placed = place(cursorY + HEADING_HEIGHT)
    nodes.push(...placed)
    cursorY = bottomOf(placed) + BAND_GAP
  }

  if (connectedObjects.length > 0) {
    band('Connected domain objects -- hierarchies and workstream links', (y) =>
      layoutTree(
        connectedObjects.map((o) => ({ id: o.id, label: o.name, parentId: o.parentId })),
        'object',
        PADDING,
        y
      )
    )
  }
  if (data.workstreams.length > 0) {
    band('Workstreams', (y) =>
      layoutTree(
        data.workstreams.map((w) => ({ id: w.id, label: w.name, parentId: w.parentId })),
        'workstream',
        PADDING,
        y
      )
    )
  }
  if (standaloneObjects.length > 0) {
    const diagramWidth = nodes.reduce((max, n) => Math.max(max, n.x + n.width), 0) + PADDING
    const tableWidth = Math.max(diagramWidth, MIN_TABLE_WIDTH) - PADDING * 2
    const cellWidth = Math.min(
      MAX_NODE_WIDTH,
      Math.max(MIN_NODE_WIDTH, ...standaloneObjects.map((o) => Math.ceil(o.name.length * CELL_CHAR_WIDTH) + 16))
    )
    const columns = Math.max(1, Math.min(standaloneObjects.length, Math.floor(tableWidth / cellWidth)))
    const rows = Math.ceil(standaloneObjects.length / columns)
    band(`Other domain objects -- not nested or linked (${standaloneObjects.length})`, (y) =>
      standaloneObjects.map((o, i) => ({
        id: o.id,
        label: o.name,
        kind: 'object' as const,
        x: PADDING + Math.floor(i / rows) * cellWidth,
        y: y + (i % rows) * CELL_HEIGHT,
        width: cellWidth,
        height: CELL_HEIGHT,
        compact: true,
      }))
    )
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))

  const edges: OntologyMapEdge[] = []
  for (const o of data.objects) {
    if (o.parentId && byId.has(o.parentId) && byId.has(o.id)) {
      edges.push({ id: `op-${o.parentId}-${o.id}`, fromId: o.parentId, toId: o.id, kind: 'object-parent' })
    }
  }
  for (const w of data.workstreams) {
    if (w.parentId && byId.has(w.parentId)) {
      edges.push({ id: `wp-${w.parentId}-${w.id}`, fromId: w.parentId, toId: w.id, kind: 'workstream-parent' })
    }
  }
  for (const f of data.flowEdges) {
    if (byId.has(f.upstreamId) && byId.has(f.downstreamId)) {
      edges.push({ id: `wf-${f.upstreamId}-${f.downstreamId}`, fromId: f.upstreamId, toId: f.downstreamId, kind: 'workstream-flow' })
    }
  }
  for (const l of data.linkEdges) {
    if (byId.has(l.workstreamId) && byId.has(l.objectId)) {
      edges.push({
        id: `ol-${l.workstreamId}-${l.objectId}`,
        fromId: l.workstreamId,
        toId: l.objectId,
        kind: 'object-link',
        label: l.accessModes.join(', '),
      })
    }
  }

  const width = nodes.reduce((max, n) => Math.max(max, n.x + n.width), 0) + PADDING
  const height = nodes.length > 0 ? cursorY - BAND_GAP + PADDING : 0

  return { nodes, edges, headings, width: Math.max(width, PADDING * 2), height: Math.max(height, PADDING * 2) }
}
