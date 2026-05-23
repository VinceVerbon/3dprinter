<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useHealthz } from '../composables/useHealthz'
import { Database, Sparkles, AlertTriangle, Bot, CheckCircle2, XCircle } from 'lucide-vue-next'
import type { AiProvider, AiTask } from '../types'

const store = useSettingsStore()
const message = ref<string | null>(null)
onMounted(() => store.load())

async function persist() {
  const r = await store.save()
  message.value = r.ok ? 'Saved.' : (r.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
  setTimeout(() => (message.value = null), 4000)
}

// --- AI provider config ---
const CLAUDE_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (default — fast, good)' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7 (smartest, slower)' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5 (fastest, cheapest)' },
]
const AI_TASKS: { key: AiTask; label: string }[] = [
  { key: 'enrichment', label: 'Filament enrichment (Lookup AI)' },
  { key: 'swatch', label: 'Swatch / colour resolution' },
  { key: 'order_import', label: 'Order PDF import' },
]
const PROVIDER_DEFAULT_MODEL: Record<AiProvider, string> = {
  'claude-cli': 'claude-sonnet-4-6',
  'anthropic-api': 'claude-sonnet-4-6',
  'openai-api': 'gpt-4o',
  'gemini-api': 'gemini-2.0-flash',
  'openrouter-api': 'openai/gpt-4o',
  'none': 'claude-sonnet-4-6',
}
const KEY_FIELD: Partial<Record<AiProvider, string>> = {
  'anthropic-api': 'anthropic_api_key',
  'openai-api': 'openai_api_key',
  'gemini-api': 'gemini_api_key',
  'openrouter-api': 'openrouter_api_key',
}
const KEY_PLACEHOLDER: Partial<Record<AiProvider, string>> = {
  'anthropic-api': 'sk-ant-...',
  'openai-api': 'sk-...',
  'gemini-api': 'AIza...',
  'openrouter-api': 'sk-or-...',
}

const provider = computed<AiProvider>({
  get: () => store.settings.ai_provider ?? 'claude-cli',
  set: (v) => { store.settings.ai_provider = v },
})
// Claude backends get a curated model dropdown; the others vary too much, so a
// free-text field with the provider default as placeholder.
const usesClaudeModels = computed(() => provider.value === 'claude-cli' || provider.value === 'anthropic-api')
const keyField = computed(() => KEY_FIELD[provider.value])
const apiKey = computed<string>({
  get: () => { const f = keyField.value; return f ? (((store.settings as Record<string, unknown>)[f] as string) ?? '') : '' },
  set: (v) => { const f = keyField.value; if (f) (store.settings as Record<string, unknown>)[f] = v },
})

// What to show in the per-task model field. Hide a leftover model from a
// different provider family rather than displaying e.g. a Claude id under OpenAI.
function modelFor(task: AiTask): string {
  const v = store.settings.ai_models?.[task] ?? ''
  if (usesClaudeModels.value) {
    return v.startsWith('claude') ? v : (store.settings.ai_model ?? 'claude-sonnet-4-6')
  }
  return v && !v.startsWith('claude') ? v : ''
}
function setModelFor(task: AiTask, value: string) {
  if (!store.settings.ai_models) store.settings.ai_models = {}
  store.settings.ai_models[task] = value
  persist()
}

const testing = ref(false)
const testResult = ref<{ ok: boolean; detail: string } | null>(null)

