<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'

const store = useSettingsStore()
const message = ref<string | null>(null)
onMounted(() => store.load())

async function persist() {
  const r = await store.save()
  message.value = r.ok ? 'Saved.' : (r.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
  setTimeout(() => (message.value = null), 4000)
}
</script>

<template>
  <section class="max-w-md grid gap-4">
    <h2 class="text-lg font-semibold">Settings</h2>

    <label class="grid gap-1 text-sm">
      <span class="text-slate-400">Default filament brand</span>
      <input
        v-model="store.settings.default_filament_brand"
        @blur="persist"
        class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
      />
    </label>

    <label class="grid gap-1 text-sm">
      <span class="text-slate-400">AI model (for filament Lookup AI)</span>
      <select
        v-model="store.settings.ai_model"
        @change="persist"
        class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
      >
        <option value="claude-sonnet-4-6">Sonnet 4.6 (default — fast, good)</option>
        <option value="claude-opus-4-7">Opus 4.7 (smartest, slower)</option>
        <option value="claude-haiku-4-5">Haiku 4.5 (fastest, cheapest)</option>
      </select>
      <span class="text-xs text-slate-500">
        Note: model selection here is informational; the helper currently uses
        <code>claude-sonnet-4-6</code>. Wire-up lands when the helper supports the
        <code>model</code> field on <code>POST /lookup-filament</code>.
      </span>
    </label>

    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" v-model="store.settings.ai_lookup_enabled" @change="persist" />
      <span class="text-slate-300">Enable AI lookup button on filament form</span>
    </label>

    <p v-if="message" class="text-xs text-slate-400">{{ message }}</p>
  </section>
</template>
