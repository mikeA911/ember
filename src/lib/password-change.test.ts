import { describe, expect, it } from 'vitest'
import { mustChangePassword } from './password-change'

describe('mustChangePassword', () => {
  it('is true only when the flag is literally true', () => {
    expect(mustChangePassword({ user_metadata: { must_change_password: true } })).toBe(true)
    expect(mustChangePassword({ user_metadata: { must_change_password: false } })).toBe(false)
    expect(mustChangePassword({ user_metadata: { must_change_password: 'true' } })).toBe(false)
    expect(mustChangePassword({ user_metadata: {} })).toBe(false)
    expect(mustChangePassword({ user_metadata: null })).toBe(false)
    expect(mustChangePassword(null)).toBe(false)
  })
})