async function testConnection() {
  if (testing.value) return
  testing.value = true
  testResult.value = null
  try {
    const r = await fetch('/api/ai-selftest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: provider.value,
        model: modelFor('enrichment') || PROVIDER_DEFAULT_MODEL[provider.value],
        // Pass the in-form key so the user can test before saving.
        api_key: keyField.value ? apiKey.value : undefined,
      }),
    })
    const body = await r.json().catch(() => null)
    testResult.value = body && typeof body.ok === 'boolean'
      ? { ok: body.ok, detail: body.detail ?? '' }
      : { ok: false, detail: `HTTP ${r.status}` }
  } catch (e) {
    testResult.value = { ok: false, detail: (e as Error).message }
  } finally {
    testing.value = false
  }
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

      <p v-if="message" class="text-xs text-slate-400">{{ message }}</p>
    </div>

    <!-- AI provider section -->
    <div class="grid gap-4 border-t border-slate-800 pt-6">
      <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-2">
        <Bot :size="16" /> AI provider
      </h3>

      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">Backend</span>
        <select
          v-model="provider"
          @change="persist"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 max-w-md"
        >
          <option value="claude-cli">Claude CLI (default — uses your local Claude subscription, no key)</option>
          <option value="anthropic-api">Anthropic API key (bring your own key, billed per use)</option>
          <option value="openai-api">OpenAI API key</option>
          <option value="gemini-api">Google Gemini API key</option>
          <option value="openrouter-api">OpenRouter API key</option>
          <option value="none">None — manual entry only (no AI lookups)</option>
        </select>
        <span class="text-xs text-slate-500 max-w-md">
          <template v-if="provider === 'claude-cli'">Requires the <code>claude</code> CLI installed and logged in (<code>claude /login</code>). Uses your Pro/Max quota; nothing is stored.</template>
          <template v-else-if="provider === 'none'">All AI buttons are hidden. You can still enter every field by hand and pick swatches manually.</template>
          <template v-else>Calls the provider's REST API directly. The key is stored locally in your settings file only — never committed.</template>
        </span>
      </label>

      <label v-if="keyField" class="grid gap-1 text-sm">
        <span class="text-slate-400">API key</span>
        <input
          v-model="apiKey"
          @blur="persist"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :placeholder="KEY_PLACEHOLDER[provider] ?? ''"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 max-w-md font-mono"
        />
        <span class="text-xs text-slate-500">
          Stored only in your local settings file. The matching environment variable
          (<code v-if="provider === 'anthropic-api'">ANTHROPIC_API_KEY</code><code v-else-if="provider === 'openai-api'">OPENAI_API_KEY</code><code v-else-if="provider === 'gemini-api'">GEMINI_API_KEY</code><code v-else-if="provider === 'openrouter-api'">OPENROUTER_API_KEY</code>) takes precedence.
        </span>
      </label>

      <div v-if="provider !== 'none'" class="grid gap-2">
        <span class="text-sm text-slate-400">Model per task</span>
        <label v-for="t in AI_TASKS" :key="t.key" class="grid grid-cols-[1fr_auto] items-center gap-2 text-sm max-w-md">
          <span class="text-slate-300">{{ t.label }}</span>
          <select
            v-if="usesClaudeModels"
            :value="modelFor(t.key)"
            @change="setModelFor(t.key, ($event.target as HTMLSelectElement).value)"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            <option v-for="m in CLAUDE_MODEL_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
          <input
            v-else
            :value="modelFor(t.key)"
            @change="setModelFor(t.key, ($event.target as HTMLInputElement).value)"
            :placeholder="PROVIDER_DEFAULT_MODEL[provider]"
            spellcheck="false"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono w-56"
          />
        </label>
        <span class="text-xs text-slate-500 max-w-md">
          <template v-if="provider === 'claude-cli'">Swatch &amp; order-import use the CLI's WebFetch for higher-confidence colours.</template>
          <template v-else>Swatch &amp; order-import run without live web access on API providers (training knowledge only). Order-import sends the PDF to the model; the model you pick must support PDF/vision input.</template>
        </span>
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" v-model="store.settings.ai_lookup_enabled" @change="persist" />
        <span class="text-slate-300">Show AI lookup buttons (filament form &amp; detail)</span>
      </label>

      <div class="flex items-center gap-3">
        <button
          @click="testConnection"
          :disabled="testing"
          class="px-3 py-1.5 text-sm rounded bg-violet-700/50 border border-violet-600/60 text-violet-100 hover:bg-violet-700/70 disabled:opacity-50"
        >
          {{ testing ? 'Testing…' : 'Test connection' }}
        </button>
        <span v-if="testResult" class="flex items-center gap-1.5 text-xs" :class="testResult.ok ? 'text-emerald-400' : 'text-red-400'">
          <CheckCircle2 v-if="testResult.ok" :size="14" />
          <XCircle v-else :size="14" />
          {{ testResult.detail }}
        </span>
      </div>
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
