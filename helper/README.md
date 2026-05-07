# helper

Local-only Node HTTP service for the 3dprinter PWA. Listens on `127.0.0.1:5174`. The frontend (Vite dev server on `:5173`) proxies `/api/*` and `/data/*` to this helper.

## What it does

- **Serves** JSON files from `data/` (read-only over HTTP).
- **Persists** writes from the PWA atomically (`tmp` + `rename`) with `data/<file>.json` pretty-printed for clean git diffs.
- **Calls `claude`** (the locally installed CLI, OAuth via the user's Pro/Max subscription — no API key) to enrich filament metadata. Cached in `data/ai-cache.json` keyed by `brand|name` (lowercased, trimmed).
- **Self-exits** when the PWA stops sending heartbeats. No tray icon, no zombie processes.

## Run

From the repo root:

```powershell
node helper/index.mjs
```

Or via the package script:

```powershell
cd helper && npm start
```

For local hacking without the auto-exit:

```powershell
$env:WATCHDOG_DISABLED = '1'; node helper/index.mjs
```

In dev (`npm run dev` in `app/`), the Vite plugin spawns this helper as a child process and kills it on Vite shutdown — you do NOT need to start it manually.

## Env

| Variable | Default | Purpose |
|---|---|---|
| `HELPER_PORT` | `5174` | Listen port (loopback only). |
| `PROJECT_ROOT` | parent of `helper/` | Used to locate `data/`. |
| `WATCHDOG_DISABLED` | unset | Set to `1` to disable the heartbeat watchdog (debugging). |

## Endpoints

All responses are JSON. CORS is set to `http://127.0.0.1:5173` (the Vite dev server) as a defense-in-depth layer; the proxy is the primary path.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/healthz` | — | `{ ok, started_at, last_heartbeat }` |
| `POST` | `/heartbeat` | `{}` | `{ ok: true }` — resets the watchdog timer |
| `GET` | `/data/<file>.json` | — | the JSON, or `[]`/`{}` (for `ai-cache.json`) when missing |
| `POST` | `/save-data` | `{ file, data }` | `{ ok: true }`; atomic write to `data/<file>.json` |
| `POST` | `/lookup-filament` | `{ brand, name, force? }` | `{ ok, cached, result }` — see schema below |
| `POST` | `/lookup-swatch` | `{ brand, name }` | **stub** for v0.1: `{ hex: null, source: null, confidence: "none" }` |

### `/data/<file>.json` filename rules

- Read: `^([a-z0-9-]+/)?[a-z0-9-]+\.json$` (one optional subdir level — supports `data/catalog/replacement-parts.json`).
- Write (`/save-data`): `^[a-z0-9-]+\.json$` (top-level only — catalog files are seed data, not user-writable).
- Path traversal is rejected explicitly even if the regex slips.

### Watchdog

- Tick every 5 s.
- If no `/heartbeat` for 45 s, log `"watchdog: no heartbeat for 45s, exiting"` and `process.exit(0)`.
- `WATCHDOG_DISABLED=1` disables the timer entirely.
- The PWA emits a heartbeat every 15 s while its window is open; closing the window stops the heartbeats and the helper exits within 45 s.

### `/lookup-filament` flow

1. Compute cache key `${brand}|${name}` (lowercased, trimmed).
2. Read `data/ai-cache.json` (treat missing as `{}`).
3. Hit? Return `{ cached: true, result }`.
4. Miss (or `force: true`): spawn `claude --print --output-format json --model claude-sonnet-4-6` and pipe the prompt over stdin (avoids cmd.exe escape issues with `|` chars in the schema).
5. Parse the wrapper (`result` field, `content` string, or `content[].text`), strip code fences if any, then `JSON.parse` the inner payload.
6. Write back to cache (atomic) and return `{ cached: false, result }`.
7. 90 s timeout — kill the child and return `504 { ok: false, error: "timeout" }`.

Returned `result` shape:

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

## Smoke test (manual)

```powershell
# in one shell
$env:WATCHDOG_DISABLED = '1'
node helper/index.mjs

# in another shell
Invoke-RestMethod http://127.0.0.1:5174/healthz
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:5174/heartbeat -Body '{}' -ContentType 'application/json'
Invoke-RestMethod http://127.0.0.1:5174/data/filaments.json   # -> [] when missing
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:5174/save-data `
  -Body '{"file":"filaments.json","data":[{"brand":"Bambu","name":"PLA Basic Black"}]}' `
  -ContentType 'application/json'
Invoke-RestMethod http://127.0.0.1:5174/data/filaments.json   # -> the saved array

# Path-traversal guard
try {
  Invoke-RestMethod -Method POST -Uri http://127.0.0.1:5174/save-data `
    -Body '{"file":"../etc/passwd","data":"x"}' `
    -ContentType 'application/json'
} catch { $_.Exception.Response.StatusCode }   # -> BadRequest

# AI lookup (costs your subscription quota — manual only)
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:5174/lookup-filament `
  -Body '{"brand":"Bambu","name":"PLA Basic Black"}' `
  -ContentType 'application/json'
```

## Watchdog test

Start the helper without `WATCHDOG_DISABLED`. Wait ~50 s without sending a heartbeat. Helper logs `"watchdog: no heartbeat for 45s, exiting"` and the process exits with code 0.

## Why these design choices

- **Loopback only.** This service has filesystem write access and shells out to a process that calls a paid AI. It must never bind to anything reachable from outside the workstation.
- **Atomic writes** (`tmp` + `rename`). A crash mid-write leaves either the old file or the new file — never a half-written file the app can't parse.
- **Pretty-printed JSON with trailing newline.** Diff-friendly when the user commits `data/` to git.
- **Stdin-piped prompt.** The filament prompt contains `|` characters (TypeScript union types in the schema). Passing them as a positional CLI arg through cmd.exe corrupts the prompt; piping over stdin is robust on Windows, macOS, and Linux.
- **Heartbeat-driven lifecycle.** Closing the PWA window is the user's "stop" signal — no separate process to manage. The watchdog ensures cleanup even if the app crashes.
