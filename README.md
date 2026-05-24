# Haspel — 3D printer supplies tracker

Haspel is a personal supplies database for 3D printing — an **installable native
Windows app** (Tauri) that tracks your filaments, accessories, printers, a
replacement-part shopping list, and an empty-spool counter, with **AI-assisted
filament info** (type, drying spec, abrasive flag, print/bed temps, AMS
compatibility) and printable spool labels.

It started life around a Bambu Lab P2S + AMS 2 Pro, but now supports **any FDM
printer** — add the machines you own and Haspel adapts (spec sheets, AMS-aware
labels, brand-store shopping).

## Features

- **Filaments** — brand, exact name, color/variant, supplier IDs (SKU / product
  URL / color code / RFID / EAN), purchase metadata, 1–5★ rating, inventory
  counts (`sealed` / `open` / `in-use`) and a packaging split (`on-spool` /
  `refill`), spool weight, notes. Removals are **archived to history** (restore or
  hard-delete), not lost.
- **Swatches** — colour picker with 1–5 multicolor stops; effects (matte, silk,
  sparkle, marble, metallic, glow, multicolor, translucent, transparent).
  Per-supplier swatch resolver (Bambu-prioritised) fills colours automatically.
- **AI filament lookup** — enriches a filament with type / abrasive flag / P2S +
  AMS compatibility / drying / print+bed temps / usage notes. Backend is
  **configurable** (Settings → AI provider): Claude CLI (default, uses your own
  Pro/Max quota — no key), Anthropic / OpenAI / Gemini / OpenRouter API keys, or
  None (manual entry). Cached per filament.
- **Printers** — add/manage the printers you own with a detailed **spec view**
  (build volume, max temps, nozzle options, AMS, common accessories, brand/store
  links). Add-form **prefills from a 65-model seed** (Bambu, Prusa, Creality,
  Anycubic, Elegoo, FlashForge, Sovol, QIDI, UltiMaker, Voron, AnkerMake). A
  first-run prompt offers to add a printer (with "don't ask again").
- **Accessories** — nozzles, hotends, build plates, AMS parts, fans, belts,
  lubricants, glues, desiccants, tools, cleaning supplies; filterable.
- **Catalog seed** (read-only) — official P2S replacement parts + common
  consumables, with SKUs and EUR price estimates.
- **Shopping list** — free-text or "Add from catalog"; per-line + total pricing;
  printable for in-store use; tick off as you buy.
- **Labels** — print spool labels to configurable sheet presets (Avery Zweckform
  6138, Decadry 105×70); brand-logo manager; AMS-compatibility chip; server-side
  PDF download.
- **PDF order import** — drop an invoice PDF (Bambu / 123-3d.nl / Amazon NL); the
  helper extracts line items via AI, you preview + confirm; matches bump stock,
  new lines get full purchase metadata + auto-resolved swatches.
- **Empty-spool counter** with optional breakdown by type.

## Install (native app)

Download and run the installer from a release build:

- `Haspel_<version>_x64_en-US.msi` (per-machine) or
- `Haspel_<version>_x64-setup.exe` (per-user, no admin)

Launch **Haspel** from the Start menu / desktop shortcut. The app starts its own
background helper automatically — **no PowerShell, no terminal, no tray icon**.
Your data lives at `%APPDATA%\Haspel\data\` and survives reinstalls.

Build the installer yourself (Windows; needs Rust + Node — see
`docs/tauri-packaging.md`):

```powershell
cd app
npm install
npm run app:build      # builds the sidecar + the .msi/.exe into src-tauri/target/release/bundle/
```

## Stack

- **Frontend** (`app/`): Vue 3 + TypeScript + Vite + Tailwind CSS 4 + Pinia +
  Vue Router (hash mode) + Lucide icons + `vite-plugin-pwa`.
- **Native shell**: **Tauri 2** (Rust + system WebView2) bundling the frontend and
  running the Node helper as a sidecar. See `docs/tauri-packaging.md`.
- **Helper** (`helper/index.mjs`): single-file Node ESM on `127.0.0.1:5174` —
  serves/saves the JSON data, runs the AI lookups (provider-agnostic), resolves
  swatches, imports order PDFs, renders label PDFs.
- **Persistence**: per-install JSON under `%APPDATA%\Haspel\data\` (never
  committed); read-only catalog/demo seed ships with the app.
- **AI**: configurable provider; Claude CLI default (no API key required).

## Layout

```
.
├── app/                          # Vue 3 SPA
│   └── src/{stores,components,pages,composables,router,lib,types}/
├── src-tauri/                    # Tauri 2 native shell (Rust) + bundled sidecar
├── helper/index.mjs              # Node helper service
├── data/
│   ├── filaments.json …          # seeds ship empty ([]); real data is per-install
│   ├── demo/                     # opt-in demo content
│   └── catalog/                  # read-only seed: replacement-parts, consumables, printers (65 models)
├── scripts/
│   ├── build-sidecar.mjs         # bundle the helper into the Tauri sidecar exe
│   ├── build-prod.ps1            # production build + doc bundle
│   ├── test-clean.ps1            # spin up an isolated fresh-user instance (stest/dtest)
│   ├── start.ps1                 # dev launcher (the dev workflow; not needed for the installed app)
│   └── new-worktree.ps1
├── docs/                         # user-guide/, install.md, tauri-packaging.md, dev-testing.md, architecture.md, …
├── CHANGELOG.md, VERSION, README.md
```

## Dev workflow

```powershell
cd app
npm install
npm run dev            # Vite on :5173, auto-spawns the helper on :5174
# or
npm run app:dev        # the Tauri window against the live dev server
```

`scripts/start.ps1` is the dev/PWA launcher (opens the dev build in an Edge
`--app` window) — the installed native app does **not** need it.

## Documentation

The end-user manual lives as Markdown under `docs/user-guide/` (start at
`docs/user-guide/README.md`) and bundles into a single HTML + PDF:

```powershell
node scripts/build-docs.mjs     # → app/dist/docs/Haspel-User-Guide.{html,pdf}
```

## Testing a fresh-user install

Spin up an isolated instance (own ports 5273/5274, throwaway data) to see exactly
what a brand-new user gets, without touching your data:

```powershell
.\scripts\test-clean.ps1            # build + spin up empty (fresh user)
.\scripts\test-clean.ps1 -Demo      # pre-loaded with demo data
.\scripts\test-clean.ps1 -Action destroy   # tear down + wipe
```

See `docs/dev-testing.md`.

## Versioning

SemVer (pre-1.0 treats MINOR like post-1.0 MAJOR). Latest: **v0.4.0** — see
`docs/release-notes/v0.4.0.md` and `CHANGELOG.md`.

## License

No formal open-source license yet. The repository is public for reference; a
license will be added before any formal distribution.
