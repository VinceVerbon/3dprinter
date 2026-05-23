import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '../stores/settings'
import type { AiProvider } from '../types'

/** Shared read of the AI provider config. Loads the settings store once (it's a
 *  Pinia singleton) so any component can gate its AI affordances without each
 *  one re-fetching settings.json. */
export function useAiSettings() {
  const store = useSettingsStore()
  if (!store.loaded) void store.load()
  const { settings } = storeToRefs(store)
  const provider = computed<AiProvider>(() => settings.value.ai_provider ?? 'claude-cli')
  const aiEnabled = computed(() => provider.value !== 'none' && settings.value.ai_lookup_enabled !== false)
  return { provider, aiEnabled, settings }
}
