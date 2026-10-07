import { describe, it, expect } from 'vitest'
import { criterionText, parseCriteria } from './criteria'

describe('parseCriteria', () => {
  it('keeps a single criterion as one item', () => {
    expect(parseCriteria('Location shown within 2 s for 20 of 20 calls')).toEqual([{ label: null, text: 'Location shown within 2 s for 20 of 20 calls' }])
    expect(parseCriteria('  ')).toEqual([])
    expect(parseCriteria(null)).toEqual([])
  })

  it('splits a paragraph of inline AC labels into one item each', () => {
    const items = parseCriteria('AC1: Project types The docs define two types. AC2: Stage template Each stage has a doc: purpose, roles. AC10: Location The docs live at the knowledge base level.')
    expect(items).toEqual([
      { label: 'AC1', text: 'Project types The docs define two types.' },
      { label: 'AC2', text: 'Stage template Each stage has a doc: purpose, roles.' },
      { label: 'AC10', text: 'Location The docs live at the knowledge base level.' },
    ])
  })

  it('keeps any lead-in text before the first label as its own item', () => {
    expect(parseCriteria('All of: AC1: one AC2: two').map((i) => i.label)).toEqual([null, 'AC1', 'AC2'])
  })

  it('splits lines, dropping bullets, checkboxes and numbering', () => {
    expect(parseCriteria('- first\n* second\n[ ] third\n\n4. fourth\nAC 5 - fifth')).toEqual([
      { label: null, text: 'first' },
      { label: null, text: 'second' },
      { label: null, text: 'third' },
      { label: '4', text: 'fourth' },
      { label: 'AC5', text: 'fifth' },
    ])
  })

  it('does not split on AC mentioned without a colon', () => {
    expect(parseCriteria('Meets AC1 and AC2 as written')).toHaveLength(1)
  })
})

describe('criterionText', () => {
  it('writes the label back in front of the text', () => {
    expect(criterionText({ label: 'AC1', text: 'one' })).toBe('AC1: one')
    expect(criterionText({ label: null, text: 'one' })).toBe('one')
  })
})
