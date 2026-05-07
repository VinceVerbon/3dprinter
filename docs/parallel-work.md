# Parallel Work — Claimable Chunks

This doc enumerates work units that can be done **in parallel with the main scaffold** by another Claude Code chat without merge conflicts. Each chunk is bounded by file paths so two chats won't touch the same file.

## How to claim a chunk

1. Open `crosslog.md`, claim the next chat letter, and append a `SESSION START` entry.
2. Pick a chunk below. Add a log entry: `**Action:** claiming Chunk N — <name>` with `**Status:** in-progress`.
3. Spin up a worktree for isolation (recommended, not required):
   ```powershell
   .\scripts\new-worktree.ps1 chunk-<n>-<short-name>
   cd worktrees/3dprinter\chunk-<n>-<short-name>
   ```
4. Work within your chunk's allowed paths only. Honor the **DO NOT TOUCH** lists below.
5. When done: commit on the branch, push, open a PR (or fast-forward merge to `main` if trivial).

If you don't use a worktree, just don't edit files outside your chunk's allowed paths in the main checkout.

---

## Chunk A — Helper service (Node, single file)

**Status (2026-05-07):** unclaimed.

**Scope:** Build the entire Node helper that the app talks to over `http://127.0.0.1:5174`. The app scaffold proxies `/api/*` and `/data/*` to this port (see `app/vite.config.ts`).

**Allowed paths (only edit these):**
- `helper/index.mjs` — the helper itself (single ESM file, no build step)
- `helper/README.md` — what it does, why, how to debug, troubleshooting
- `helper/package.json` — minimal, only if you need a runtime dep; prefer Node stdlib (`node:http`, `node:fs/promises`, `node:child_process`, `node:path`, `node:url`)

**DO NOT TOUCH:**
- `app/**` — the frontend scaffold (Chat A is working there)
- `data/**` — seed data goes there (Chunk B owns it)
- `scripts/**`, project root files

**Runtime constraints:**
- Pure Node 22+ stdlib preferred. Tiny deps OK (e.g. `mime-types`) but not required.
- ESM (`"type": "module"` in `helper/package.json` or `.mjs` extension).
- Listen on `127.0.0.1:5174` only (never `0.0.0.0` — local trust boundary).
- Port and project root configurable via env: `HELPER_PORT` (default 5174), `PROJECT_ROOT` (default = parent of `helper/`).

