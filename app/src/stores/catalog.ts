import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CatalogReplacementPart, CatalogConsumable, CatalogPrinter } from '../types'
import { loadData } from '../composables/useDataPersistence'

/**
 * Read-only seed catalog. Loaded from data/catalog/*.json on demand.
 * Edits go through PRs, not the helper.
 */
export const useCatalogStore = defineStore('catalog', () => {
  const parts = ref<CatalogReplacementPart[]>([])
  const consumables = ref<CatalogConsumable[]>([])
  const printers = ref<CatalogPrinter[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    const [p, c, pr] = await Promise.all([
      loadData<CatalogReplacementPart[]>('catalog/replacement-parts.json', []),
      loadData<CatalogConsumable[]>('catalog/consumables.json', []),
      loadData<CatalogPrinter[]>('catalog/printers.json', []),
    ])
    parts.value = p
    consumables.value = c
    printers.value = Array.isArray(pr) ? pr : []
    loaded.value = true
  }

  const partsByCategory = computed(() => {
    const m: Record<string, CatalogReplacementPart[]> = {}
    for (const p of parts.value) (m[p.category] ??= []).push(p)
    return m
  })
  const consumablesByCategory = computed(() => {
    const m: Record<string, CatalogConsumable[]> = {}
    for (const c of consumables.value) (m[c.category] ??= []).push(c)
    return m
  })

  return { parts, consumables, printers, loaded, partsByCategory, consumablesByCategory, load }
})
