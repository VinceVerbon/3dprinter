# 3dprinter — architecture

How the app actually works on disk, in memory, and over the wire. Useful when debugging, picking up a chunk, or deciding where a feature belongs.

## Process model

```
┌────────────────────────────────┐
│  Edge (msedge.exe --app=…)     │   ← user-facing window
│  http://127.0.0.1:5173/        │
└────────────┬───────────────────┘
             │ HTTP (proxied)
             │   /api/*  → /                (rewritten)
             │   /data/* → /data/*          (passthrough)
             ▼
┌────────────────────────────────┐
│  Vite dev server (node)        │   ← spawned by `npm run dev`
│  port 5173                     │
│  helperPlugin (vite.config.ts) │
└────────────┬───────────────────┘
             │ child_process.spawn
             │   env: VITE_PID=<vite pid>
             ▼
┌────────────────────────────────┐
│  Helper service (node ESM)     │   ← single file: helper/index.mjs
│  127.0.0.1:5174                │
│  Lifecycle tracks VITE_PID     │
└────────────┬───────────────────┘
             │ AI provider dispatch (per settings.json, per request)
             ▼
┌────────────────────────────────┐
│  claude CLI (default, OAuth)   │   or Anthropic / OpenAI / Gemini /
│  --print --output-format json  │      OpenRouter REST (user API key)
└────────────────────────────────┘
```

Everything binds to `127.0.0.1` only. No network exposure. The diagram above is the
**dev** stack (`npm run dev` / `scripts/start.ps1`). The shipped app is packaged:

### Packaged app (Tauri 2)

```
┌────────────────────────────────┐
│  Haspel.exe (Tauri/Rust shell) │   ← user window, system WebView2
│  loads bundled app/dist         │      origin: http://tauri.localhost
└────────────┬───────────────────┘
             │ spawns sidecar (tauri_plugin_shell), env PROJECT_ROOT=<resource dir>
             ▼
┌────────────────────────────────┐
│  haspel-helper-<triple>.exe     │   ← the Node helper, bundled via esbuild → pkg
│  127.0.0.1:5174                 │
└────────────────────────────────┘
```

There's no Vite proxy in the packaged build, so the frontend can't rely on relative
`/api` / `/data` paths. A runtime fetch shim (`app/src/lib/apiBase.ts` + `main.ts`)
detects Tauri and rewrites those to `http://127.0.0.1:5174` — a no-op in dev/web, so
the *same* `app/dist` works both in the webview and under `vite preview` (the
`stest` harness). The read-only catalog/demo seed ships as Tauri **resources**
(`PROJECT_ROOT` points the sidecar at them); user data stays at
`%APPDATA%\Haspel\data`. Full build pipeline: `docs/tauri-packaging.md`.

## Lifecycle

The killer feature: there's no manual stop ritual.

- **Packaged (Tauri):** the Rust shell spawns the helper sidecar at startup and
  owns its handle, so closing the window tears the helper down with it. The
  heartbeat watchdog stays as a belt-and-braces backstop.
- **Dev:** the helper's life is tied to the Vite process, so it lives as long as the
  app is running and exits when Vite stops.

### Dev startup (`scripts/start.ps1`) — dev workflow only; the installed app doesn't use this

1. Sanity-check `node`, `npm`, `claude` on PATH.
2. If `127.0.0.1:5174/healthz` already responds → skip helper start.
3. If `127.0.0.1:5173/` already responds → skip Vite start.
4. Otherwise `Start-Process -WindowStyle Hidden npm run dev` in `app/`.
5. Wait up to 30 s for both endpoints to come up.
6. Launch Edge (Chrome fallback) with `--app=http://127.0.0.1:5173/`.
7. Exit. Helper + Vite continue in the background.

### Process-tracked lifecycle (dev) — replaces the old 45 s heartbeat watchdog

The original design killed the helper after 45 s without a heartbeat. That backfired: browsers throttle/freeze background-tab timers, so alt-tabbing away from the PWA for ~45 s killed the helper out from under the still-open window, and the next AI call surfaced as a bare "Failed to fetch" (the Vite proxy had no upstream). The lifecycle now depends on who owns the helper:

