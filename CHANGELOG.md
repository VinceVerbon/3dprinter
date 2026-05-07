# Changelog

All notable changes to **3dprinter** are documented here. Format: [Keep a Changelog](https://keepachangelog.com/). Version source of truth: `VERSION` at repo root. SemVer; pre-1.0 treat MINOR like post-1.0 MAJOR.

## [Unreleased]

## [0.2.0] — 2026-05-08

### Added
- **Vite ↔ helper lifecycle wiring (Chunk D)**: `helperPlugin` in `app/vite.config.ts` now spawns the helper as a child process with `VITE_PID=<vite-pid>` in its env, and proxies `/api/*` (rewriting `/api` → `/`) and `/data/*` to the helper on `127.0.0.1:5174`. The helper, on watchdog timeout / SIGINT / SIGTERM, sends `SIGTERM` to that PID before exiting. Closing the PWA window now tears down both processes. Standalone helper (no Vite parent) is unaffected.
- **Filament catalogue seed** at `data/filaments.json` — 22 records covering 26 physical spools (19 Bambu Lab, 3 123-3D, 4 Real Filament). Bambu records carry full SKUs (e.g. `A00-K0-1.75-1000-SPL`), color codes, and `product_url` to `eu.store.bambulab.com`. Real Filament records reference 123-3d.nl product/category pages. Every record's `ai` block is populated (P2S compatibility, drying, print/bed temps, usage notes, abrasive flag).
- **Catalog seed**: `data/catalog/replacement-parts.json` (33 P2S parts with verified Bambu SKUs and EUR price estimates) + `data/catalog/consumables.json` (16 entries biased to NL retailers — Magigoo, 3DLAC, silica, Sunlu FilaDryer, Capricorn PTFE, IPA, brass brush).
- **Accessory CRUD UI**: list / add / edit / remove with category filter (nozzles, hotends, build plates, AMS parts, fans, belts, lubricants, glues, desiccants, tools, cleaning).
- **Shopping list page**: free-text entry + "Add from catalog" picker pulling from the catalog seeds. Tick-off state persists. Print-friendly view.
- **PDF order import**: drag-drop a Bambu / 123-3d.nl / Amazon NL invoice PDF onto the Filaments page → preview + confirm UI → match on SKU/EAN/brand+name+variant. Matches bump `inventory.sealed`; misses create new entries with full purchase metadata. Frontend complete; helper-side `/import-order` endpoint queued as Chunk F for v0.3.
- **Filament detail modal** (click any card): SKU, color code, EAN, RFID UID, product URL, full P2S+AMS 2 Pro AI block, drying spec, print/bed temps, annealability, purchase metadata, inventory tiles. Re-lookup button refreshes AI inline and persists to disk.
- **Filters on filaments page**: by type (PLA/PETG/ABS/…), by effect (matte/silk/sparkle/…), and by color family (HSL bucketing into 12 visible buckets — red/orange/yellow/green/cyan/blue/purple/pink/brown/black/gray/white). Only families present in current data show as filter buttons. Multicolor filaments match if any stop falls in the selected family.
- **Batch "Fill missing AI"** button on filaments page: sequentially runs `/api/lookup-filament` for every record without an `ai` block. Live progress (`Filling AI… 2/5`), persists once at the end, counts failures separately so a single bad lookup doesn't abort the batch. Hidden when nothing is missing.
- **Print + bed temp chips** on filament cards (Thermometer + Square icons with the AI temp ranges). Hidden when no AI data, so cards stay clean for un-looked-up entries.
- **`Effect` enum gained `transparent`** (in addition to `translucent`) for fully see-through filaments.
- **Architecture documentation** at `docs/architecture.md` covering process model, lifecycle, helper service, AI-lookup chain, persistence flow, color bucketing, multi-chat workflow, and file map.

### Changed
- **Filament data model**: replaced per-spool `spool_state` with per-record `inventory: { sealed, open, in_use }`. Each record now describes one (brand, name, variant) — i.e. one SKU-equivalent — and physical spools of that SKU are counted, not duplicated as separate records.
- `FilamentForm.vue`: state dropdown replaced with three count inputs + a spool-weight (g) field.
- `FilamentCard.vue`: now shows `N spools (a sealed, b open, c in use)`, plus print + bed temp chips when AI data is present.
- `RatingStars.vue`: brighter unselected stroke, hover preview, scale-on-hover, optional readonly mode (used in detail header), explicit clear button. Addresses confusion where stars looked disabled.
- `OrderImportReview.vue`: now handles accessories + consumables as well as filaments.

### Fixed
- v0.1 known issue: closing the PWA `--app` window left `vite` running on port 5173 because only the helper self-terminated via the heartbeat watchdog. Now resolved via Chunk D.
- Detail-modal `Re-lookup` button used to update only a local ref and never write back to disk. Now pushes the result to the filaments store and triggers `save()`.
- `vite.config.ts` was at one point reduced to the bare scaffold by a tooling glitch, breaking Tailwind, the helper plugin, and the PWA wiring. Rebuilt and merged with Chunk D's lifecycle hooks.

### Known issues
- **Per-supplier swatch resolvers stubbed.** `POST /lookup-swatch` always returns `{ hex: null, source: null, confidence: "none" }`. Bambu Filament Library + SUNLU + 123-3d.nl + RealFilament + Firecrawl fallback land in v0.3 (Chunk E).
- **Helper `/import-order` endpoint not implemented.** PDF drop-zone calls `/api/import-order` but the helper currently 404s. Chunk F for v0.3.
- **Bambu PLA Basic Green/Gray defaults assumed** — Chat C picked G6/D0; user should confirm against actual labels.
- **Real Filament PETG Pink/Orange `product_url`** points to category page, not exact SKU. Chunk E swatch resolver will re-fetch.
- **TPU for AMS color codes** are 5-digit MakerWorld codes (53101/53600/53500), not the 2-char SKU codes used elsewhere — Chunk E resolver needs to handle both formats.
- **`claude` CLI must be on PATH and authenticated.** If `claude` isn't installed or the session expired, lookup buttons surface the error in the UI but don't auto-recover.

## [0.1.0] — 2026-05-08

### Added
- Initial scaffold: `.gitignore`, `VERSION`, `README.md`, `CLAUDE.md`, `crosslog.md`, `CHANGELOG.md`, `docs/releaselog.md`, `docs/release-notes/`.
- Worktree convention: `worktrees/3dprinter\<branch>` with helper `scripts\new-worktree.ps1`.
- Registered in `~/.claude/project-ledger.json` under `systems.local`.
- GitHub remote: `vinceverbon/3dprinter` (private).
- **Vue 3 frontend (`app/`)**: Vite + TypeScript + Tailwind CSS 4 + Pinia + Vue Router (hash mode) + Lucide icons + `vite-plugin-pwa` for installable PWA. Custom `helperPlugin` in `vite.config.ts` spawns the helper process alongside `npm run dev` and tears it down on Vite shutdown. App emits a heartbeat to `/api/heartbeat` every 15 s.
- **Filament CRUD**: list / add / edit / remove with manual swatch entry — color picker, 1–5 stop multicolor gradient, effects (matte / silk / sparkle / marble / metallic / glow / multicolor / translucent), 1–5 star rating, spool state, notes. Supplier-stable identifiers (sku, product_url, color_code, rfid_uid, ean, purchased) on the data model for future automated lookups.
- **AI usage lookup**: "Lookup AI" button on filament form posts brand+name to `/api/lookup-filament`; renders P2S+AMS 2 Pro compatibility, drying spec, abrasive flag, print/bed temps, usage notes. Cached in `data/ai-cache.json` keyed by `brand|name`.
- **Empty-spool counter** with byType breakdown.
- **Settings page** with default brand and AI model selector.
- **Pinia stores + persistence layer**: `loadData` / `saveData` against helper `/data` + `/api/save-data`, with localStorage offline fallback.
- **Helper service** (`helper/index.mjs`, ~294 LOC, Node ESM, no runtime deps). Endpoints: `GET /healthz`, `POST /heartbeat`, `GET /data/<file>.json` (incl. one optional subdir level for catalog), `POST /save-data` (atomic tmp+rename, pretty-printed), `POST /lookup-filament` (spawns `claude --print --output-format json` with prompt piped via stdin), `POST /lookup-swatch` (stub for v0.2). Path-traversal guard, CORS pinned to dev-server origin. Heartbeat watchdog: `process.exit(0)` after 45 s without a beat.
- **Launcher** (`scripts/start.ps1`): one-click entry point that starts `npm run dev` (which auto-spawns the helper via `helperPlugin`), waits for both ports, opens the PWA in Edge `--app` mode. No-op if already running. Fallback to Chrome / default browser.
- **Desktop-shortcut installer** (`scripts/install-shortcut.ps1`): creates a `.lnk` on the Desktop pointing at `start.ps1` with the project icon. Pin manually to taskbar.
- **Install guide** (`docs/install.md`): ~2-minute setup walkthrough + troubleshooting.
- **Parallel-work spec** (`docs/parallel-work.md`): three claimable chunks (Helper / Catalog seed / Launcher) with file boundaries, API contracts, and acceptance criteria so multiple sessions can work the project simultaneously.

### Known issues
- The Vite dev server keeps running after the PWA window is closed (only the helper has a heartbeat watchdog). Stop it via Task Manager or close from its hidden console. v0.2 will wire Vite to the watchdog.
- Catalog seed (`data/catalog/replacement-parts.json`, `data/catalog/consumables.json`) was not authored in v0.1. Shopping list and replacement-parts UX wait on this.
- Per-supplier swatch resolvers (Bambu / SUNLU / 123-3d.nl / RealFilament / generic) are stubbed in the helper. v0.2 work.
- Accessory CRUD UI is scaffolded but not implemented. v0.2.
- Shopping list page is scaffolded but not implemented. v0.2.
