import { describe, expect, it } from 'vitest'
import { sliErrorMessage } from './errors'

describe('sliErrorMessage', () => {
  it('shows person-facing messages as written', () => {
    expect(sliErrorMessage({ code: 'EC101', message: 'Give a reason' })).toBe('Give a reason')
    expect(sliErrorMessage({ code: '42501', message: 'Only the Trigger\'s sponsor can do that' })).toBe('Only the Trigger\'s sponsor can do that')
  })

  it('hides internal details', () => {
    expect(sliErrorMessage({ code: '42501', message: 'SLI access denied' })).toBe('You don’t have access to that.')
    expect(sliErrorMessage({ code: '42501', message: 'Trigger not found' })).toBe('You don’t have access to that.')
    expect(sliErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint' })).toMatch(/Something went wrong/)
    expect(sliErrorMessage(null)).toMatch(/Something went wrong/)
  })
})
