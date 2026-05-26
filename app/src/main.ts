import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { isTauri, apiBase } from './lib/apiBase'

// Under Tauri there is no Vite dev-proxy, so rewrite same-origin helper calls
// ('/api/...', '/data/...') to the sidecar's absolute address. CRUCIAL: the
// helper's routes are BARE ('/healthz', '/heartbeat', '/save-data', …) — the
// '/api' prefix is a frontend convention that the Vite dev-proxy STRIPS
// (rewrite: ^/api -> ''). So we must strip '/api' here too, otherwise every
// '/api/*' call hits the helper as '/api/*' and 404s (which silently broke
// heartbeat, save-data, lookups and the health probe in the packaged app).
// '/data/*' is served as-is by the helper, so it is only prefixed.
if (isTauri()) {
  const base = apiBase()
  const nativeFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      if (input.startsWith('/api/')) return nativeFetch(base + input.slice(4), init) // '/api/healthz' -> ORIGIN/healthz
      if (input.startsWith('/data/')) return nativeFetch(base + input, init)          // '/data/x'      -> ORIGIN/data/x
    }
    return nativeFetch(input, init)
  }) as typeof window.fetch
}

createApp(App).use(createPinia()).use(router).mount('#app')
