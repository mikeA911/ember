import { parseCriteria, type CriterionCheck, type CriterionItem } from '@/lib/projects/criteria'

// A verification method's pass criteria, one item per acceptance criterion
// (src/lib/projects/criteria.ts). With checks (from a verification record),
// each item shows whether it was met.

function Item({ item }: { item: CriterionItem }) {
  return (
    <>
      {item.label && <span className="font-medium">{item.label}: </span>}
      {item.text}
    </>
  )
}

export function CriteriaList({ passCriteria, className = 'text-zinc-800' }: { passCriteria: string; className?: string }) {
  const items = parseCriteria(passCriteria)
  if (items.length <= 1) return <p className={`whitespace-pre-wrap ${className}`}>Pass: {passCriteria}</p>
  return (
    <div className={className}>
      <p>Pass when all of these hold:</p>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
        {items.map((item, i) => (
          <li key={i}>
            <Item item={item} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CriteriaChecks({ checks }: { checks: CriterionCheck[] }) {
  const met = checks.filter((c) => c.met).length
  return (
    <div className="mt-1 text-xs">
      <p className="text-zinc-500">
        Criteria met: {met} of {checks.length}
      </p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {checks.map((c, i) => (
          <li key={i} className={`flex items-start gap-1.5 ${c.met ? 'text-zinc-700' : 'text-red-700'}`}>
            <span aria-label={c.met ? 'Met' : 'Not met'} className="shrink-0">
              {c.met ? '☑' : '☐'}
            </span>
            <span>{c.criterion}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
