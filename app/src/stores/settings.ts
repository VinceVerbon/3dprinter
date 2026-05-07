import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'settings.json'
const DEFAULT: AppSettings = {
  default_filament_brand: 'Bambu Lab',
  ai_model: 'claude-sonnet-4-6',
  ai_lookup_enabled: true,
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULT })
  const loaded = ref(false)

  async function load() {
    settings.value = { ...DEFAULT, ...(await loadData<AppSettings>(FILE, DEFAULT)) }
    loaded.value = true
  }
  async function save() {
    return saveData(FILE, settings.value)
  }
  return { settings, loaded, load, save }
})
