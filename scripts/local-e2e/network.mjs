// Simulated networks for the local browser checks (Chromium). Set
// E2E_NETWORK to run any collaboration script under one of them:
//   slow   -- 400 ms added latency each way, ~1.5 Mbit/s down, 750 kbit/s up
//             (a poor mobile connection);
//   lossy  -- slow, and 25% of polls (status, watch, chat reads) fail, as on a
//             dropping connection; commands (navigate, save, ask) still go
//             through, because a failed command shows an error to retry;
//   (unset) -- the local network as it is.
// E2E_DEVICE=phone gives each browser a phone-sized screen and touch.

const PROFILES = {
  slow: { latency: 400, downloadThroughput: (1.5 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, pollLoss: 0 },
  lossy: { latency: 400, downloadThroughput: (1.5 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, pollLoss: 0.25 },
  drops: { latency: 0, pollLoss: 0.25 },
}
const POLLS = /\/rest\/v1\/rpc\/collaboration_(status|watch_status|chat)$/

export const network = process.env.E2E_NETWORK ?? ''
export const device = process.env.E2E_DEVICE ?? ''

export function contextOptions() {
  return device === 'phone'
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 1000 } }
}

// Applies the chosen network to a page; returns counters for the report.
export async function applyNetwork(page) {
  const stats = { dropped: 0, polls: 0 }
  const profile = PROFILES[network]
  if (!profile) return stats
  if (profile.latency) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.latency,
      downloadThroughput: profile.downloadThroughput,
      uploadThroughput: profile.uploadThroughput,
    })
  }
  if (profile.pollLoss > 0) {
    await page.route(POLLS, (route) => {
      stats.polls++
      if (Math.random() < profile.pollLoss) {
        stats.dropped++
        return route.abort('connectionreset')
      }
      return route.continue()
    })
  }
  return stats
}

// Scales a wait for the network: slower networks get longer timeouts.
export const slower = (ms) => (network ? ms * 3 : ms)
