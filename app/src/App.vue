<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePrintersStore } from './stores/printers'
import { useSettingsStore } from './stores/settings'
import AddPrinterPrompt from './components/AddPrinterPrompt.vue'
import StaleStorePrompt from './components/StaleStorePrompt.vue'

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
  // Drive the first-run prompt — needs printers + settings loaded.
  printers.load()
  settings.load()
})
onBeforeUnmount(() => {
  if (heartbeatTimer != null) window.clearInterval(heartbeatTimer)
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', beat)
})
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
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
  </div>
</template>
