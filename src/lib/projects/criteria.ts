// Pass criteria as a checklist. A verification method's pass criteria is one
// text field; when it holds several acceptance criteria (one per line, or
// labelled "AC1: ... AC2: ..." in a single paragraph, as Ember sometimes
// drafts them), each becomes its own item so the requirement page can list
// them and a verification record can tick each one off. Pure, so the server
// and the client split text the same way.

export interface CriterionItem {
  // "AC1", "2", ... when the criterion carries a label; null otherwise.
  label: string | null
  text: string
}

// The tick recorded for one criterion with a verification result. The
// criterion text is copied so the record keeps what was ticked even if the
// method is edited later.
export interface CriterionCheck {
  criterion: string
  met: boolean
}

// "AC1:", "AC 2 -", "AC-3.", "Criterion 4:" at the start of an item.
const LABEL = /^((?:AC|Criterion|Criteria)\s*-?\s*\d+[a-z]?)\s*[:.)–—-]\s*/i
// The same labels mid-paragraph: a word boundary, then the label and its colon.
const INLINE_LABEL = /(?:^|\s)(?=(?:AC|Criterion)\s*-?\s*\d+[a-z]?\s*:)/gi
// List markers on a line: "- ", "* ", "• ", "1. ", "1) ", "[ ] ", "[x] ".
const BULLET = /^(?:[-*•]\s+|\[[ xX]?\]\s+)+/
const NUMBERED = /^(\d+[.)])\s+/

function toItem(raw: string): CriterionItem | null {
  let text = raw.trim().replace(BULLET, '').trim()
  if (!text) return null
  const labelled = text.match(LABEL)
  if (labelled) return { label: labelled[1].replace(/\s+/g, ''), text: text.slice(labelled[0].length).trim() || labelled[1] }
  const numbered = text.match(NUMBERED)
  if (numbered) text = text.slice(numbered[0].length).trim()
  return { label: numbered ? numbered[1].slice(0, -1) : null, text }
}

export function parseCriteria(passCriteria: string | null | undefined): CriterionItem[] {
  const source = (passCriteria ?? '').trim()
  if (!source) return []
  const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // One paragraph: split before each inline "AC1:", "AC2:", ... label.
  const parts = lines.length > 1 ? lines : source.split(INLINE_LABEL).map((p) => p.trim()).filter(Boolean)
  const items = parts.map(toItem).filter((x): x is CriterionItem => !!x)
  return items.length > 0 ? items : [{ label: null, text: source }]
}

// The text recorded for a criterion: its label and text, as written.
export function criterionText(item: CriterionItem): string {
  return item.label ? `${item.label}: ${item.text}` : item.text
}
