import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { StoreList } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

// Per-brand store contents, fetched ON DEMAND (never preloaded). Persisted
// per-install at store-lists.json. `fetched_at` on each list drives the
// >30-day staleness prompt (see useNotifications + the StaleStorePrompt UI).
const FILE = 'store-lists.json'
export const STALE_DAYS = 30

function brandKey(brand: string): string {
  return brand.trim().toLowerCase()
}

export const useStoreListsStore = defineStore('storeLists', () => {
  const lists = ref<StoreList[]>([])
  const loaded = ref(false)

  async function load() {
    lists.value = await loadData<StoreList[]>(FILE, [])
    loaded.value = true
  }
  async function save() {
    return saveData(FILE, lists.value)
  }

  function get(brand: string): StoreList | undefined {
    return lists.value.find((l) => brandKey(l.brand) === brandKey(brand))
  }

  /** Insert or replace the list for a brand (matched case-insensitively). */
  function upsert(list: StoreList) {
    const i = lists.value.findIndex((l) => brandKey(l.brand) === brandKey(list.brand))
    if (i >= 0) lists.value[i] = list
    else lists.value.push(list)
  }

  function remove(brand: string) {
    lists.value = lists.value.filter((l) => brandKey(l.brand) !== brandKey(brand))
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

  const brands = computed(() => lists.value.map((l) => l.brand))
  const count = computed(() => lists.value.length)
  /** Lists past the staleness threshold — candidates for an "update?" prompt. */
  const stale = computed(() => lists.value.filter((l) => isStale(l)))

  return { lists, loaded, load, save, get, upsert, remove, ageDays, isStale, brands, count, stale }
})
