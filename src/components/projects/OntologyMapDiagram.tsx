'use client'

import { useRef, useState } from 'react'
import type { OntologyMapLayout, OntologyMapNode } from '@/lib/projects/ontology-map'

// Real SVG <text>/<a> elements throughout (never rasterized) -- every node
// label stays selectable and screen-reader readable, and every workstream
// node is a real, focusable link to its own page, same "no separate
// fallback bolted on" principle AssistantFlow.tsx already follows for its
// own hand-built diagram. No diagram library (none exists in this
// codebase) -- plain SVG paths computed from computeOntologyMapLayout's
// already-resolved node positions.
//
// 'use client' is needed only for the export buttons below (Blob/canvas are
// browser APIs) -- the diagram itself is still plain static markup, same
// Blob + <a download> pattern as CopyArtifactButton's own "Save .md".

function slugForFilename(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

// The intrinsic width/height attributes (not the visible, possibly-scrolled
// viewport) are what get exported -- the whole diagram, at full size,
// regardless of how much of it happens to be on screen when the button is
// clicked.
//
// Every export is stamped with when it was downloaded -- a footer line drawn
// into the image itself (so it survives being pasted into a deck) plus the
// date in the filename -- so a copy that outlives the live, still-changing
// map is obviously a point-in-time snapshot.
const STAMP_HEIGHT = 28

function serializeSvg(svg: SVGSVGElement, stamp: string): { source: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const width = Number(svg.getAttribute('width'))
  const height = Number(svg.getAttribute('height')) + STAMP_HEIGHT
  clone.setAttribute('height', String(height))
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  text.setAttribute('x', '12')
  text.setAttribute('y', String(height - 10))
  text.setAttribute('font-size', '11')
  text.setAttribute('fill', '#71717a')
  text.textContent = stamp
  clone.appendChild(text)
  // Presentation-safe: an <a> inside an exported SVG/PNG is inert anyway,
  // and a white background is assumed below for the PNG canvas -- match it
  // here too so the standalone .svg file doesn't render transparent (and
  // look broken) when dropped into a slide deck with a non-white theme.
  clone.style.backgroundColor = '#ffffff'
  return { source: new XMLSerializer().serializeToString(clone), width, height }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadSvg(svg: SVGSVGElement, stamp: string, filename: string) {
  const { source } = serializeSvg(svg, stamp)
  triggerDownload(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

// SVG -> Image -> Canvas -> PNG blob -- no external library, same technique
// browsers use natively for "download as image." Rendered at 2x for a
// crisper result when the PNG is scaled up in a slide deck.
async function downloadPng(svg: SVGSVGElement, stamp: string, filename: string) {
  const scale = 2
  const { source, width, height } = serializeSvg(svg, stamp)
  const svgUrl = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to render the diagram for export'))
      img.src = svgUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not supported in this browser')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.drawImage(image, 0, 0, width, height)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Failed to encode the diagram as PNG')
    triggerDownload(blob, filename)
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

const NODE_FILL: Record<OntologyMapNode['kind'], string> = { object: '#eff6ff', workstream: '#fffbeb' }
const NODE_STROKE: Record<OntologyMapNode['kind'], string> = { object: '#93c5fd', workstream: '#fcd34d' }
const NODE_TEXT: Record<OntologyMapNode['kind'], string> = { object: '#1e3a8a', workstream: '#78350f' }

// Cubic bezier between two nodes. Side by side (a tree's parent and child,
// pipeline steps) it runs horizontally from whichever side of `from` faces
// `to`; stacked (a workstream in the band below linking up to an object it
// reads or writes) it runs vertically between the facing top/bottom edges.
function edgePath(from: OntologyMapNode, to: OntologyMapNode): string {
  const fromRight = from.x + from.width
  const toRight = to.x + to.width
  if (to.x >= fromRight || toRight <= from.x) {
    const forward = to.x >= fromRight
    const startX = forward ? fromRight : from.x
    const endX = forward ? to.x : toRight
    const startY = from.y + from.height / 2
    const endY = to.y + to.height / 2
    const dx = Math.max(30, Math.abs(endX - startX) / 2)
    const c1x = forward ? startX + dx : startX - dx
    const c2x = forward ? endX - dx : endX + dx
    return `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`
  }
  const down = to.y >= from.y
  const startX = from.x + from.width / 2
  const endX = to.x + to.width / 2
  const startY = down ? from.y + from.height : from.y
  const endY = down ? to.y : to.y + to.height
  const dy = Math.max(30, Math.abs(endY - startY) / 2)
  return `M ${startX} ${startY} C ${startX} ${down ? startY + dy : startY - dy}, ${endX} ${down ? endY - dy : endY + dy}, ${endX} ${endY}`
}

// The colour key, drawn into the SVG itself (above the diagram) rather than
// as page text, so it's the first thing read and it survives an SVG/PNG
// export into a deck or a printout. Two fixed rows -- box colours, then line
// styles -- rather than wrapping on estimated text widths, which don't
// match whatever font the viewer's browser actually renders with.
type LegendItem = { label: string } & ({ swatch: OntologyMapNode['kind'] } | { line: { stroke: string; dash?: string } })
const LEGEND_ROWS: LegendItem[][] = [
  [
    { label: 'Domain object', swatch: 'object' },
    { label: 'Workstream (click to open)', swatch: 'workstream' },
  ],
  [
    { label: 'Parent / nesting', line: { stroke: '#d4d4d8' } },
    { label: 'Pipeline order', line: { stroke: '#a78bfa', dash: '5 3' } },
    { label: 'Reads / writes / creates', line: { stroke: '#5eead4', dash: '1 3' } },
  ],
]
const LEGEND_PADDING = 20
const LEGEND_ROW_HEIGHT = 20
const LEGEND_COLUMN_WIDTH = 210
// Legend rows, plus a gap and a divider line before the diagram.
const LEGEND_HEIGHT = LEGEND_PADDING + LEGEND_ROWS.length * LEGEND_ROW_HEIGHT + 4
const LEGEND_MIN_WIDTH = LEGEND_PADDING * 2 + 3 * LEGEND_COLUMN_WIDTH
const LEGEND_ITEMS = LEGEND_ROWS.flatMap((row, r) =>
  row.map((item, c) => ({ item, x: LEGEND_PADDING + c * LEGEND_COLUMN_WIDTH, y: LEGEND_PADDING + r * LEGEND_ROW_HEIGHT }))
)

export function OntologyMapDiagram({ layout, projectId, projectName }: { layout: OntologyMapLayout; projectId: string; projectName: string }) {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  const width = Math.max(layout.width, LEGEND_MIN_WIDTH)
  const offsetY = LEGEND_HEIGHT
  const height = layout.height + offsetY
  const svgRef = useRef<SVGSVGElement>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  // Computed at click time, in the viewer's own timezone.
  function exportNames() {
    const now = new Date()
    const date = now.toLocaleDateString('en-CA') // YYYY-MM-DD
    const when = now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    return {
      stamp: `${projectName} -- ontology map -- downloaded ${when}`,
      baseFilename: `${slugForFilename(projectName)}-ontology-map-${date}`,
    }
  }

  function handleDownloadSvg() {
    if (!svgRef.current) return
    setExportError(null)
    const { stamp, baseFilename } = exportNames()
    downloadSvg(svgRef.current, stamp, `${baseFilename}.svg`)
  }

  async function handleDownloadPng() {
    if (!svgRef.current) return
    setExportError(null)
    const { stamp, baseFilename } = exportNames()
    try {
      await downloadPng(svgRef.current, stamp, `${baseFilename}.png`)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export the diagram')
    }
  }

  return (
    <div className="overflow-hidden rounded border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2">
        <span className="text-xs text-zinc-500">For a slide deck or sharing outside Ember:</span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Download SVG
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Download PNG
          </button>
        </span>
      </div>
      {exportError && <p className="px-3 pt-2 text-xs text-red-600">{exportError}</p>}
      <div className="overflow-auto">
        <svg
          ref={svgRef}
          role="img"
          aria-label="Ontology map: this project's connected domain objects, its workstreams with their pipeline order and linked objects, and a table of its other domain objects"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          <defs>
            <marker id="ontology-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#a78bfa" />
            </marker>
          </defs>

          <g fontSize={11} fill="#52525b">
            {LEGEND_ITEMS.map(({ item, x, y }) => (
              <g key={item.label}>
                {'swatch' in item ? (
                  <rect x={x} y={y - 9} width={14} height={11} rx={2} fill={NODE_FILL[item.swatch]} stroke={NODE_STROKE[item.swatch]} />
                ) : (
                  <line x1={x} y1={y - 4} x2={x + 18} y2={y - 4} stroke={item.line.stroke} strokeWidth={1.5} strokeDasharray={item.line.dash} />
                )}
                <text x={x + 22} y={y}>
                  {item.label}
                </text>
              </g>
            ))}
            <line x1={0} y1={offsetY - 4} x2={width} y2={offsetY - 4} stroke="#f4f4f5" />
          </g>

          <g transform={`translate(0 ${offsetY})`}>
            {layout.headings.map((heading) => (
              <text key={heading.text} x={heading.x} y={heading.y} fontSize={12} fontWeight={600} fill="#3f3f46">
                {heading.text}
              </text>
            ))}

            {layout.edges.map((edge) => {
              const from = byId.get(edge.fromId)
              const to = byId.get(edge.toId)
              if (!from || !to) return null
              const path = edgePath(from, to)
              if (edge.kind === 'workstream-flow') {
                return <path key={edge.id} d={path} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="5 3" markerEnd="url(#ontology-arrow)" />
              }
              if (edge.kind === 'object-link') {
                const midX = (from.x + from.width / 2 + to.x + to.width / 2) / 2
                const midY = (from.y + from.height / 2 + to.y + to.height / 2) / 2
                return (
                  <g key={edge.id}>
                    <path d={path} fill="none" stroke="#5eead4" strokeWidth={1} strokeDasharray="1 3" />
                    {edge.label && (
                      <text x={midX} y={midY - 4} fontSize={9} fill="#0f766e" textAnchor="middle">
                        {edge.label}
                      </text>
                    )}
                  </g>
                )
              }
              return <path key={edge.id} d={path} fill="none" stroke="#d4d4d8" strokeWidth={1.5} />
            })}

            {layout.nodes.map((node) => {
              // A standalone-objects table cell: square, touching its
              // neighbours, smaller left-aligned text.
              const content = node.compact ? (
                <g>
                  <rect x={node.x} y={node.y} width={node.width} height={node.height} fill={NODE_FILL[node.kind]} stroke={NODE_STROKE[node.kind]} strokeWidth={0.75} />
                  <text x={node.x + 8} y={node.y + node.height / 2 + 4} fontSize={11} fill={NODE_TEXT[node.kind]}>
                    {node.label}
                  </text>
                </g>
              ) : (
                <g>
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx={6}
                    fill={NODE_FILL[node.kind]}
                    stroke={NODE_STROKE[node.kind]}
                  />
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 + 4}
                    textAnchor="middle"
                    fontSize={12}
                    fill={NODE_TEXT[node.kind]}
                  >
                    {node.label}
                  </text>
                </g>
              )
              if (node.kind === 'workstream') {
                return (
                  <a key={node.id} href={`/projects/${projectId}/workstreams/${node.id}`}>
                    <title>{node.label}</title>
                    {content}
                  </a>
                )
              }
              return (
                <g key={node.id}>
                  <title>{node.label}</title>
                  {content}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
