import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const HELPER_ENTRY = path.join(PROJECT_ROOT, 'helper', 'index.mjs')
const HELPER_HOST = '127.0.0.1'
// Ports are env-overridable so a side-by-side clean-test instance
// (scripts/test-clean.ps1) can run on 5273/5274 without colliding with the
// real dev/app instance on 5173/5174. Defaults preserve normal behaviour.
const VITE_PORT = parseInt(process.env.VITE_PORT || '5173', 10)
const HELPER_PORT = parseInt(process.env.HELPER_PORT || '5174', 10)

// Spawns the helper service as a child of `vite` in dev mode, passing
// VITE_PID so the helper can kill Vite when its own heartbeat watchdog
// fires (i.e. when the PWA window closes). Reverse direction: when Vite
// exits, kill the helper child so it doesn't linger for ~45s waiting on
// heartbeats that will never come.
function helperPlugin(): Plugin {
  let child: ChildProcess | null = null
  let stopping = false

  const stop = () => {
    if (stopping) return
    stopping = true
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* child may already be gone — ignore */
      }
    }
  }

  return {
    name: '3dprinter-helper',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      if (child) return

      child = spawn(process.execPath, [HELPER_ENTRY], {
        stdio: 'inherit',
        env: {
          ...process.env,
          HELPER_PORT: String(HELPER_PORT),
          VITE_PID: String(process.pid),
        },
      })

      child.on('exit', (code, signal) => {
        const reason = signal ?? (code != null ? `code ${code}` : 'unknown')
        server.config.logger.info(`[helper] exited (${reason})`, { timestamp: true })
        child = null
      })

      child.on('error', (err) => {
        server.config.logger.error(`[helper] spawn failed: ${err.message}`, { timestamp: true })
        child = null
      })

      // Vite shutdown paths.
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    },
    closeBundle: stop,
  }
}

const helperTarget = `http://${HELPER_HOST}:${HELPER_PORT}`

// Shared proxy: route /api → helper (stripping the prefix) and /data → helper.
// Used by both the dev server and `vite preview` (the clean-test harness serves
// the production build via preview and still needs the helper reachable).
const helperProxy = {
  '/api': {
    target: helperTarget,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api/, ''),
  },
  '/data': {
    target: helperTarget,
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    helperPlugin(),
    VitePWA({
      // A precaching service worker is actively harmful inside the packaged
      // WebView2 desktop app: it served a STALE app shell after updates (the
      // "needs Ctrl+F5" bug) and could intercept /api calls. The assets are
      // already local in both the desktop build and a LAN browser tab, so the
      // SW buys nothing here. `selfDestroying` ships a worker that UNREGISTERS
      // itself and purges old caches — so existing installs that still carry the
      // bad SW heal themselves on next load, and no new caching SW is shipped.
      selfDestroying: true,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'app-icon.jpg', 'app-icon-192.png', 'app-icon-512.png'],
      workbox: {
        // The user guide (app/dist/docs/*) is generated AFTER vite build, so it
        // isn't in the precache manifest. Without this, the SW's navigateFallback
        // would serve index.html (the SPA) for a /docs/ navigation instead of the
        // manual. Let /docs/ requests pass straight through to the bundled file.
        navigateFallbackDenylist: [/^\/docs\//i],
      },
      manifest: {
        name: 'Haspel — 3D Printer Supplies',
        short_name: 'Haspel',
        description: '3D printing supplies tracker (filaments, accessories, spools, shopping list)',
        theme_color: '#3730a3',
        background_color: '#3730a3',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    // Bind explicitly to IPv4 loopback. On Windows, 'localhost' often resolves
    // to ::1 first, leaving 127.0.0.1 unbound and breaking start.ps1's health
    // probe and Edge --app=http://127.0.0.1:5173/. Keeping it on 127.0.0.1
    // matches the helper's bind address.
    host: '127.0.0.1',
    port: VITE_PORT,
    strictPort: true,
    proxy: helperProxy,
  },
  // `vite preview` serves the built app/dist. The clean-test harness
  // (scripts/test-clean.ps1) runs it on VITE_PORT=5273 → HELPER_PORT=5274.
  preview: {
    host: '127.0.0.1',
    port: VITE_PORT,
    strictPort: true,
    proxy: helperProxy,
  },
  build: { target: 'es2022', outDir: 'dist' },
})
