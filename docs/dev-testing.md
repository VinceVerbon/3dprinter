# Dev/testing — clean "fresh user" instance

A way to test **exactly what a downloaded user gets** without touching your own
inventory: spin up a pristine Haspel on its own ports against a throwaway data
dir, poke at it, then destroy it. Your real install is never involved.

> Shorthand: tell the assistant **`stest`** and it runs `scripts/test-clean.ps1`.

## What it does

`scripts/test-clean.ps1 -Action start` (the default):

1. Runs **`npm run build`** in `app/` → `app/dist` (the production bundle a
   downloaded user would run, not the dev server). Use `-SkipBuild` to reuse the
   last build.
2. Starts an **isolated helper** on `127.0.0.1:5274` with:
   - `HASPEL_DATA_DIR = <repo>\.test-instance\data` — empty, so the app behaves
     like a brand-new install (no filaments, no settings).
   - `ALLOWED_ORIGIN` / `APP_ORIGIN = http://127.0.0.1:5273`.
   - `WATCHDOG_DISABLED=1` — the script owns the lifecycle; the helper won't
     self-exit.
   - Catalog seed (`data/catalog/*.json`) and demo data (`data/demo/*.json`)
     are still read from the repo (read-only), exactly as for a real user.
3. Starts **`vite preview`** on `127.0.0.1:5273`, serving `app/dist` and proxying
   `/api` + `/data` to the helper (same wiring as dev, different ports).
4. Opens an **isolated Edge/Chrome app window** with its own throwaway
   `--user-data-dir`, so service-worker / PWA / cache / localStorage all start
   clean and vanish on destroy.
5. Writes `<repo>\.test-instance\state.json` (pids + ports) for `status`/`destroy`.

`-Demo` additionally POSTs `/load-demo-data` so the instance starts with the
curated demo content (tests the "Load demo data" path).

## Isolation — why your data is safe

| | Real instance | Clean test instance |
|---|---|---|
| Vite / app port | 5173 | **5273** |
| Helper port | 5174 | **5274** |
| User data dir | `%APPDATA%\Haspel\data` | `<repo>\.test-instance\data` (throwaway) |
| Browser profile | your Edge | `<repo>\.test-instance\edge-profile` (throwaway) |
| localStorage origin | `127.0.0.1:5173` | `127.0.0.1:5273` (separate origin) |

Different ports → separate origins → separate localStorage and service workers.
The throwaway data dir means an in-app "Save" in the test instance writes only to
`.test-instance\data`. Both instances can run **at the same time**.

## Commands

```powershell
.\scripts\test-clean.ps1                    # build + spin up empty (fresh user)
.\scripts\test-clean.ps1 -Demo              # spin up pre-loaded with demo data
.\scripts\test-clean.ps1 -SkipBuild         # reuse app/dist (faster re-spin)
.\scripts\test-clean.ps1 -NoBrowser         # don't open a window
.\scripts\test-clean.ps1 -Action status     # is a test instance running?
.\scripts\test-clean.ps1 -Action destroy    # kill procs + wipe .test-instance
.\scripts\test-clean.ps1 -Action restart    # destroy then start
```

`destroy` kills the recorded helper/vite/Edge process trees, sweeps any leftover
listener on **5273/5274 only** (never the real 5173/5174), and deletes
`<repo>\.test-instance\` (gitignored).

## Notes & gotchas

- **Build is the gate.** `npm run build` runs `vue-tsc -b` first; a type error
  fails the spin-up — which is the point (it's the same gate a release build hits).
- **Label PDF** in the test instance still uses Edge headless against
  `APP_ORIGIN=5273` (unchanged from dev). The Tauri plan later replaces this with
  `window.print()`.
- **Don't commit `.test-instance/`** — it's gitignored.
- This harness is the dev/web stand-in until the **Tauri installer** lands
  (`~/.claude/plans/velvet-tinkering-sparkle.md`); once packaged, "fresh user"
  testing is just installing the `.msi` on a clean profile.

## Enabling changes (for reference)

- `helper/index.mjs` — `ALLOWED_ORIGIN` is now `process.env.ALLOWED_ORIGIN ||`
  the 5173 default.
- `app/vite.config.ts` — `VITE_PORT` / `HELPER_PORT` are env-driven (defaults
  5173/5174); a `preview` block proxies `/api` + `/data` to the helper.