- **Dev (`VITE_PID` set by `app/vite.config.ts`):** the heartbeat watchdog is **off**. A 5 s tick polls `process.kill(VITE_PID, 0)` and exits only once Vite is gone. The PWA tab can be backgrounded, closed, and reopened freely — the helper lives for the whole dev session.
- **Standalone (no `VITE_PID`):** falls back to a heartbeat watchdog, but with a generous **10 min** grace (`WATCHDOG_TIMEOUT_MS`, default `600000`) so ordinary backgrounding never reaps it. The SPA beats every 15 s and also on `visibilitychange`/`focus`.
- `WATCHDOG_DISABLED=1` disables both mechanisms.

### Reverse kill

- Vite's `helperPlugin` registers `process.once('SIGINT' | 'SIGTERM' | 'exit')` handlers and `server.httpServer.on('close')`. Any of them fire `child.kill('SIGTERM')` on the helper.
- On its own `SIGINT`/`SIGTERM` the helper forwards `SIGTERM` to `VITE_PID` (try/catch swallows `ESRCH`). Standalone helper (no `VITE_PID`) skips this.

Net effect: stop Vite (or the whole stack) and the helper exits with it; the PWA window opening/closing no longer drives helper lifetime in dev.

## Helper service (`helper/index.mjs`)

Single-file Node ESM, ~294 LOC, no runtime deps. Why no Express: the surface is small (six endpoints), and avoiding `node_modules` for the helper keeps `npx`-cold-start fast.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | `{ ok: true }` |
| POST | `/heartbeat` | Update last-beat timestamp |
| GET | `/data/<file>.json` | Read JSON; one optional subdir level for catalog |
| POST | `/save-data` | `{ file, data }` → atomic tmp+rename, pretty-printed |
| POST | `/lookup-filament` | `{ brand, name, force? }` → AI provider dispatch, return `FilamentAi` |
| POST | `/lookup-swatch` | `{ brand, name, variant?, sku?, ... }` → resolved `{ hex, stops[], effects[], source, confidence }` (Bambu-prioritised, multicolor-aware) |
| POST | `/import-order` | `multipart/form-data` PDF → extracted order JSON |
| POST | `/ai-selftest` | `{ provider?, model?, api_key? }` → probe the chosen backend; key never echoed |

### Hardening

- Loopback bind only (`127.0.0.1`).
- CORS: `ALLOWED_ORIGIN` env-overridable (default `http://127.0.0.1:5173`); the allowlist also covers the Tauri webview origins (`http://tauri.localhost` / `tauri://localhost`) and the `stest` origin (`:5273`). `setCors` echoes the request's Origin when it's in the allowlist.
- Filename regex: `^[a-z0-9-]+\.json$` for writes, `^([a-z0-9-]+/)?[a-z0-9-]+\.json$` for reads (single optional subdir for `data/catalog/`).
- `path.relative(DATA_DIR, resolved).startsWith('..')` traversal guard layered on top of the regex.
- Atomic writes: write to `<file>.tmp`, then `fs.rename` — readers never see partial JSON.

### AI provider dispatch

All three lookups (`/lookup-filament`, `/lookup-swatch`, `/import-order`) go through one dispatcher that reads `ai_provider` from `settings.json` (in `USER_DATA_DIR`) **fresh on every call**, so switching providers in Settings takes effect without a restart:

```
getAiConfig()  → { provider, keyFor(provider), modelFor(task) }   ← reads settings.json
aiComplete({ task, prompt, system, mode, pdfPath })
  → callProvider({ provider, model, apiKey, ... })
      ├─ claude-cli      → runClaude (spawn claude --print --output-format json --model <m>)
      ├─ anthropic-api   → POST api.anthropic.com/v1/messages
      ├─ openai-api      → POST api.openai.com/v1/chat/completions
      ├─ openrouter-api  → POST openrouter.ai/api/v1/chat/completions
      └─ gemini-api      → POST generativelanguage.googleapis.com/.../:generateContent
```

