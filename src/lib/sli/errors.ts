// The SLI functions raise person-facing messages with SQLSTATE EC101 and
// "no access" as 42501 (see the migrations). EC101 messages are shown as
// written; anything else is replaced so nothing internal reaches the page.
export function sliErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  if (code === 'EC101' && message) return message
  if (code === '42501') return message && !/denied|not found/i.test(message) ? message : 'You don’t have access to that.'
  return 'Something went wrong. Try again in a moment.'
}
