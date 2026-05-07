import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ShoppingItem } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'shopping.json'

export const useShoppingStore = defineStore('shopping', () => {
  const items = ref<ShoppingItem[]>([])
  const loaded = ref(false)
  const dirty = ref(false)

  async function load() {
    items.value = await loadData<ShoppingItem[]>(FILE, [])
    loaded.value = true
    dirty.value = false
  }

  function add(item: ShoppingItem) {
    items.value.push(item)
    dirty.value = true
  }
  function update(id: string, patch: Partial<ShoppingItem>) {
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
  function toggleDone(id: string) {
    const i = items.value.findIndex(x => x.id === id)
    if (i >= 0) {
      items.value[i] = { ...items.value[i], done: !items.value[i].done }
      dirty.value = true
    }
  }
  function clearDone() {
    const before = items.value.length
    items.value = items.value.filter(x => !x.done)
    if (items.value.length !== before) dirty.value = true
  }

  async function save() {
    const r = await saveData(FILE, items.value)
    if (r.ok) dirty.value = false
    return r
  }

  const open = computed(() => items.value.filter(x => !x.done))
  const done = computed(() => items.value.filter(x => x.done))

  return { items, loaded, dirty, open, done, load, add, update, remove, toggleDone, clearDone, save }
})
