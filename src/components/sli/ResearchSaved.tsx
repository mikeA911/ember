import type { ResearchStage } from '@/lib/sli/api'

const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })

// What has been saved to a Trigger's research, by stage, with any paper
// still to write.
export function ResearchSaved({ stages }: { stages: ResearchStage[] }) {
  if (stages.length === 0) return <p className="text-sm text-zinc-500">Nothing saved yet.</p>
  return (
    <div className="space-y-4">
      {stages.map((stage) => {
        const missing = stage.deliverables.filter((d) => !stage.findings.some((f) => f.title.toLowerCase() === d.toLowerCase()))
        return (
          <div key={stage.workstreamId} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{stage.name}</h3>
            {missing.length > 0 && <p className="text-sm text-zinc-500">Still to write: {missing.join(', ')}.</p>}
            {stage.findings.length === 0 && missing.length === 0 && <p className="text-sm text-zinc-500">Nothing saved yet.</p>}
            <ul className="space-y-2">
              {stage.findings.map((f) => (
                <li key={f.id} className="rounded border border-zinc-200 bg-white text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap justify-between gap-2 px-3 py-2">
                      <span className="font-medium">{f.title}</span>
                      <span className="text-xs text-zinc-500">{when(f.createdAt)}</span>
                    </summary>
                    {f.content && <div className="whitespace-pre-wrap border-t border-zinc-100 px-3 py-2 text-zinc-800">{f.content}</div>}
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