**Endpoints (exact contract — the app depends on these):**

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/healthz` | — | `200` `{"ok":true,"started_at":"<iso>","last_heartbeat":"<iso>\|null"}` | Liveness; used by `start.ps1` to wait for boot |
| POST | `/heartbeat` | `{}` | `200` `{"ok":true}` | Resets watchdog timer; called every 15 s by app |
| GET | `/data/<file>.json` | — | `200` JSON or `404` | Serve any JSON under `data/`. Block path traversal. Return `[]` (or `{}` for ai-cache) if file missing. |
| POST | `/save-data` | `{"file":"filaments.json","data":<any>}` | `200` `{"ok":true}` or `400/500` | Atomic write to `data/<file>.json`. Validate `file` matches `^[a-z0-9-]+\.json$` and resolves under `data/`. Pretty-print with 2-space indent + trailing newline so git diffs stay clean. |
| POST | `/lookup-filament` | `{"brand":"...","name":"...","force":false}` | `200` `{"cached":bool,"result":<schema>}` | See "AI lookup" below |
| POST | `/lookup-swatch` | `{"brand":"...","name":"..."}` | `200` `{"hex":"#RRGGBB","source":"bambu\|sunlu\|...\|null","confidence":"high\|low\|none"}` | **Stub for v0.1**: always return `{"hex":null,"source":null,"confidence":"none"}`. Real per-supplier resolvers land in v0.2. Document the stub clearly. |

**Watchdog (mandatory):**
- Track `lastHeartbeat` (start = process start time).
- Tick every 5 s. If `now - lastHeartbeat > 45_000`, log `"watchdog: no heartbeat for 45s, exiting"` and `process.exit(0)`.
- Add a `WATCHDOG_DISABLED=1` env escape hatch for development debugging.

**AI lookup (`/lookup-filament`):**
- Spawn `claude --print --output-format json --model claude-sonnet-4-6 "<PROMPT>"` via `child_process.spawn`. Use `claude.cmd` resolution that works on Windows (the binary is `C:\Users\<user>\AppData\Roaming\npm\claude.cmd` / `.ps1`). `npm` exposes it as `claude` on PATH; use `spawn('claude', ...)` with `{ shell: true }` on Windows OR resolve the .cmd explicitly.
- Prompt template (see `CLAUDE.md` → "AI usage") asks for strict JSON matching this schema:
  ```ts
  {
    type: "PLA"|"PLA+"|"PETG"|"ABS"|"ASA"|"TPU"|"PA"|"PA-CF"|"PC"|"Other";
    abrasive: boolean;
    p2s_compatibility: { ams2pro: boolean; hardened_nozzle_required: boolean; notes: string };
    drying: { temp_c: number|null; hours: number|null; desiccant_recommended: boolean };
    print_temp_c: [number, number] | null;
    bed_temp_c: [number, number] | null;
    usage_notes: string;
    annealable: boolean | null;
  }
  ```
- The `claude --output-format json` wraps the model's response — extract the inner `result` field (or `content[].text`), then `JSON.parse` it. If parsing fails, return `400 {"ok":false,"error":"unparseable","raw":"<first 500 chars>"}`.
- Cache to `data/ai-cache.json` keyed by `${brand}|${name}` (lowercased, trimmed). On `force:true`, skip cache read but still write.
- Timeout: 90 s. If exceeded, kill the child and return `504 {"ok":false,"error":"timeout"}`.

**Acceptance criteria:**
- `node helper/index.mjs` boots on port 5174, logs `"helper listening on http://127.0.0.1:5174"`.
- `curl http://127.0.0.1:5174/healthz` returns 200 JSON.
- `curl -X POST http://127.0.0.1:5174/heartbeat -H "content-type: application/json" -d '{}'` returns 200; watchdog timer resets.
- After 45 s with no heartbeat, helper exits cleanly.
- `curl http://127.0.0.1:5174/data/filaments.json` returns `[]` if the file doesn't exist yet.
- `POST /save-data` with `{"file":"filaments.json","data":[...]}` writes the file atomically (write to `<file>.tmp` then `rename`).
- `POST /save-data` with `file: "../etc/passwd"` returns 400.
- `POST /lookup-filament {"brand":"Bambu","name":"PLA Basic Black"}` runs `claude` and returns parsed JSON. **Manual smoke test only — don't add an automated test that calls Claude.**
- All endpoints set `Access-Control-Allow-Origin: http://127.0.0.1:5173` so the dev server proxy isn't strictly required (defense in depth).

**Helpful references in this repo:**
- `CLAUDE.md` → "Stack" and "AI usage" sections
- `data/` directory will exist after Chunk B — but you can create it on first save if missing

**Estimated effort:** 1–2 hours. Single-file deliverable.

---

## Chunk B — Catalog seed data + JSON shapes

**Status (2026-05-07):** unclaimed.

**Scope:** Author the seed catalog of known Bambu P2S replacement parts + common consumables, and lay down the empty JSON files for user data. Plus a one-page schema cheatsheet so the app/helper/people stay in sync.

**Allowed paths (only edit these):**
- `data/filaments.json` — write `[]`
- `data/accessories.json` — write `[]`
- `data/shopping.json` — write `[]`
- `data/empty-spools.json` — write `{"count": 0, "byType": {}}`
- `data/ai-cache.json` — write `{}`
- `data/catalog/replacement-parts.json` — **the meat**: P2S replacement parts the user might need to re-buy
- `data/catalog/consumables.json` — glue, desiccant, build plates, cleaning supplies, etc.
- `docs/data-schemas.md` — one-page reference: each JSON file's shape with TS-ish types

**DO NOT TOUCH:**
- `app/**`, `helper/**`, `scripts/**` — owned by other chunks

**P2S knowledge to apply (use the bambu-p2s-specialist agent if uncertain):**
- The Bambu Lab P2S Combo + AMS 2 Pro is the user's hardware. Do NOT confuse with P1S, X1C, A1, H2D — they have different parts.
- Replacement-parts catalog should include at minimum (the user can extend later): hotend assembly variants (0.2/0.4/0.6/0.8 mm, hardened vs steel), nozzles (same matrix), build plates (textured PEI, smooth PEI, cool plate variants), AMS 2 Pro rollers + idlers + filament cutter, silicone sock, cleaning brush, wiper pad, FEP/glue stick, lubricant, fan modules.
- Each catalog entry: `{ id, name, sku, category, sub_category, p2s_compatible, notes, suggested_brands?: string[], typical_lifetime_hours?: number, price_eur_estimate?: number }`.
- Use the **bambu-p2s-specialist** agent (available in this Claude Code instance) to validate part names + skus. Cite its output in commit messages so future-us knows where the data came from.

