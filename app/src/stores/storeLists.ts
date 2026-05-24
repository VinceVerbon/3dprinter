import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { StoreList } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

// Per-brand store contents, fetched ON DEMAND (never preloaded). Persisted
// per-install at store-lists.json. `fetched_at` on each list drives the
// >30-day staleness prompt (see useNotifications + the StaleStorePrompt UI).
const FILE = 'store-lists.json'
export const STALE_DAYS = 30

// Lists are keyed per make+model (a P2S list differs from a P1S list). Falls
// back to brand-only when a model isn't given.
function listKey(brand: string, model?: string | null): string {
  return `${brand.trim().toLowerCase()}|${(model ?? '').trim().toLowerCase()}`
}

export const useStoreListsStore = defineStore('storeLists', () => {
  const lists = ref<StoreList[]>([])
  const loaded = ref(false)

  async function load() {
    const data = await loadData<StoreList[]>(FILE, [])
    // Guard against a malformed/corrupt file: a non-array would make every
    // .find/.map/.filter below throw and blank the page. Degrade to empty.
    lists.value = Array.isArray(data) ? data : []
    loaded.value = true
  }
  async function save() {
    return saveData(FILE, lists.value)
  }

  function get(brand: string, model?: string | null): StoreList | undefined {
    return lists.value.find((l) => listKey(l.brand, l.model) === listKey(brand, model))
  }

  /** Insert or replace the list for a make+model (matched case-insensitively). */
  function upsert(list: StoreList) {
    const i = lists.value.findIndex((l) => listKey(l.brand, l.model) === listKey(list.brand, list.model))
    if (i >= 0) lists.value[i] = list
    else lists.value.push(list)
  }

  function remove(brand: string, model?: string | null) {
    lists.value = lists.value.filter((l) => listKey(l.brand, l.model) !== listKey(brand, model))
  }

  /** Age of a list in days; Infinity if it has no/invalid timestamp. */
  function ageDays(list: StoreList): number {
    const t = Date.parse(list.fetched_at)
    if (Number.isNaN(t)) return Infinity
    return (Date.now() - t) / 86_400_000
  }
  function isStale(list: StoreList, days = STALE_DAYS): boolean {
    return ageDays(list) > days
  }

  const brands = computed(() => [...new Set(lists.value.map((l) => l.brand))])
  const count = computed(() => lists.value.length)
  /** Lists past the staleness threshold — candidates for an "update?" prompt. */
  const stale = computed(() => lists.value.filter((l) => isStale(l)))

  return { lists, loaded, load, save, get, upsert, remove, ageDays, isStale, brands, count, stale }
})
