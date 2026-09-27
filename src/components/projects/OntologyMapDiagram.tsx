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
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // Presentation-safe: an <a> inside an exported SVG/PNG is inert anyway,
  // and a white background is assumed below for the PNG canvas -- match it
  // here too so the standalone .svg file doesn't render transparent (and
  // look broken) when dropped into a slide deck with a non-white theme.
  clone.style.backgroundColor = '#ffffff'
  return new XMLSerializer().serializeToString(clone)
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadSvg(svg: SVGSVGElement, filename: string) {
  const source = serializeSvg(svg)
  triggerDownload(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

// SVG -> Image -> Canvas -> PNG blob -- no external library, same technique
// browsers use natively for "download as image." Rendered at 2x for a
// crisper result when the PNG is scaled up in a slide deck.
async function downloadPng(svg: SVGSVGElement, filename: string) {
  const width = Number(svg.getAttribute('width'))
  const height = Number(svg.getAttribute('height'))
  const scale = 2
  const source = serializeSvg(svg)
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

// Cubic bezier between two node edges, curving from whichever side of
// `from` actually faces `to` -- object-link edges run right-to-left
// (workstream cluster back to the object cluster), everything else runs
// left-to-right, and a single formula handles both by relative x position.
function edgePath(from: OntologyMapNode, to: OntologyMapNode): string {
  const fromRight = from.x + from.width
  const toRight = to.x + to.width
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

export function OntologyMapDiagram({ layout, projectId, projectName }: { layout: OntologyMapLayout; projectId: string; projectName: string }) {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  const svgRef = useRef<SVGSVGElement>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const baseFilename = `${slugForFilename(projectName)}-ontology-map`

  function handleDownloadSvg() {
    if (!svgRef.current) return
    setExportError(null)
    downloadSvg(svgRef.current, `${baseFilename}.svg`)
  }

  async function handleDownloadPng() {
    if (!svgRef.current) return
    setExportError(null)
    try {
      await downloadPng(svgRef.current, `${baseFilename}.png`)
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
          aria-label="Ontology map: this project's domain-object tree and workstreams, with their pipeline order and linked objects"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="block"
        >
          <defs>
            <marker id="ontology-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#a78bfa" />
            </marker>
          </defs>

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
            const content = (
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
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-blue-300 bg-blue-50" /> Domain object
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-300 bg-amber-50" /> Workstream (click to open)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-zinc-300" /> Parent / nesting
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-violet-400" /> Pipeline order
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dotted border-teal-400" /> Reads / writes / creates
        </span>
      </div>
    </div>
  )
}
