<script setup lang="ts">
// The user guide is the static HTML bundled at /docs/Haspel-User-Guide.html
// (generated from docs/user-guide/*.md at build time). Embedding it in an iframe
// works identically in the browser/PWA and inside the Tauri webview — both serve
// it as a same-origin asset — and keeps the app nav visible so there's always a
// way back (a standalone PWA window has no browser back button). The PWA service
// worker is told not to fall back to index.html for /docs/ (see vite.config.ts).
const manualUrl = '/docs/Haspel-User-Guide.html'
</script>

<template>
  <section class="max-w-5xl">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold">Help — User Guide</h2>
      <a
        :href="manualUrl"
        target="_blank"
        rel="noopener"
        class="text-sm text-sky-400 hover:underline"
      >Open in new tab ↗</a>
    </div>
    <iframe
      :src="manualUrl"
      title="Haspel User Guide"
      class="w-full rounded-lg border border-slate-800 bg-white"
      style="height: calc(100vh - 11rem)"
    />
  </section>
</template>
