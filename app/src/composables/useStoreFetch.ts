import { ref } from 'vue'
import { useStoreListsStore } from '../stores/storeLists'
import type { StoreList } from '../types'

// Client for the helper's on-demand store fetch. INTENTIONAL ONLY — never call
// this automatically (no auto-refresh); it costs AI tokens + bandwidth. Triggered
// by the user (Shopping "Update store" button, or "Yes" on the staleness prompt).
//
// Contract — POST /api/fetch-store
//   request:  { brand: string, store_url?: string, force?: boolean }
//   response: { ok: true, list: StoreList } | { ok: false, error: string }
// The helper fetches the brand store from THIS machine (residential IP) and
// AI-extracts items to the StoreList shape. Bambu is the proven path; other
// brands are best-effort and may return ok:false ("couldn't fetch — add manually").

export function useStoreFetch() {
  const store = useStoreListsStore()
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchStore(brand: string, storeUrl?: string, force = false): Promise<StoreList | null> {
    if (loading.value) return null
    loading.value = true
    error.value = null
    try {
      const r = await fetch('/api/fetch-store', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand, store_url: storeUrl, force }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body?.ok) throw new Error(body?.error || `HTTP ${r.status}`)
      store.upsert(body.list as StoreList)
      await store.save()
      return body.list as StoreList
    } catch (e) {
      error.value = (e as Error).message
      return null
    } finally {
      loading.value = false
    }
  }

  return { fetchStore, loading, error }
}
