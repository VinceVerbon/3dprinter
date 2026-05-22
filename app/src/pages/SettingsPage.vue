<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useHealthz } from '../composables/useHealthz'
import { Database, Sparkles, AlertTriangle } from 'lucide-vue-next'

const store = useSettingsStore()
const message = ref<string | null>(null)
onMounted(() => store.load())

async function persist() {
  const r = await store.save()
  message.value = r.ok ? 'Saved.' : (r.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
  setTimeout(() => (message.value = null), 4000)
}

// Healthz: where is user data stored?
const { info: healthz, error: healthzError } = useHealthz()

// Load demo data
const demoBusy = ref(false)
const demoMsg = ref<string | null>(null)
const demoOverwrite = ref(false)

async function loadDemo() {
  if (demoBusy.value) return
  demoBusy.value = true
  demoMsg.value = null
  try {
    const r = await fetch('/api/load-demo-data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overwrite: demoOverwrite.value }),
    })
    const body = await r.json()
    if (!r.ok || !body.ok) throw new Error(body.error || `HTTP ${r.status}`)
    const c = body.copied?.length ?? 0
    const s = body.skipped?.length ?? 0
    if (c === 0 && s > 0) {
      demoMsg.value = `Nothing copied — ${s} file(s) already populated. Tick "overwrite" and try again to replace them.`
    } else if (c === 0) {
      demoMsg.value = 'No demo files found.'
    } else {
      demoMsg.value = `Loaded ${c} demo file(s)${s > 0 ? `, skipped ${s}` : ''}. Refresh the pages to see them.`
    }
  } catch (e) {
    demoMsg.value = `Failed: ${(e as Error).message}`
  } finally {
    demoBusy.value = false
  }
}
</script>

<template>
  <section class="max-w-2xl grid gap-6">
    <h2 class="text-lg font-semibold">Settings</h2>

    <!-- Existing app settings -->
    <div class="grid gap-4">
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">Default filament brand</span>
        <input
          v-model="store.settings.default_filament_brand"
          @blur="persist"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 max-w-md"
        />
      </label>

      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">AI model (for filament Lookup AI)</span>
        <select
          v-model="store.settings.ai_model"
          @change="persist"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 max-w-md"
        >
          <option value="claude-sonnet-4-6">Sonnet 4.6 (default — fast, good)</option>
          <option value="claude-opus-4-7">Opus 4.7 (smartest, slower)</option>
          <option value="claude-haiku-4-5">Haiku 4.5 (fastest, cheapest)</option>
        </select>
        <span class="text-xs text-slate-500 max-w-md">
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
    </div>

    <!-- Data section -->
    <div class="grid gap-3 border-t border-slate-800 pt-6">
      <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-2">
        <Database :size="16" /> Data
      </h3>

      <div class="text-xs text-slate-400 grid gap-1">
        <p>Your inventory (filaments, accessories, shopping list, empty spools) is stored locally per install at:</p>
        <code v-if="healthz" class="block bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 break-all">{{ healthz.user_data_dir }}</code>
        <code v-else-if="healthzError" class="block bg-slate-950 border border-red-900/50 rounded px-2 py-1 text-red-300">helper unreachable — {{ healthzError }}</code>
        <code v-else class="block bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-500">loading…</code>
        <p class="text-slate-500">
          The catalog of P2S replacement parts and consumables is shipped with the app at
          <code v-if="healthz" class="text-slate-400">{{ healthz.catalog_dir }}</code>
          and is read-only.
        </p>
      </div>

      <div class="grid gap-2 border border-slate-800 rounded p-3 bg-slate-900/30">
        <div class="flex items-center gap-2 text-sm font-medium text-slate-200">
          <Sparkles :size="14" class="text-amber-300" />
          Load demo data
        </div>
        <p class="text-xs text-slate-400">
          Populate your inventory with a small handful of example filaments + an accessory so you can explore the UI.
          Skipped for any file you've already populated — safe to click on a fresh install.
        </p>
        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" v-model="demoOverwrite" class="accent-amber-500" />
          <AlertTriangle :size="12" class="text-amber-400" />
          Also overwrite files I've already populated
        </label>
        <div class="flex items-center gap-3">
          <button
            @click="loadDemo"
            :disabled="demoBusy || !healthz"
            class="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ demoBusy ? 'Loading…' : 'Load demo data' }}
          </button>
          <span v-if="demoMsg" class="text-xs text-slate-400">{{ demoMsg }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
