// Builders ask for an account by email, giving a reason; the platform owner
// replies to accept or decline and creates the account from /admin.
export interface AccessRequestInput {
  name: string
  email: string
  reason: string
}

export function accessRequestMailto(to: string, input: AccessRequestInput): string {
  const subject = `Ember builder access request: ${input.name.trim()}`
  const body = [
    `Name: ${input.name.trim()}`,
    `Email: ${input.email.trim()}`,
    '',
    'Why I want to build with Ember:',
    input.reason.trim(),
  ].join('\n')
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
