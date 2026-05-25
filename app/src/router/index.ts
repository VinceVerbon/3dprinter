import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/filaments' },
  { path: '/filaments', component: () => import('../pages/FilamentsPage.vue') },
  { path: '/accessories', component: () => import('../pages/AccessoriesPage.vue') },
  { path: '/shopping', component: () => import('../pages/ShoppingPage.vue') },
  { path: '/empty-spools', component: () => import('../pages/EmptySpoolsPage.vue') },
  { path: '/printers', component: () => import('../pages/PrintersPage.vue') },
  { path: '/labels', component: () => import('../pages/LabelsPage.vue') },
  { path: '/labels/logos', component: () => import('../pages/BrandLogosPage.vue') },
  { path: '/settings', component: () => import('../pages/SettingsPage.vue') },
]

export const router = createRouter({ history: createWebHashHistory(), routes })

// --- PWA self-heal: recover from stale-chunk navigation failures ------------
// Routes are code-split (lazy `import()`). With the PWA's `registerType:
// 'autoUpdate'`, when a new build's service worker activates it purges the
// previous build's precached chunks. A tab still running the OLD bundle then
// asks for a route chunk whose hashed filename no longer exists anywhere → the
// dynamic import rejects and vue-router aborts the navigation *silently*. The
// symptom is a nav link or button that appears to do nothing.
//
// Detect that class of error and hard-reload to the intended route once. The
// reload is served by the now-active service worker, so it pulls the fresh
// index.html + matching chunks and the navigation succeeds. A short-lived guard
// prevents a reload loop if the reload itself can't resolve the route.
const CHUNK_LOAD_ERROR =
  /dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported|Failed to fetch dynamically/i
const RELOAD_GUARD_KEY = 'haspel:chunk-reload-at'

router.onError((err, to) => {
  const message = String((err as { message?: string })?.message ?? err)
  if (!CHUNK_LOAD_ERROR.test(message)) return

  // Don't reload more than once per 10s — if the reload still can't load the
  // chunk, surface the original failure rather than looping.
  const now = Date.now()
  const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0)
  if (now - last < 10_000) return
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(now))

  // Hash history: point the URL at the intended route, then full-reload so the
  // updated service worker serves a consistent build.
  if (to?.fullPath) location.hash = to.fullPath
  location.reload()
})
