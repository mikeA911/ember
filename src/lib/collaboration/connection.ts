// One id per browser tab: the database lets exactly one tab speak for a
// person in a live session (the controller's tab is what holds control).
// Kept in sessionStorage so a refresh rejoins as the same tab without
// disturbing control. A duplicated tab copies sessionStorage, so on load
// we ask other tabs (BroadcastChannel) whether the stored id is already in
// use, and take a fresh id if it is.

const KEY = 'ember-collaboration-tab'
const CHANNEL = 'ember-collaboration-tabs'

let resolved: Promise<string> | null = null

export function getTabConnectionId(): Promise<string> {
  if (!resolved) resolved = resolve()
  return resolved
}

function fresh(): string {
  const id = crypto.randomUUID()
  try {
    sessionStorage.setItem(KEY, id)
  } catch {
    // Private mode or storage blocked: the id lives for this page load only.
  }
  return id
}

async function resolve(): Promise<string> {
  let stored: string | null = null
  try {
    stored = sessionStorage.getItem(KEY)
  } catch {
    stored = null
  }
  if (typeof BroadcastChannel === 'undefined') return stored ?? fresh()

  const channel = new BroadcastChannel(CHANNEL)
  let mine = stored
  if (stored) {
    const taken = await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), 150)
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === 'mine' && event.data.id === stored) {
          clearTimeout(timer)
          channel.removeEventListener('message', onMessage)
          done(true)
        }
      }
      channel.addEventListener('message', onMessage)
      channel.postMessage({ type: 'who', id: stored })
    })
    if (taken) mine = null
  }
  const id = mine ?? fresh()
  // Answer later tabs that were duplicated from this one.
  channel.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'who' && event.data.id === id) channel.postMessage({ type: 'mine', id })
  })
  return id
}