**Consumables catalog should include:**
- Adhesion: Magigoo PLA / PETG / PA, glue stick, hairspray
- Drying: silica gel desiccant packs (rechargeable, 200g/500g), filament dryer (Sunlu S2/S4, Eibos), spool storage (vacuum bags + valves)
- Cleaning: isopropyl alcohol, lint-free cloths, brass brush, cotton swabs
- Maintenance: PTFE tube replacement, lubricant (Super Lube), thermal paste

Each entry: `{ id, name, category, typical_unit, suggested_brands?, notes, source_url? }`.

**`docs/data-schemas.md` should document:**
- Top-level shape of each file under `data/`
- Field types, allowed values for enums, what's required vs optional
- Examples (1–2 entries) for each
- A note: "If you change a schema, also update this doc and `app/src/types/`."

**Acceptance criteria:**
- All listed JSON files exist with valid syntax (`node -e "JSON.parse(require('fs').readFileSync('<file>'))"` passes).
- `data/catalog/replacement-parts.json` has ≥ 15 entries covering the P2S part categories above.
- `data/catalog/consumables.json` has ≥ 10 entries.
- `docs/data-schemas.md` covers every file under `data/`.

**Estimated effort:** 1–2 hours, mostly research + JSON authoring.

---

## Chunk C — `start.ps1` launcher script

**Status (2026-05-07):** unclaimed.

**Scope:** Write the PowerShell script that the user double-clicks (or pins to taskbar) to start the whole app: helper → wait for boot → open Edge in app mode → exit. Plus a complementary "shortcut installer" that creates a desktop/taskbar shortcut with a nice icon.

**Allowed paths (only edit these):**
- `scripts/start.ps1` — the launcher
- `scripts/install-shortcut.ps1` — one-time helper that creates a `.lnk` on the user's desktop pointing at `start.ps1`, with the icon from `app/public/icon.svg` (convert to `.ico` first — there's a small ImageMagick or `Inkscape` step; OR ship a hand-crafted `.ico` under `scripts/icon.ico` and point the shortcut at it)
- `scripts/icon.ico` — taskbar icon (commit a 256×256 multi-res ICO)
- `docs/install.md` — user-facing one-page install instructions ("Click `install-shortcut.ps1` once. Then click the desktop shortcut to start the app.")

**DO NOT TOUCH:**
- `app/**`, `helper/**`, `data/**`, `scripts/new-worktree.ps1`

