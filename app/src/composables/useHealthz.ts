import { ref } from 'vue'

export interface HealthzInfo {
  ok: boolean
  started_at: string
  last_heartbeat: string | null
  user_data_dir: string
  catalog_dir: string
  demo_dir: string
}

/** Fetch /healthz once. Returns a ref that is null until the request resolves
 *  (or stays null if the helper is unreachable). */
export function useHealthz() {
  const info = ref<HealthzInfo | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(true)

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const r = await fetch('/api/healthz', { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      info.value = (await r.json()) as HealthzInfo
    } catch (e) {
      error.value = (e as Error).message
      info.value = null
    } finally {
      loading.value = false
    }
  }

  refresh()
  return { info, error, loading, refresh }
}
