import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Filament, ArchivedFilament } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'filament-history.json'

// Plain-object clone (Vue reactive proxies don't survive structuredClone).
function cloneJson<T>(v: T): T { return JSON.parse(JSON.stringify(v)) }

/** History of filaments removed from active inventory. Newest first. Lets the
 *  user revisit an earlier-used filament, restore it, or hard-delete it. */
export const useFilamentHistoryStore = defineStore('filamentHistory', () => {
  const items = ref<ArchivedFilament[]>([])
  const loaded = ref(false)

  async function load() {
    const data = await loadData<ArchivedFilament[]>(FILE, [])
    items.value = Array.isArray(data) ? data : []   // tolerate a null/empty seed
    loaded.value = true
  }

  /** Archive a removed filament (in memory — caller persists via save()). */
  function archive(f: Filament) {
    items.value.unshift({ ...cloneJson(f), removed_at: new Date().toISOString() })
  }

  /** Pull an entry out of history and return it as a plain Filament (removed_at
   *  stripped) for re-insertion into active inventory. Returns null if missing. */
  function takeForRestore(entry: ArchivedFilament): Filament | null {
    const i = items.value.indexOf(entry)
    if (i < 0) return null
    items.value.splice(i, 1)
    const { removed_at: _removed_at, ...filament } = cloneJson(entry)
    return filament as Filament
  }

  /** Permanently delete a single history entry. */
  function forget(entry: ArchivedFilament) {
    const i = items.value.indexOf(entry)
    if (i >= 0) items.value.splice(i, 1)
  }

  /** Permanently delete the entire history. */
  function clear() { items.value = [] }

  async function save() { return saveData(FILE, items.value) }

  const count = computed(() => items.value.length)

  return { items, loaded, count, load, archive, takeForRestore, forget, clear, save }
})
