<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'

let heartbeatTimer: number | null = null
async function beat() {
  try {
    await fetch('/api/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  } catch { /* helper not running yet — ignore */ }
}
onMounted(() => {
  beat()
  heartbeatTimer = window.setInterval(beat, 15_000)
})
onBeforeUnmount(() => {
  if (heartbeatTimer != null) window.clearInterval(heartbeatTimer)
})
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <header class="border-b border-slate-800 px-6 py-4 flex items-baseline gap-6">
      <div>
        <h1 class="text-xl font-semibold">3D Printer Supplies</h1>
        <p class="text-sm text-slate-400">Bambu Lab P2S Combo &middot; AMS 2 Pro</p>
      </div>
      <nav class="flex gap-4 text-sm">
        <RouterLink to="/filaments" class="hover:text-sky-400">Filaments</RouterLink>
        <RouterLink to="/accessories" class="hover:text-sky-400">Accessories</RouterLink>
        <RouterLink to="/shopping" class="hover:text-sky-400">Shopping</RouterLink>
        <RouterLink to="/empty-spools" class="hover:text-sky-400">Empty spools</RouterLink>
        <RouterLink to="/settings" class="hover:text-sky-400">Settings</RouterLink>
      </nav>
    </header>
    <main class="p-6">
      <RouterView />
    </main>
  </div>
</template>
