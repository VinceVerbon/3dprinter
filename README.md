# 3dprinter

Personal supplies database for the **Bambu Lab P2S Combo + AMS 2 Pro**, installable as a PWA pinned to the Windows taskbar. Tracks filaments, accessories, replacement-part shopping list, empty-spool counter — with AI-driven filament usage info (P2S compatibility, drying spec, abrasive flag, print/bed temps) sourced via the user's Claude Code subscription (no API key, no extra cost).

## Features (v0.1.0)

- **Filament inventory** — manual entry with brand, exact name, color variant, supplier-stable identifiers (SKU / product URL / Bambu color code / RFID UID / EAN), purchase metadata (date / price / source / order ref), 1–5 star rating, multi-state inventory counters (`sealed` / `open` / `in-use`), spool weight, free-text notes.
- **Swatch UI** — color picker with **1–5 multicolor stops** rendered as a gradient. Effects: matte, silk, sparkle, marble, metallic, glow, multicolor, translucent.
- **AI usage lookup** — "Lookup AI" button per filament posts `brand + name` to the local helper, which calls `claude --print --output-format json`. Returns type / abrasive / P2S+AMS 2 Pro compatibility / drying temp+hours+desiccant / print+bed temp ranges / annealability. Cached per `brand|name` for instant re-opens.
- **Accessory inventory** — nozzles, hotends, build plates, AMS parts, fans, belts, lubricants, glues, desiccants, tools, cleaning supplies. Filterable by category.
- **P2S replacement-parts catalog** (read-only seed, 33 entries) — every official Bambu part for the P2S/AMS 2 Pro with verified SKUs and EUR price estimates from EU retailers.
- **Consumables catalog** (read-only seed, 16 entries) — Magigoo / 3DLAC / silica desiccant / Sunlu FilaDryer / Capricorn PTFE / IPA / brass brush etc., biased to NL retailers (123-3d.nl, 3djake.nl, Amazon NL).
- **Shopping list** — type free-text or click "Add from catalog" to pick replacement parts / consumables. Print or save as PDF for in-store use. Tick items off as you buy them.
- **Empty-spool counter** with optional breakdown by spool type.
- **PDF order dropper** — drag a Bambu Lab EU / 123-3d.nl / Amazon NL invoice PDF onto the Filaments page; the helper extracts line items via Claude, you preview + edit + confirm, matches bump `inventory.sealed`, new entries get full purchase metadata.
- **Lifecycle** — pin `scripts\start.ps1` (or its desktop shortcut) to the taskbar. Click → app opens in Edge `--app` mode → close window → helper auto-exits within ~45 s via heartbeat watchdog. No tray icon, no zombie processes.

## Stack

- **Frontend** (`app/`): Vue 3 + TypeScript + Vite + Tailwind CSS 4 + Pinia + Vue Router (hash mode) + Lucide icons + `vite-plugin-pwa`.
- **Helper** (`helper/index.mjs`): single-file Node ESM, no runtime deps, listens on `127.0.0.1:5174`. Endpoints: `/healthz`, `/heartbeat`, `/data/<file>.json`, `/save-data`, `/lookup-filament`, `/lookup-swatch` (stub in v0.1, real resolvers in v0.2), `/import-order` (v0.2).
- **Persistence**: static JSON files under `data/` (committed). Atomic writes via the helper. Browser localStorage as offline fallback.
- **AI**: `claude` CLI (Pro/Max subscription) — no Anthropic API key required.

## Layout

```
.
├── app/                              # Vue 3 SPA
│   ├── src/{stores,components,pages,composables,router,types}/
│   ├── public/manifest.webmanifest
│   └── vite.config.ts                # custom helperPlugin spawns/kills helper
├── helper/
│   ├── index.mjs                     # Node ESM helper service (~294 LOC)
│   ├── package.json
│   └── README.md
├── data/
│   ├── filaments.json                # user inventory
│   ├── accessories.json
│   ├── shopping.json
│   ├── empty-spools.json
│   ├── ai-cache.json
│   └── catalog/
│       ├── replacement-parts.json    # 33 P2S parts (read-only seed)
│       └── consumables.json          # 16 consumables (read-only seed)
├── scripts/
│   ├── start.ps1                     # taskbar entry point
│   ├── install-shortcut.ps1          # one-time desktop-shortcut installer
│   └── new-worktree.ps1              # multi-chat worktree helper
├── docs/
│   ├── user-guide/                   # end-user manual (Markdown → bundled PDF)
│   ├── install.md                    # setup guide
│   ├── data-schemas.md               # one-page reference for every JSON file
│   ├── parallel-work.md              # multi-chat work-chunk specs
│   ├── releaselog.md                 # bilingual EN/NL release index
│   └── release-notes/vX.Y.Z.md
├── CHANGELOG.md
├── VERSION
└── README.md (this file)
```

## Install

See `docs/install.md` for the ~2-minute setup walkthrough.

```powershell
# Once
git clone https://github.com/VinceVerbon/3dprinter.git
cd 3dprinter\app && npm install
cd .. ; .\scripts\install-shortcut.ps1

# Then click the desktop shortcut (or pin it to the taskbar)
```

## Documentation

The end-user manual lives as Markdown under `docs/user-guide/` (one numbered file
per topic — start at `docs/user-guide/README.md`). It's bundled into the
production build as a single PDF + HTML:

```powershell
node scripts/build-docs.mjs     # → app/dist/docs/Haspel-User-Guide.{html,pdf}
.\scripts\build-prod.ps1        # full production build (vite) + doc bundle
```

The doc builder is zero-dependency and renders the PDF with the same headless
Edge/Chrome engine the app uses for labels. **Review and rebuild the docs on every
production build** — see the "Production build — documentation" section in
`CLAUDE.md`.

## Testing a fresh-user install

To check what a brand-new user sees without touching your own inventory, spin up
an isolated instance on its own ports (5273/5274) against a throwaway data dir:

```powershell
.\scripts\test-clean.ps1            # build + spin up empty (fresh user)
.\scripts\test-clean.ps1 -Demo      # pre-loaded with demo data
.\scripts\test-clean.ps1 -Action destroy   # tear down + wipe
```

Runs side-by-side with your real instance (5173/5174). See `docs/dev-testing.md`.

## Versioning

SemVer. Pre-1.0 treats MINOR like post-1.0 MAJOR. Release procedure documented in `CLAUDE.md` ("Change & release trail").

Latest tag: **v0.1.0** (2026-05-08). See `docs/release-notes/v0.1.0.md`.

## License

Private — not licensed for redistribution.
