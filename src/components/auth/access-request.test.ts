import { describe, it, expect } from 'vitest'
import { accessRequestMailto } from './access-request'

describe('accessRequestMailto', () => {
  it('addresses the owner and carries the name, email and reason', () => {
    const url = accessRequestMailto('owner@example.com', { name: ' Ana Cruz ', email: 'ana@example.com', reason: ' I build CRM automations. ' })
    expect(url.startsWith('mailto:owner%40example.com?subject=')).toBe(true)
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1))
    expect(params.get('subject')).toBe('Ember builder access request: Ana Cruz')
    expect(params.get('body')).toBe('Name: Ana Cruz\nEmail: ana@example.com\n\nWhy I want to build with Ember:\nI build CRM automations.')
  })
})
