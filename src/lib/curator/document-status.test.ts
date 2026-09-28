import { describe, it, expect } from 'vitest'
import type { Document } from '@/types/database'
import { documentRowStatus } from './document-status'

function doc(processing_status: Document['processing_status']): Document {
  return { processing_status } as Document
}

describe('documentRowStatus', () => {
  it('calls a fully approved document Searchable even though its workflow stage is still review', () => {
    expect(documentRowStatus(doc('review'), { total: 12, approved: 12, rejected: 0 })).toMatchObject({
      label: 'Searchable',
      needsReview: false,
      note: undefined,
    })
  })

  it('counts a fully decided document with some rejected chunks as Searchable', () => {
    expect(documentRowStatus(doc('review'), { total: 3, approved: 2, rejected: 1 }).label).toBe('Searchable')
  })

  it('says Needs review while any chunk is undecided', () => {
    expect(documentRowStatus(doc('review'), { total: 12, approved: 2, rejected: 0 })).toMatchObject({ label: 'Needs review', needsReview: true })
  })

  it('keeps admin sign-off as a secondary note', () => {
    expect(documentRowStatus(doc('submitted'), { total: 3, approved: 3, rejected: 0 })).toMatchObject({
      label: 'Searchable',
      note: 'Awaiting admin sign-off',
    })
    expect(documentRowStatus(doc('completed'), { total: 3, approved: 3, rejected: 0 }).note).toBe('Signed off by admin')
  })

  it('says when every chunk was rejected', () => {
    expect(documentRowStatus(doc('review'), { total: 2, approved: 0, rejected: 2 }).label).toBe('All chunks rejected')
  })

  it('shows the processing stage before chunks exist, and failures', () => {
    expect(documentRowStatus(doc('parsing'), undefined).label).toBe('Processing…')
    expect(documentRowStatus(doc('failed'), undefined).label).toBe('Failed')
  })
})
