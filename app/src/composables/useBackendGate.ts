import { ref } from 'vue'

/**
 * Backend availability gate. Continuously probes the helper's /healthz and
 * exposes whether the app should render its data UI.
 *
 * Contract (per Vince): do NOT run the app in a broken/empty state, and do NOT
 * hang on a mystery spinner.
 *   - While connecting: `ready=false`, `stalled=false` → show "Starting…".
 *   - Connected: `ready=true` → render the app. Loads (re)run on (re)connect.
 *   - Can't reach the helper for a while: `ready=false`, `stalled=true` → show
 *     an explicit "can't reach the local helper, retrying" screen with a Retry
 *     button. We keep probing forever and recover automatically when it's back.
 * There is deliberately NO fail-open: the data UI stays gated until the backend
 * actually answers, so empty pages never masquerade as missing features.
 *
 * Flap guard: once healthy, a single missed probe does not hide the UI (needs
 * two consecutive failures), so the ~1s helper-respawn window doesn't flash.
 */
const ready = ref(false)
const everReady = ref(false)
const stalled = ref(false)
let pollTimer: number | null = null
let consecutiveFails = 0
let startedAt = 0
const STALL_AFTER_MS = 8000

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
    stalled.value = false
    return
  }
  consecutiveFails += 1
  if (!everReady.value || consecutiveFails >= 2) ready.value = false
  if (!ready.value && startedAt && Date.now() - startedAt > STALL_AFTER_MS) stalled.value = true
}

/** Force an immediate re-probe (Retry button). */
export function retryBackend() {
  stalled.value = false
  void tick()
}

export function useBackendGate() {
  if (pollTimer == null) {
    startedAt = Date.now()
    void tick()
    pollTimer = window.setInterval(() => { void tick() }, 1500)
  }
  return { ready, everReady, stalled, retry: retryBackend }
}
