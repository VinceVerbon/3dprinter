import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'settings.json'
const DEFAULT: AppSettings = {
  default_filament_brand: 'Bambu Lab',
  ai_provider: 'claude-cli',
  anthropic_api_key: '',
  openai_api_key: '',
  gemini_api_key: '',
  openrouter_api_key: '',
  ai_model: 'claude-sonnet-4-6',
  ai_models: {
    enrichment: 'claude-sonnet-4-6',
    swatch: 'claude-sonnet-4-6',
    order_import: 'claude-sonnet-4-6',
  },
  ai_lookup_enabled: true,
  notifications: { disabled: [], snoozed: {} },
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
