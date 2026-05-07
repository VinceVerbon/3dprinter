import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import type { Plugin } from 'vite'

// Vite plugin: spawn the helper process alongside `npm run dev` and kill it on shutdown.
function helperPlugin(): Plugin {
  let child: ChildProcess | null = null
  const start = () => {
    if (child) return
    const helperPath = resolve(__dirname, '../helper/index.mjs')
    child = spawn(process.execPath, [helperPath], {
      stdio: 'inherit',
      env: { ...process.env, HELPER_PORT: '5174', VITE_PID: String(process.pid) },
    })
    child.on('exit', (code) => {
      // eslint-disable-next-line no-console
      console.log(`[helper] exited with code ${code}`)
      child = null
    })
  }
  const stop = () => {
    if (!child) return
    try { child.kill() } catch { /* noop */ }
    child = null
  }
  return {
    name: 'helper-plugin',
    apply: 'serve',
    configureServer(server) {
      start()
      server.httpServer?.once('close', stop)
    },
    closeBundle: stop,
  }
}

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    helperPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '3D Printer Supplies',
        short_name: '3DPrinter',
        description: 'Bambu Lab P2S supplies database',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5174', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
      '/data': { target: 'http://127.0.0.1:5174', changeOrigin: true },
    },
  },
  build: { target: 'es2022', outDir: 'dist' },
})
