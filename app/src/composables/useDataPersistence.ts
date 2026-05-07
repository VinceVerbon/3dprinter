import { ref } from 'vue'

const HELPER_OK = ref<boolean>(true)

/** Load a JSON file from the helper's /data endpoint. Returns fallback if 404 or helper offline. */
export async function loadData<T>(file: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(`/data/${file}`, { headers: { accept: 'application/json' } })
    if (r.status === 404) return fallback
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    HELPER_OK.value = true
    return (await r.json()) as T
  } catch {
    HELPER_OK.value = false
    return fallback
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
    return { ok: true, offlineFallback: false }
  } catch {
    HELPER_OK.value = false
    try { localStorage.setItem(`offline:${file}`, JSON.stringify({ data, savedAt: new Date().toISOString() })) } catch { /* ignore */ }
    return { ok: false, offlineFallback: true }
  }
}

export function useHelperStatus() {
  return HELPER_OK
}