`mode` controls capabilities: `text` (no tools), `web` (CLI gets WebFetch+Read; API providers resolve from training knowledge only), `pdf` (CLI reads the path in the prompt; API providers attach the PDF — Anthropic document block / OpenAI `file` part / Gemini `inline_data`). `modelOverride` is supported but the frontend leaves model choice to `settings.json`. Provider `none` → `409 ai_disabled`; missing API key → `400 no_api_key`. `/lookup-filament` caches per `${brand}|${name}` in `data/ai-cache.json`; 90 s timeout → 504. No SDK dependency — the API providers use `fetch`.

**Why stdin (CLI path):** the prompt contains `|` characters in the schema (`"PLA" | "PLA+" | …`). Passing it as a CLI arg through cmd.exe / PowerShell / Vite's `child_process.spawn` triggers shell-escape edge cases. Piping via stdin sidesteps the entire problem.

**Default = no API key:** the `claude` CLI is OAuth-authenticated against the user's Pro/Max subscription, so the default path needs no `ANTHROPIC_API_KEY`. The API providers are opt-in for users without a Claude sub; each key is stored only in the per-install `settings.json` (or its env var, which wins) and is never committed.

## Frontend (`app/`)

Standard Vue 3 + TS + Vite + Tailwind 4 + Pinia + Vue Router (hash mode). Lucide for icons. `vite-plugin-pwa` for the installable PWA bits.

### Stores (`app/src/stores/`)

One store per JSON file under `data/`:

- `filaments` → `data/filaments.json`
- `accessories` → `data/accessories.json`
- `shopping` → `data/shopping.json`
- `emptySpools` → `data/empty-spools.json`
- `aiCache` → `data/ai-cache.json` (read-only from frontend; helper owns writes)
- `settings` → `data/settings.json`
- `printers` → `data/printers.json`
- `filamentHistory` → `data/filament-history.json` (archive of removed filaments)
- `catalog` → read-only `data/catalog/{replacement-parts,consumables,printers}.json`

All stores share the `loadData` / `saveData` helpers in `app/src/composables/useDataPersistence.ts`. On `save()` failure, falls back to `localStorage` so the UI stays responsive when the helper is offline.

### Persistence flow

```
user edits → store.update(id, patch)
           → store.save() → POST /api/save-data { file, data }
                          → helper atomic write to data/<file>.json
                          → returns { ok: true }
           OR (helper offline)
                          → catch → write to localStorage[<file>]
                          → return { ok: false, offlineFallback: true }
                          → UI shows "Helper offline — saved to localStorage"
```

Next page load: `store.load()` first tries `GET /data/<file>.json` from the helper, then falls back to `localStorage`. When the helper comes back online, the next `save()` overwrites the disk version with whatever's in memory (= localStorage state).

### Filament data model

Per Chat C's catalogue work: **one record = one SKU-equivalent**. Multiple physical spools of the same product are tracked via `inventory: { sealed, open, in_use }` counters, not duplicate records.

```ts
interface Filament {
  id: string
  brand: string
  name: string                  // "PLA Basic"
  variant?: string              // "Sunset Orange"
  // supplier-stable identifiers (filled in over time, used by Chunk E resolvers)
  sku?: string                  // "G02-G0-1.75-1000-SPL"
  product_url?: string          // canonical product page
  color_code?: string           // 2-char SKU code or 5-digit MakerWorld code
  rfid_uid?: string             // Bambu AMS only (per-spool — `in_use` slots)
  ean?: string                  // scan-on-receive
  // presentation
  swatch: { hex, stops[], effects[], source }
  ai?: FilamentAi               // populated by Lookup AI
  rating?: 1..5
  notes?: string
  // counts
  inventory: { sealed, open, in_use }
  spool_grams_total?: number    // 1000 for Bambu refills, 500 for support
  purchased?: { date, price_eur, source, order_ref }
  added_at: string              // ISO date
}
```

Full schema in `docs/data-schemas.md`.

### Color filtering (HSL bucketing)

The filament-page color filter buckets every hex stop into one of 12 visible families via HSL:

