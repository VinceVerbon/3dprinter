import { ref } from 'vue'

/**
 * Backend availability gate. Continuously probes the helper's /healthz and
 * exposes whether the app should render its data UI.
 *
 * Why this exists: the UI is useless without the helper (catalog, lookups,
 * load/save all go through it). Rather than render empty/broken pages that look
 * like "features are missing", the app blocks on a clear "connecting" state and
 * auto-retries. Combined with the Tauri host respawning a crashed helper and the
 * helper being tied to the app PID, this makes a backend blip self-heal instead
 * of stranding the user.
 *
 * Flap guard: once we've been healthy, a single missed probe does NOT hide the
 * UI — we require two consecutive failures, so a transient slow response or a
 * ~1s respawn window doesn't flash the overlay.
 */
const ready = ref(false)
const everReady = ref(false)
let pollTimer: number | null = null
let consecutiveFails = 0

async function probe(): Promise<boolean> {
  try {
    const r = await fetch('/api/healthz', { headers: { accept: 'application/json' } })
    return r.ok
  } catch {
    return false
  }
}

async function tick() {
  const ok = await probe()
  if (ok) {
    consecutiveFails = 0
    everReady.value = true
    ready.value = true
  } else {
    consecutiveFails += 1
    if (!everReady.value || consecutiveFails >= 2) ready.value = false
  }
}

export function useBackendGate() {
  if (pollTimer == null) {
    void tick()
    pollTimer = window.setInterval(() => { void tick() }, 1500)
  }
  return { ready, everReady }
}
