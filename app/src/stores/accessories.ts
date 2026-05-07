import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Accessory } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'accessories.json'

export const useAccessoriesStore = defineStore('accessories', () => {
  const items = ref<Accessory[]>([])
  const loaded = ref(false)
  const dirty = ref(false)

  async function load() {
    items.value = await loadData<Accessory[]>(FILE, [])
    loaded.value = true
    dirty.value = false
  }

  function add(a: Accessory) {
    items.value.push(a)
    dirty.value = true
  }
  function update(id: string, patch: Partial<Accessory>) {
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
  const byCategory = computed(() => {
    const m: Record<string, Accessory[]> = {}
    for (const a of items.value) {
      ;(m[a.category] ??= []).push(a)
    }
    return m
  })

  return { items, loaded, dirty, count, byCategory, load, add, update, remove, save }
})