- `lightness < 12%` → black
- `lightness > 90% && saturation < 15%` → white
- `saturation < 12%` → gray
- low-medium lightness + low saturation + hue 10–50° → brown
- otherwise hue band → red / orange / yellow / green / cyan / blue / purple / pink

Multicolor filaments match if *any* stop falls in the selected family. Only families present in current data show as filter buttons — empty families are hidden.

## Multi-chat development

The repo is set up for multiple sessions to work in parallel via git worktrees + a shared crosslog. Documented in detail in `crosslog.md`'s Protocol section and `docs/parallel-work.md`.

Worktrees live under a sibling `worktrees/<repo-name>/<branch>` directory (see `scripts/new-worktree.ps1`) and share the main checkout's `.git` and `crosslog.md`. Path ownership is declared per chunk in `docs/parallel-work.md` ("DO NOT TOUCH" lists). The arrangement that worked for v0.1 → v0.2:

| Chat | Owns |
|------|------|
| A | `helper/**`, `app/vite.config.ts` |
| B | Everything else under `app/**`, `data/catalog/**`, docs, releases |
| C | `app/src/types/index.ts`, `app/src/components/Filament*.vue`, `data/filaments.json` |

The conflict-rate held to almost zero across three simultaneous sessions. Key lessons saved in `feedback_*.md` memories: the crosslog is a chat thread (use it for questions/handoffs), chunk-done ≠ session-end, poll the crosslog when waiting on a peer.

## File map

```
3dprinter/
├── app/                              # Vue 3 SPA (frontend)
│   ├── src/
│   │   ├── stores/                   # Pinia (one per data file; incl. printers, filamentHistory)
│   │   ├── composables/              # useDataPersistence, useFilamentLookup, useAiSettings, useHealthz
│   │   ├── lib/                      # apiBase (Tauri fetch routing), filamentName, labels/, swatch/
│   │   ├── components/               # Filament*, Accessory*, Printer*, AddPrinterPrompt, Order*, Swatch*, Rating*
│   │   ├── pages/                    # FilamentsPage, AccessoriesPage, PrintersPage, ShoppingPage, LabelsPage, …
│   │   ├── router/, types/, App.vue, main.ts
│   ├── vite.config.ts                # helperPlugin + /api+/data proxy (dev + preview), env-driven ports
│   └── package.json                  # scripts: dev, build, app:dev, app:build, build:sidecar
├── src-tauri/                        # Tauri 2 native shell (Rust)
│   ├── src/main.rs                   # spawns the helper sidecar, sets PROJECT_ROOT
│   ├── tauri.conf.json               # frontendDist=../app/dist, externalBin, resources (catalog/demo)
│   ├── capabilities/default.json     # shell:allow-execute scoped to the sidecar
│   └── Cargo.toml, build.rs, icons/  (binaries/, target/, gen/ are gitignored)
├── helper/
│   ├── index.mjs                     # the whole helper service
│   ├── package.json                  # node version pin only
│   └── README.md
├── data/                             # seeds ship empty ([]); real data is per-install (%APPDATA%\Haspel\data)
│   ├── filaments.json … shopping.json
│   ├── demo/                         # opt-in demo content (Settings → Load demo data)
│   └── catalog/                      # read-only seed
│       ├── replacement-parts.json
│       ├── consumables.json
│       └── printers.json             # 65-model printer reference
├── scripts/
│   ├── build-sidecar.mjs             # bundle the helper → Tauri sidecar exe (esbuild → pkg)
│   ├── build-prod.ps1, build-docs.mjs   # production build + user-guide PDF bundle
│   ├── test-clean.ps1                # isolated fresh-user instance (stest / dtest)
│   ├── start.ps1                     # dev launcher (dev workflow only)
│   └── install-shortcut.ps1, new-worktree.ps1
└── docs/
    ├── architecture.md               # this file
    ├── install.md                    # ~2-min setup walkthrough
    ├── data-schemas.md               # JSON schema reference
    ├── parallel-work.md              # chunk specs for multi-chat work
    ├── releaselog.md                 # bilingual EN/NL release index
    └── release-notes/vX.Y.Z.md       # per-release narrative
```
