import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EmptySpoolsState } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'empty-spools.json'
const DEFAULT: EmptySpoolsState = { count: 0, byType: {} }

export const useEmptySpoolsStore = defineStore('emptySpools', () => {
  const state = ref<EmptySpoolsState>({ ...DEFAULT })
  const loaded = ref(false)

  async function load() {
    state.value = await loadData<EmptySpoolsState>(FILE, DEFAULT)
    loaded.value = true
  }
  function increment(type?: string) {
    state.value.count = (state.value.count ?? 0) + 1
    if (type) state.value.byType[type] = (state.value.byType[type] ?? 0) + 1
  }
  function decrement(type?: string) {
    state.value.count = Math.max(0, (state.value.count ?? 0) - 1)
    if (type && state.value.byType[type]) {
      state.value.byType[type] = Math.max(0, state.value.byType[type] - 1)
      if (state.value.byType[type] === 0) delete state.value.byType[type]
    }
  }
  async function save() { return saveData(FILE, state.value) }
  return { state, loaded, load, increment, decrement, save }
})
