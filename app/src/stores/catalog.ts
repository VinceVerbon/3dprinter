import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CatalogPrinter } from '../types'
import { loadData } from '../composables/useDataPersistence'

/**
 * Read-only seed catalog. Only the printer catalog is loaded from data/ now.
 * Replacement parts and consumables have moved to on-demand per-brand store
 * lists (see storeLists store + useStoreFetch composable).
 */
export const useCatalogStore = defineStore('catalog', () => {
  const printers = ref<CatalogPrinter[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    const pr = await loadData<CatalogPrinter[]>('catalog/printers.json', [])
    printers.value = Array.isArray(pr) ? pr : []
    loaded.value = true
  }

  return { printers, loaded, load }
})