**`start.ps1` requirements:**
- Resolve repo root from `$PSScriptRoot\..` (script is in `scripts/`).
- Verify `node` and `claude` are on PATH; fail fast with a clear message if missing.
- Verify the helper isn't already running (try `Invoke-RestMethod http://127.0.0.1:5174/healthz`); if it is, skip starting it.
- For dev mode (when `app/dist/` doesn't exist): also start `npm run dev` in `app/` as a hidden background process. Wait for `http://127.0.0.1:5173` to respond. (Note: `npm run dev` ALSO spawns the helper via the Vite plugin — your script must NOT also start the helper in dev mode to avoid port conflict. Check for `app/dist/` to decide.)
- For prod mode (when `app/dist/` exists): start the helper directly via `Start-Process -WindowStyle Hidden -PassThru node helper/index.mjs`. Wait for `/healthz`. Then serve `app/dist/` via the helper itself? — **for v0.1, prod mode is out of scope; document it as a TODO**. v0.1 only supports dev mode.
- Launch Edge: `Start-Process msedge.exe -ArgumentList '--app=http://127.0.0.1:5173/'`. (Edge in `--app` mode strips the chrome — looks like a real installed app.)
- Script exits immediately. Helper + Vite continue in background; both die when Edge window closes (helper via heartbeat watchdog, Vite plugin handles its own helper child).

**Edge case to handle:**
- If Edge isn't installed, fall back to `chrome.exe --app=...`. If neither, message the user.
- If port 5173 or 5174 is already in use by something else (not our helper), abort with a clear error.

**`install-shortcut.ps1` requirements:**
- Create `%USERPROFILE%\Desktop\3D Printer Supplies.lnk`.
- Target: `powershell.exe`, Arguments: `-ExecutionPolicy Bypass -WindowStyle Hidden -File "<repo>\scripts\start.ps1"`.
- Icon: `<repo>\scripts\icon.ico`.
- Description: "Bambu P2S supplies database".

**Acceptance criteria:**
- Double-clicking `start.ps1` boots the app end-to-end on the local workstation.
- Closing the Edge window leads to helper exit within ~45 s (verifiable via `Get-Process node` after 60 s).
- Re-running `start.ps1` while the app is open is a no-op (doesn't double-spawn).
- `install-shortcut.ps1` produces a working desktop shortcut.

**Estimated effort:** 1 hour.

---

## Coordination notes

- All three chunks can be worked simultaneously — they touch disjoint paths. Conflicts are limited to (a) the crosslog itself, (b) `MyAIchanges.md` if you log there.
- Chunk A (Helper) does NOT depend on Chunks B or C. It can be smoke-tested with `curl` alone.
- Chunk B (Seed) is pure data + docs. Zero code coupling.
- Chunk C (Launcher) only needs `app/` and `helper/` to exist as directories; the helper service itself doesn't need to work yet — Chunk C can verify its own logic by checking that paths resolve correctly.

When merging back: rebase onto `main` and resolve `crosslog.md` by appending each session's entries (chronological). The crosslog protocol explicitly allows appends.

---

## Chunk D — Wire Vite dev server into the heartbeat watchdog (v0.2)

**Status (2026-05-08):** unclaimed. Best fit: Chat A (already owns the helper).

**Scope:** Close the v0.1 known-issue. Currently when the user closes the PWA window the **helper** self-exits via the heartbeat watchdog, but the **Vite dev server** keeps running on port 5173. Make closing the PWA window kill the whole stack cleanly.

**Allowed paths (only edit these):**
- `helper/index.mjs` — extend the watchdog to also kill a tracked Vite PID on exit
- `app/vite.config.ts` — `helperPlugin` already spawns the helper as a child of `npm run dev`; extend it to **send the helper its own (Vite's) PID via env or a startup POST** so the helper can kill it on watchdog trigger
- `helper/README.md` — document the lifecycle change
- `docs/release-notes/v0.2.0.md` — append a "Lifecycle" highlight when the time comes
- `CHANGELOG.md` `[Unreleased]` — log the fix

**DO NOT TOUCH:** anything under `app/src/**`, `data/**`, `scripts/**`, other docs.

**Recommended approach** (chosen because the helper already has process control + a watchdog tick):

1. **Vite plugin (`app/vite.config.ts`)** — when `helperPlugin` spawns the helper, pass `VITE_PID=${process.pid}` in the child env. The plugin already kills the helper on Vite shutdown, so no change needed to teardown — only the *forward* signal matters.

2. **Helper (`helper/index.mjs`)** — read `process.env.VITE_PID` at startup. On watchdog trigger (`process.exit(0)` after 45 s no-heartbeat) and on SIGINT/SIGTERM, **first** try to terminate the Vite PID, **then** exit:

   ```js
   function killVite(reason) {
     const pid = parseInt(process.env.VITE_PID || '', 10);
     if (!pid) return;
     try {
       process.kill(pid, 'SIGTERM');
       console.log(`[helper] sent SIGTERM to vite pid=${pid} (${reason})`);
       // Windows note: SIGTERM on Windows is treated as SIGKILL by Node.
     } catch (err) {
       if (err.code !== 'ESRCH') console.error(`[helper] kill vite failed:`, err);
     }
   }
   ```

   Call it from the watchdog branch and the `shutdown(sig)` handler.

3. **Edge cases to handle:**
   - User runs `helper/index.mjs` directly (no parent Vite): `VITE_PID` is unset; `killVite` is a no-op. Existing behavior preserved.
   - Helper restarts (e.g. crash + nodemon-style auto-restart, future): the PID env may go stale. Re-resolve via parent process if needed; for v0.2 just trust the env at startup.
   - Vite spawns the helper with `stdio: 'inherit'` already (existing config) so the helper sees Vite's output streams; no change needed.

**Acceptance criteria:**
- `npm run dev` boots both processes; closing the Edge `--app` window stops heartbeats; within ~45 s **both** Vite and the helper are gone (`Get-Process node` returns nothing for them).
- `node helper/index.mjs` standalone (no Vite parent) still self-cleans after 45 s without killing anything else.
- Re-running `scripts/start.ps1` after the auto-cleanup boots a fresh stack with no stale port collisions on 5173 / 5174.
- `helper/README.md` documents the new behavior in the Lifecycle section.

**Estimated effort:** 30–45 min. Two files, ~30 LOC of changes, manual smoke test.

**PR title:** `feat(chunk-d): vite dev-server killed alongside helper on heartbeat-watchdog exit`
