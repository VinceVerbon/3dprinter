# Changelog

All notable changes to **3dprinter** are documented here. Format: [Keep a Changelog](https://keepachangelog.com/). Version source of truth: `VERSION` at repo root. SemVer; pre-1.0 treat MINOR like post-1.0 MAJOR.

## [Unreleased]

### Added
- Initial filament catalogue seed at `data/filaments.json` — 22 records covering 26 physical spools (19 Bambu Lab, 3 123-3D, 4 Real Filament). Bambu records carry full SKUs (e.g. `A00-K0-1.75-1000-SPL`), color codes, and `product_url` to `eu.store.bambulab.com`. Real Filament records reference 123-3d.nl product/category pages.
- `Effect` enum gained `transparent` (in addition to `translucent`) for fully see-through filaments.

### Changed
- **Filament data model**: replaced per-spool `spool_state` with per-record `inventory: { sealed, open, in_use }`. Each record now describes one (brand, name, variant) — i.e. one SKU-equivalent — and physical spools of that SKU are counted, not duplicated as separate records.
- `FilamentForm.vue`: state dropdown replaced with three count inputs + a spool-weight (g) field.
- `FilamentCard.vue`: now shows `N spools (a sealed, b open, c in use)`.

### Fixed

## [0.1.0] — 2026-05-08

### Added
- Initial scaffold: `.gitignore`, `VERSION`, `README.md`, `CLAUDE.md`, `crosslog.md`, `CHANGELOG.md`, `docs/releaselog.md`, `docs/release-notes/`.
- Worktree convention: `E:\Dev\worktrees\3dprinter\<branch>` with helper `scripts\new-worktree.ps1`.
- Registered in `~/.claude/project-ledger.json` under `systems.kantoor`.
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
- **Parallel-work spec** (`docs/parallel-work.md`): three claimable chunks (Helper / Catalog seed / Launcher) with file boundaries, API contracts, and acceptance criteria so multiple Claude Code sessions can work the project simultaneously.

### Known issues
- The Vite dev server keeps running after the PWA window is closed (only the helper has a heartbeat watchdog). Stop it via Task Manager or close from its hidden console. v0.2 will wire Vite to the watchdog.
- Catalog seed (`data/catalog/replacement-parts.json`, `data/catalog/consumables.json`) was not authored in v0.1. Shopping list and replacement-parts UX wait on this.
- Per-supplier swatch resolvers (Bambu / SUNLU / 123-3d.nl / RealFilament / generic) are stubbed in the helper. v0.2 work.
- Accessory CRUD UI is scaffolded but not implemented. v0.2.
- Shopping list page is scaffolded but not implemented. v0.2.
