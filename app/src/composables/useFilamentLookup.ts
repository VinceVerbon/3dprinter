import { ref } from 'vue'
import type { FilamentAi } from '../types'

export function useFilamentLookup() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function lookup(brand: string, name: string, force = false): Promise<FilamentAi | null> {
    error.value = null
    loading.value = true
    try {
      const r = await fetch('/api/lookup-filament', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand, name, force }),
      })
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        throw new Error(`HTTP ${r.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
      }
      const json = (await r.json()) as { cached: boolean; result: FilamentAi }
      return json.result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      loading.value = false
    }
  }

  return { lookup, loading, error }
}
