import { ref } from 'vue'
import type { Effect } from '../types'

export type SwatchLookupInput = {
  brand: string
  name: string
  variant?: string
  sku?: string
  color_code?: string
  product_url?: string
  force?: boolean
}

export type SwatchLookupResult = {
  hex: string | null
  stops: string[]
  effects: Effect[]
  source: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  notes?: string
}

const VALID_EFFECTS: Effect[] = ['matte','silk','sparkle','marble','metallic','glow','multicolor','translucent','transparent']

export function useSwatchLookup() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function lookup(input: SwatchLookupInput): Promise<SwatchLookupResult | null> {
    error.value = null
    loading.value = true
    try {
      const r = await fetch('/api/lookup-swatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        throw new Error(`HTTP ${r.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
      }
      const json = (await r.json()) as { ok: boolean; cached: boolean; result: Partial<SwatchLookupResult> }
      if (!json.ok || !json.result || !json.result.hex) return null
      return {
        hex: json.result.hex,
        stops: Array.isArray(json.result.stops) && json.result.stops.length > 0
          ? json.result.stops
          : [json.result.hex],
        effects: ((json.result.effects ?? []).filter((e): e is Effect => VALID_EFFECTS.includes(e as Effect))),
        source: typeof json.result.source === 'string' ? json.result.source : 'ai',
        confidence: (['high','medium','low','none'].includes(json.result.confidence as string)
          ? json.result.confidence
          : 'low') as SwatchLookupResult['confidence'],
        notes: json.result.notes,
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      loading.value = false
    }
  }

  return { lookup, loading, error }
}
