import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const HELPER_ENTRY = path.join(PROJECT_ROOT, 'helper', 'index.mjs')
const HELPER_HOST = '127.0.0.1'
const HELPER_PORT = 5174

// Spawns the helper service as a child of `vite` in dev mode, passing
// VITE_PID so the helper can kill Vite when its own heartbeat watchdog
// fires (i.e. when the PWA window closes). Reverse direction: when Vite
// exits, kill the helper child so it doesn't linger for ~45s waiting on
// heartbeats that will never come.
function helperPlugin(): Plugin {
  let child: ChildProcess | null = null
  let stopping = false

  const stop = (reason: string) => {
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
      server.httpServer?.once('close', () => stop('vite httpServer close'))
      process.once('exit', () => stop('process exit'))
      process.once('SIGINT', () => stop('SIGINT'))
      process.once('SIGTERM', () => stop('SIGTERM'))
    },
  }
}

const helperTarget = `http://${HELPER_HOST}:${HELPER_PORT}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), helperPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: helperTarget,
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/data': {
        target: helperTarget,
        changeOrigin: false,
      },
    },
  },
})
