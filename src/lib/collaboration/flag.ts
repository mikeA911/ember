// Shared workspace sessions are off unless the deployment sets
// NEXT_PUBLIC_EMBER_COLLABORATION=true (a NEXT_PUBLIC_ value is fixed at
// build time, so changing it needs a rebuild). Off means no session bar,
// no Collaborate button, no Ember invitation tools and no shared history.
export function collaborationEnabled(): boolean {
  return process.env.NEXT_PUBLIC_EMBER_COLLABORATION === 'true'
}
