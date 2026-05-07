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
│  Heartbeat watchdog            │
└────────────┬───────────────────┘
             │ child_process.spawn (per request)
             ▼
┌────────────────────────────────┐
│  claude CLI                    │   ← OAuth via user's Pro/Max sub
│  --print --output-format json  │
└────────────────────────────────┘
```

Everything binds to `127.0.0.1` only. No network exposure.

## Lifecycle

The killer feature: there's no manual stop ritual. Closing the PWA window kills everything within ~45 s.

### Startup (`scripts/start.ps1`)

1. Sanity-check `node`, `npm`, `claude` on PATH.
2. If `127.0.0.1:5174/healthz` already responds → skip helper start.
3. If `127.0.0.1:5173/` already responds → skip Vite start.
4. Otherwise `Start-Process -WindowStyle Hidden npm run dev` in `app/`.
5. Wait up to 30 s for both endpoints to come up.
6. Launch Edge (Chrome fallback) with `--app=http://127.0.0.1:5173/`.
7. Exit. Helper + Vite continue in the background.

### Heartbeat watchdog (helper-side)

- Every 15 s the SPA `POST /api/heartbeat` (proxied to `POST /heartbeat` on the helper).
- Helper updates `lastBeat = Date.now()`.
- A 5 s tick checks `Date.now() - lastBeat`. If > 45 s → log `watchdog: no heartbeat for 45s, exiting` → `killVite('watchdog')` → `process.exit(0)`.
- Disable for debugging with `WATCHDOG_DISABLED=1`.
- Verified live: 46.2 s elapsed before exit (Chunk A acceptance test).

### Reverse kill (Chunk D, v0.2)

- Vite's `helperPlugin` registers `process.once('SIGINT' | 'SIGTERM' | 'exit')` handlers and `server.httpServer.on('close')`. Any of them fire `child.kill('SIGTERM')` on the helper.
- Helper, on `VITE_PID` set in env, calls `killVite()` from both the watchdog branch and the `shutdown(sig)` path. `process.kill(VITE_PID, 'SIGTERM')` is wrapped in a try/catch that swallows `ESRCH` (Vite already dead).
- Standalone helper (no `VITE_PID` env) skips `killVite` entirely — no regression to the v0.1 helper-only mode.

Closing the Edge window stops heartbeats → 45 s later helper kills Vite, Vite kills helper, both processes are gone. Either side dying first cleans up the other.

## Helper service (`helper/index.mjs`)

Single-file Node ESM, ~294 LOC, no runtime deps. Why no Express: the surface is small (six endpoints), and avoiding `node_modules` for the helper keeps `npx`-cold-start fast.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | `{ ok: true }` |
| POST | `/heartbeat` | Update last-beat timestamp |
| GET | `/data/<file>.json` | Read JSON; one optional subdir level for catalog |
| POST | `/save-data` | `{ file, data }` → atomic tmp+rename, pretty-printed |
| POST | `/lookup-filament` | `{ brand, name, force? }` → invoke `claude` CLI, return `FilamentAi` |
| POST | `/lookup-swatch` | Per-supplier resolver chain (stub in v0.2; Chunk E in v0.3) |

### Hardening

- Loopback bind only (`127.0.0.1`).
- CORS pinned to `http://127.0.0.1:5173`.
- Filename regex: `^[a-z0-9-]+\.json$` for writes, `^([a-z0-9-]+/)?[a-z0-9-]+\.json$` for reads (single optional subdir for `data/catalog/`).
- `path.relative(DATA_DIR, resolved).startsWith('..')` traversal guard layered on top of the regex.
- Atomic writes: write to `<file>.tmp`, then `fs.rename` — readers never see partial JSON.

### AI-lookup chain (`/lookup-filament`)

```
SPA "Lookup AI" button
  → POST /api/lookup-filament { brand, name, force? }
  → helper: cache key = `${brand}|${name}` (lowercased, trimmed)
    │   ├─ if cached and !force → return cache hit
    │   └─ otherwise:
    │       spawn claude --print --output-format json --model claude-sonnet-4-6
    │       prompt is piped via STDIN (see "Why stdin" below)
    │       parse JSON, validate shape, write to data/ai-cache.json
    │       return result
    └─ 90 s timeout → 504
```

**Why stdin:** the prompt contains `|` characters in the schema (`"PLA" | "PLA+" | …`). Passing it as a CLI arg through cmd.exe / PowerShell / Vite's `child_process.spawn` triggers shell-escape edge cases. Piping via stdin sidesteps the entire problem.

**Why no API key:** the `claude` CLI is OAuth-authenticated against the user's Pro/Max subscription. Lookup costs come out of the existing subscription quota — no `ANTHROPIC_API_KEY` env var required.

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

Worktrees live under `worktrees/3dprinter\<branch>` and share the main checkout's `.git` and `crosslog.md`. Path ownership is declared per chunk in `docs/parallel-work.md` ("DO NOT TOUCH" lists). The arrangement that worked for v0.1 → v0.2:

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
│   │   ├── stores/                   # Pinia (one per data file)
│   │   ├── composables/              # useDataPersistence, useFilamentLookup
│   │   ├── components/               # Filament*, Accessory*, Order*, Swatch*, Rating*
│   │   ├── pages/                    # FilamentsPage, AccessoriesPage, ShoppingPage, …
│   │   ├── router/, types/, App.vue, main.ts
│   ├── public/manifest.webmanifest
│   ├── vite.config.ts                # helperPlugin (Chunk D) + /api+/data proxy
│   └── package.json
├── helper/
│   ├── index.mjs                     # the whole helper service
│   ├── package.json                  # node version pin only
│   └── README.md
├── data/                             # static JSON, committed
│   ├── filaments.json                # user inventory
│   ├── accessories.json
│   ├── shopping.json
│   ├── empty-spools.json
│   ├── ai-cache.json
│   └── catalog/
│       ├── replacement-parts.json    # 33 P2S parts, read-only seed
│       └── consumables.json          # 16 consumables, read-only seed
├── scripts/
│   ├── start.ps1                     # taskbar launcher
│   ├── install-shortcut.ps1          # desktop-shortcut installer
│   └── new-worktree.ps1              # multi-chat worktree helper
└── docs/
    ├── architecture.md               # this file
    ├── install.md                    # ~2-min setup walkthrough
    ├── data-schemas.md               # JSON schema reference
    ├── parallel-work.md              # chunk specs for multi-chat work
    ├── releaselog.md                 # bilingual EN/NL release index
    └── release-notes/vX.Y.Z.md       # per-release narrative
```
