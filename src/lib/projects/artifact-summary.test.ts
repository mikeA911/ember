import { describe, expect, it } from 'vitest'
import { artifactCountLabel, artifactPreview, countArtifacts, sortArtifactsForReview } from './artifact-summary'

describe('countArtifacts / artifactCountLabel', () => {
  it('counts total, awaiting review and approved', () => {
    const counts = countArtifacts([{ status: 'ready_for_review' }, { status: 'approved' }, { status: 'draft' }, { status: 'approved' }])
    expect(counts).toEqual({ total: 4, awaitingReview: 1, approved: 2 })
    expect(artifactCountLabel(counts)).toBe('4 artifacts · 1 awaiting review')
  })

  it('omits the review part when nothing is waiting, and is null when empty', () => {
    expect(artifactCountLabel({ total: 1, awaitingReview: 0, approved: 1 })).toBe('1 artifact')
    expect(artifactCountLabel({ total: 0, awaitingReview: 0, approved: 0 })).toBeNull()
  })
})

describe('sortArtifactsForReview', () => {
  it('puts awaiting-review first, then newest first within a status', () => {
    const sorted = sortArtifactsForReview([
      { id: 'a', status: 'approved' as const, created_at: '2026-09-03' },
      { id: 'b', status: 'ready_for_review' as const, created_at: '2026-09-01' },
      { id: 'c', status: 'approved' as const, created_at: '2026-09-05' },
      { id: 'd', status: 'rejected' as const, created_at: '2026-09-09' },
      { id: 'e', status: 'ready_for_review' as const, created_at: '2026-09-02' },
    ])
    expect(sorted.map((a) => a.id)).toEqual(['e', 'b', 'c', 'a', 'd'])
  })
})

describe('artifactPreview', () => {
  it('strips common markdown onto one line', () => {
    expect(artifactPreview('# Findings\n\n- **Latency** is [high](http://x)\n\n```js\ncode()\n```\nDone')).toBe('Findings Latency is high Done')
  })

  it('caps long content and handles empty content', () => {
    const preview = artifactPreview('word '.repeat(100))!
    expect(preview.length).toBeLessThanOrEqual(140)
    expect(preview.endsWith('…')).toBe(true)
    expect(artifactPreview(null)).toBeNull()
    expect(artifactPreview('```\nonly code\n```')).toBeNull()
  })
})
