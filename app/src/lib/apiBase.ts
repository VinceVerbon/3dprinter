// Single source of truth for where the helper API lives.
//
// Dev (`npm run dev`) and the web/test build (`vite preview`, used by the
// `stest` harness) are served by Vite, which proxies `/api` and `/data` to the
// helper — so a relative base ('') is correct there. A packaged Tauri build has
// no Vite proxy and is served from the Tauri custom protocol, so those requests
// must target the helper sidecar's absolute loopback address.
//
// Detection is at RUNTIME, not build time, so the *same* `app/dist` bundle
// behaves correctly whether it's loaded inside the Tauri webview (talk to the
// sidecar) or opened in a plain browser via `vite preview` (stay relative, let
// Vite proxy). main.ts installs a tiny fetch shim that uses this.

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

/** Absolute origin of the helper when running under Tauri. Matches the port the
 *  helper binds (HELPER_PORT, default 5174). */
export const HELPER_ORIGIN = 'http://127.0.0.1:5174'

/** '' in dev/web (relative, Vite-proxied); the helper origin under Tauri. */
export function apiBase(): string {
  return isTauri() ? HELPER_ORIGIN : ''
}
