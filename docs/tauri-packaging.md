# Tauri 2 packaging — installable Haspel

Haspel ships as a native Windows app via **Tauri 2**: a small Rust shell hosting
the system WebView2, with the Vue frontend bundled and the Node helper running as
a **sidecar** process. No `git pull` / `npm run dev` / PowerShell launcher — install
the `.msi`/`.exe`, launch from the Start menu.

## Architecture

```
Haspel.exe (Tauri/Rust shell)
 ├─ WebView2 window  →  loads bundled app/dist (Vue SPA)
 │                       fetch('/api'|'/data') → rewritten to 127.0.0.1:5174 (Tauri only)
 └─ spawns sidecar:  haspel-helper-<triple>.exe  (Node helper, pkg-bundled)
                       binds 127.0.0.1:5174
                       PROJECT_ROOT = app resource dir  (read-only catalog/demo seed)
                       user data    = %APPDATA%\Haspel\data  (same as dev/PWA — data continuity)
```

- **Frontend routing** (`app/src/lib/apiBase.ts` + a fetch shim in `app/src/main.ts`):
  runtime-detects Tauri and rewrites `/api`+`/data` calls to the sidecar's absolute
  `http://127.0.0.1:5174`. In dev/web it's a no-op (Vite proxies relative paths), so
  the same `app/dist` works in both the Tauri webview and `vite preview` (the `stest`
  harness). No per-call-site changes.
- **Sidecar** (`scripts/build-sidecar.mjs`): esbuild bundles the ESM helper (+ busboy)
  into one CJS file, then `@yao-pkg/pkg` wraps it with an embedded Node 22 runtime into
  `src-tauri/binaries/haspel-helper-<rustc-host-triple>.exe` (the name Tauri's
  `externalBin` expects). ~55 MB.
- **Seed data**: `data/catalog/` + `data/demo/` are bundled as Tauri **resources**
  (`bundle.resources` map). At runtime Rust sets the sidecar's `PROJECT_ROOT` to the
  resource dir, so the helper finds `PROJECT_ROOT/data/{catalog,demo}`.
- **User data** stays at `%APPDATA%\Haspel\data` (the helper's default), so an installed
  Haspel sees the very same inventory as the dev/PWA build.
- **CORS**: the helper allows the Tauri webview origins (`http://tauri.localhost` on
  Windows, `tauri://localhost` on macOS/Linux) in addition to the dev/stest origins.

## Build

Prerequisites (Windows): Rust (`rustup`, stable-msvc), VS Build Tools 2022 with the
C++ workload, WebView2 runtime (preinstalled on Win11). Node + the app deps
(`@tauri-apps/cli`, `@yao-pkg/pkg`, `esbuild`) are in `app/`.

```powershell
# From app/ — builds the sidecar exe, then the Tauri bundle (which runs `npm run build`).
npm run app:build
#   = node ../scripts/build-sidecar.mjs   (→ src-tauri/binaries/haspel-helper-<triple>.exe)
#   + tauri build                          (→ src-tauri/target/release/bundle/{msi,nsis})
```

Outputs:
- `src-tauri/target/release/bundle/msi/Haspel_<ver>_x64_en-US.msi`  (per-machine; needs admin)
- `src-tauri/target/release/bundle/nsis/Haspel_<ver>_x64-setup.exe` (per-user; no admin)

Rebuild just the sidecar: `npm run build:sidecar`.

## Dev

`npm run app:dev` (= `tauri dev`) opens the Tauri window against the live Vite dev
server (`beforeDevCommand` starts it on :5173). In dev **no sidecar is bundled** — the
helper is the one Vite's plugin already runs on :5174, reached via the dev proxy; the
Rust sidecar spawn fails gracefully and is logged.

## Files

- `src-tauri/` — `Cargo.toml`, `build.rs`, `tauri.conf.json`, `src/main.rs`
  (spawns the sidecar, pipes its stdio, sets `PROJECT_ROOT`), `capabilities/default.json`
  (`shell:allow-execute` scoped to the sidecar), `icons/` (from `app/public/app-icon-512.png`).
- `scripts/build-sidecar.mjs` — esbuild → pkg pipeline.
- `app/src/lib/apiBase.ts`, `app/src/main.ts` — Tauri fetch routing.

Gitignored: `src-tauri/target/`, `src-tauri/gen/`, `src-tauri/binaries/`, `dist-sidecar/`.

## Known limits / next

- **Don't run the installed app and the dev/PWA helper at once** — both bind `127.0.0.1:5174`;
  the second helper can't bind and that app shows no data.
- **Label PDF** still uses Edge headless (`/api/render-labels-pdf`) — fine on Windows where
  Edge is present. The cross-platform `window.print()` switch is a later step.
- **Not yet done**: code-signing (SmartScreen will warn), auto-updater, CI release pipeline,
  macOS/Linux builds (tracked in the project backlog).
