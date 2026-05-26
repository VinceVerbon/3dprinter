<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { usePrintersStore } from './stores/printers'
import { useSettingsStore } from './stores/settings'
import { useBackendGate } from './composables/useBackendGate'
import AddPrinterPrompt from './components/AddPrinterPrompt.vue'
import StaleStorePrompt from './components/StaleStorePrompt.vue'

// Gate the data UI on backend health. Until the helper answers /healthz we show
// a "connecting" screen (then an explicit retryable error) and auto-retry,
// rather than render empty/broken pages. No fail-open — the UI stays gated.
const { ready, stalled, retry } = useBackendGate()

let heartbeatTimer: number | null = null
async function beat() {
  try {
    await fetch('/api/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  } catch { /* helper not running yet — ignore */ }
}
// Browsers throttle/freeze the interval while the window is hidden, so beat
// immediately whenever it becomes visible again — keeps the standalone
// heartbeat watchdog satisfied the moment the user returns to the app.
function onVisible() {
  if (document.visibilityState === 'visible') beat()
}

// --- First-run "add a printer?" prompt -------------------------------------
const router = useRouter()
const printers = usePrintersStore()
const settings = useSettingsStore()
const dismissedThisSession = ref(false)

const showPrinterPrompt = computed(() =>
  printers.loaded && settings.loaded
  && printers.hasNone
  && !settings.settings.printer_prompt_dismissed
  && !dismissedThisSession.value,
)

function promptAdd() {
  dismissedThisSession.value = true
  router.push('/printers?add=1')
}
function promptLater() {
  dismissedThisSession.value = true
}
async function promptNever() {
  settings.settings.printer_prompt_dismissed = true
  dismissedThisSession.value = true
  await settings.save()
}

onMounted(() => {
  beat()
  heartbeatTimer = window.setInterval(beat, 15_000)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', beat)
})

// Load app-level data (incl. the first-run prompt inputs) only once the backend
// is reachable, and re-drive it whenever the backend comes back. Both loads are
// idempotent, so re-running on reconnect is safe.
watch(ready, (r) => {
  if (!r) return
  printers.load()
  settings.load()
}, { immediate: true })
onBeforeUnmount(() => {
  if (heartbeatTimer != null) window.clearInterval(heartbeatTimer)
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', beat)
})
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <!-- Backend not reachable yet: connecting → explicit retryable error. Never empty pages. -->
    <div v-if="!ready" class="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <img src="/app-icon-192.png" alt="Haspel" class="h-14 w-14 rounded-lg ring-1 ring-slate-700" />
      <template v-if="!stalled">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" aria-hidden="true"></div>
        <p class="text-sm text-slate-300">Starting Haspel…</p>
        <p class="max-w-sm text-xs text-slate-500">Connecting to the local helper.</p>
      </template>
      <template v-else>
        <p class="text-sm font-medium text-amber-300">Can't reach the local helper</p>
        <p class="max-w-sm text-xs text-slate-400">Haspel's background service isn't responding. It restarts itself automatically — still retrying every couple of seconds…</p>
        <button type="button" class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500" @click="retry">Retry now</button>
      </template>
    </div>

    <template v-else>
    <header class="border-b border-slate-800 px-6 py-4 flex items-center gap-4 print-hide">
      <img src="/app-icon-192.png" alt="Haspel" class="w-10 h-10 rounded-md ring-1 ring-slate-700 flex-none" />
      <div>
        <h1 class="text-xl font-semibold leading-tight">Haspel</h1>
        <p class="text-sm text-slate-400">3D printing supplies tracker</p>
      </div>
      <nav class="flex gap-4 text-sm ml-2">
        <RouterLink to="/filaments" class="hover:text-sky-400">Filaments</RouterLink>
        <RouterLink to="/accessories" class="hover:text-sky-400">Accessories</RouterLink>
        <RouterLink to="/shopping" class="hover:text-sky-400">Shopping</RouterLink>
        <RouterLink to="/empty-spools" class="hover:text-sky-400">Empty spools</RouterLink>
        <RouterLink to="/printers" class="hover:text-sky-400">Printers</RouterLink>
        <RouterLink to="/labels" class="hover:text-sky-400">Labels</RouterLink>
        <RouterLink to="/settings" class="hover:text-sky-400">Settings</RouterLink>
        <!-- Help embeds the bundled user guide (app/dist/docs) via an iframe on a
             dedicated route — works the same in the PWA and the Tauri webview. -->
        <RouterLink to="/help" class="hover:text-sky-400">Help</RouterLink>
      </nav>
    </header>
    <main class="p-6">
      <RouterView />
    </main>

    <AddPrinterPrompt
      v-if="showPrinterPrompt"
      @add="promptAdd"
      @later="promptLater"
      @never="promptNever"
    />

    <!-- Stale store-list prompt — appears route-independently when a brand
         store list is >30 days old and its notification is still active. -->
    <StaleStorePrompt />
    </template>
  </div>
</template>
