import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { isTauri, apiBase } from './lib/apiBase'

// Under Tauri there is no Vite dev-proxy, so rewrite same-origin helper calls
// ('/api/...', '/data/...') to the sidecar's absolute address. No-op in
// dev/web (relative paths stay relative and Vite proxies them) — this keeps the
// existing fetch('/api'|'/data') call sites unchanged. All our call sites pass
// a string path, so only the string case needs rewriting.
if (isTauri()) {
  const base = apiBase()
  const nativeFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && (input.startsWith('/api') || input.startsWith('/data'))) {
      return nativeFetch(base + input, init)
    }
    return nativeFetch(input, init)
  }) as typeof window.fetch
}

createApp(App).use(createPinia()).use(router).mount('#app')
