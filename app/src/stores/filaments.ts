import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Filament } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'filaments.json'

export const useFilamentsStore = defineStore('filaments', () => {
  const items = ref<Filament[]>([])
  const loaded = ref(false)
  const dirty = ref(false)

  async function load() {
    items.value = await loadData<Filament[]>(FILE, [])
    loaded.value = true
    dirty.value = false
  }

  function add(f: Filament) {
    items.value.push(f)
    dirty.value = true
  }
  function update(id: string, patch: Partial<Filament>) {
    const i = items.value.findIndex(x => x.id === id)
    if (i >= 0) {
      items.value[i] = { ...items.value[i], ...patch }
      dirty.value = true
    }
  }
  function remove(id: string) {
    items.value = items.value.filter(x => x.id !== id)
    dirty.value = true
  }

  async function save() {
    const r = await saveData(FILE, items.value)
    if (r.ok) dirty.value = false
    return r
  }

  const count = computed(() => items.value.length)

  return { items, loaded, dirty, count, load, add, update, remove, save }
})
