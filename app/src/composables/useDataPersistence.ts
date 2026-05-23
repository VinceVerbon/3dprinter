import { ref } from 'vue'

const HELPER_OK = ref<boolean>(true)

function offlineKey(file: string) {
  return `offline:${file}`
}

function readOffline<T>(file: string): T | null {
  try {
    const raw = localStorage.getItem(offlineKey(file))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { data: T }
    return parsed.data ?? null
  } catch {
    return null
  }
}

/** If a prior save failed and is still parked in localStorage, push it to the
 *  helper now. Without this, any edit made while the helper was offline (e.g.
 *  deleting duplicate filaments) is silently lost on the next reload, because
 *  loadData reads the file — not localStorage. Returns the flushed data on
 *  success so the caller can use it instead of the now-stale file. */
async function flushOffline<T>(file: string): Promise<T | null> {
  const pending = readOffline<T>(file)
  if (pending == null) return null
  try {
    const r = await fetch('/api/save-data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, data: pending }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    localStorage.removeItem(offlineKey(file))
    HELPER_OK.value = true
    return pending
  } catch {
    HELPER_OK.value = false
    return null
  }
}

/** Load a JSON file from the helper's /data endpoint. Returns fallback if 404 or helper offline. */
export async function loadData<T>(file: string, fallback: T): Promise<T> {
  // Reconcile any offline edit first so a successful save that never reached
  // the file on the previous session isn't overwritten by the stale file.
  const flushed = await flushOffline<T>(file)
  if (flushed != null) return flushed
  try {
    const r = await fetch(`/data/${file}`, { headers: { accept: 'application/json' } })
    if (r.status === 404) return fallback
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    HELPER_OK.value = true
    return (await r.json()) as T
  } catch {
    HELPER_OK.value = false
    // Helper offline: prefer the last local edit over an empty fallback so the
    // user doesn't see their data vanish while the helper is down.
    const off = readOffline<T>(file)
    return off != null ? off : fallback
  }
}

/** Save JSON to data/<file>. Persists to localStorage as fallback when helper is offline. */
export async function saveData(file: string, data: unknown): Promise<{ ok: boolean; offlineFallback: boolean }> {
  try {
    const r = await fetch('/api/save-data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, data }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    HELPER_OK.value = true
    // A real save landed — drop any stale offline copy so a later reload
    // doesn't resurrect it.
    try { localStorage.removeItem(offlineKey(file)) } catch { /* ignore */ }
    return { ok: true, offlineFallback: false }
  } catch {
    HELPER_OK.value = false
    try { localStorage.setItem(offlineKey(file), JSON.stringify({ data, savedAt: new Date().toISOString() })) } catch { /* ignore */ }
    return { ok: false, offlineFallback: true }
  }
}

export function useHelperStatus() {
  return HELPER_OK
}
