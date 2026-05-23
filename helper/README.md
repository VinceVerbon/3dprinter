# helper

Local-only Node HTTP service for the 3dprinter PWA. Listens on `127.0.0.1:5174`. The frontend (Vite dev server on `:5173`) proxies `/api/*` and `/data/*` to this helper.

## What it does

- **Serves** JSON files from `data/` (read-only over HTTP).
- **Persists** writes from the PWA atomically (`tmp` + `rename`) with `data/<file>.json` pretty-printed for clean git diffs.
- **Calls `claude`** (the locally installed CLI, OAuth via the user's Pro/Max subscription — no API key) to enrich filament metadata. Cached in `data/ai-cache.json` keyed by `brand|name` (lowercased, trimmed).
- **Self-exits** when its owner is gone — tracks the vite process in dev, or (standalone) a generous heartbeat watchdog. No tray icon, no zombie processes.

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
| `WATCHDOG_DISABLED` | unset | Set to `1` to disable both the vite-pid tracker and the heartbeat watchdog (debugging). |
| `WATCHDOG_TIMEOUT_MS` | `600000` | Standalone-only heartbeat grace before self-exit (ignored when `VITE_PID` is set). |
| `VITE_PID` | unset | When set (numeric), the helper tracks this PID for liveness (exits when it's gone) instead of using the heartbeat watchdog, and sends `SIGTERM` to it on its own `SIGINT`/`SIGTERM`. The Vite plugin in `app/vite.config.ts` populates it with `process.pid`. Standalone helper leaves this unset. |
| `ANTHROPIC_API_KEY` | unset | Overrides the stored Anthropic key when `ai_provider` is `anthropic-api`. |
| `OPENAI_API_KEY` | unset | Overrides the stored OpenAI key when `ai_provider` is `openai-api`. |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | unset | Overrides the stored Gemini key when `ai_provider` is `gemini-api`. |
| `OPENROUTER_API_KEY` | unset | Overrides the stored OpenRouter key when `ai_provider` is `openrouter-api`. |

## Endpoints

All responses are JSON. CORS is set to `http://127.0.0.1:5173` (the Vite dev server) as a defense-in-depth layer; the proxy is the primary path.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/healthz` | — | `{ ok, started_at, last_heartbeat }` |
| `POST` | `/heartbeat` | `{}` | `{ ok: true }` — resets the watchdog timer |
| `GET` | `/data/<file>.json` | — | the JSON, or `[]`/`{}` (for `ai-cache.json`) when missing |
| `POST` | `/save-data` | `{ file, data }` | `{ ok: true }`; atomic write to `data/<file>.json` |
| `POST` | `/lookup-filament` | `{ brand, name, force? }` | `{ ok, cached, result }` — see schema below |
| `POST` | `/lookup-swatch` | `{ brand, name, variant?, sku?, color_code?, product_url?, force? }` | `{ ok, cached, result: { hex, stops[], effects[], source, confidence, notes? } }` — Bambu-prioritised, multicolor-aware |
| `POST` | `/import-order` | `multipart/form-data` with `pdf` file + optional `filename` field | `{ ok, vendor_guess, order_ref, order_date, items[], total_eur, raw_text_preview }` — see flow below |
| `POST` | `/ai-selftest` | `{ provider?, model?, api_key? }` (all optional — falls back to stored config) | `{ ok, provider, detail }`. Probes the chosen backend: `claude --version` for the CLI, a tiny ping for the selected API provider. Accepts an in-form key so the user can test before saving. The API key is never echoed back. |

### AI provider

All three lookups (`/lookup-filament`, `/lookup-swatch`, `/import-order`) route through a single dispatcher (`aiComplete` → `callProvider`) that reads `ai_provider` from `settings.json` (in `USER_DATA_DIR`) on every call:

- **`claude-cli`** (default): shells out to the local `claude` CLI via `runClaude` (OAuth, no key). Swatch uses `WebFetch,Read`; order-import uses `Read` against the temp PDF path.
- **`anthropic-api`**: direct REST to `api.anthropic.com/v1/messages`. Order-import attaches the PDF as a base64 `document` block.
- **`openai-api`** / **`openrouter-api`**: OpenAI Chat Completions schema (`/chat/completions`); OpenRouter uses the same shape at `openrouter.ai/api/v1` plus `HTTP-Referer`/`X-Title` headers. Order-import attaches the PDF as a `file` content part (model must support PDF input).
- **`gemini-api`**: `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` with the key in the `x-goog-api-key` header. Order-import attaches the PDF as `inline_data`.
- **`none`**: lookups return `409 { error: 'ai_disabled' }`; the UI hides every AI button.

The API providers carry **no agentic tools** — enrichment is plain text and swatch resolves from training knowledge only (no live web; only the CLI fetches). Keys come from `{anthropic,openai,gemini,openrouter}_api_key` in settings, each overridable by its env var (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) / `OPENROUTER_API_KEY`), which wins. Per-task model comes from `ai_models.{enrichment,swatch,order_import}`, falling back to `ai_model` (Claude backends only), then a per-provider default. Missing key on an API path → `400 { error: 'no_api_key' }`. All API calls use `fetch` — no SDK dependency.

### `/data/<file>.json` filename rules

- Read: `^([a-z0-9-]+/)?[a-z0-9-]+\.json$` (one optional subdir level — supports `data/catalog/replacement-parts.json`).
- Write (`/save-data`): `^[a-z0-9-]+\.json$` (top-level only — catalog files are seed data, not user-writable).
- Path traversal is rejected explicitly even if the regex slips.

### Watchdog / lifecycle

The exit strategy depends on whether vite owns the helper:

- **Dev mode (`VITE_PID` set by `app/vite.config.ts`):** the heartbeat watchdog is **disabled**. Instead the helper polls `process.kill(VITE_PID, 0)` every 5 s and exits once vite is gone. This is deliberate: browsers throttle/freeze background-tab timers, so a heartbeat watchdog would kill the helper whenever the user alt-tabs away from the PWA for ~45 s — i.e. the app would die under an open window. Tracking the parent process means the helper lives for the whole dev session and the PWA tab can be backgrounded, closed, and reopened freely.
- **Standalone (no `VITE_PID`):** falls back to a heartbeat watchdog, but with a generous **10 min** grace (`WATCHDOG_TIMEOUT_MS`, default `600000`) so ordinary backgrounding never reaps it. The PWA beats every 15 s and also on `visibilitychange`/`focus`.
- `WATCHDOG_DISABLED=1` disables both mechanisms entirely (debugging).

On `SIGINT`/`SIGTERM` the helper still forwards `SIGTERM` to `VITE_PID` (if set) so stopping the helper tears down the whole dev stack; vite's plugin teardown does the reverse (kills the helper child when vite stops).

Standalone runs (`node helper/index.mjs` without Vite) leave `VITE_PID` unset and the kill is a no-op — prior behavior is preserved exactly.

**Windows note:** Node maps `SIGTERM` to `TerminateProcess` (effectively `SIGKILL`). Vite shuts down ungracefully but cleanly enough — the dev server has no flushable state worth caring about.

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

### `/import-order` flow

1. Parse the multipart upload with `busboy`. Cap at 10 MB (`fileSize` limit) — over → `413 { error: "too_large" }`. Missing `pdf` field → `400 { error: "no_pdf_field" }`.
2. Stream the PDF to a fresh temp file under `os.tmpdir()` named `3dprinter-order-<ms>-<rand>.pdf`.
3. Spawn `claude --print --output-format json --model claude-sonnet-4-6 --allowedTools Read --permission-mode bypassPermissions --no-session-persistence --append-system-prompt <framing>` with `cwd=tmpdir()`. The `cwd` choice matters: if Claude is spawned inside the project, it auto-discovers `CLAUDE.md` + `crosslog.md` and starts reasoning about the helper context, which can trip its prompt-injection guard and make it refuse a "scripted-looking" JSON request. Running from a neutral cwd keeps each extraction hermetic.
4. The user-prompt asks Claude to use the Read tool on the absolute temp path (Read handles PDFs natively, including vision-OCR for image-based scans) and return JSON matching the contract in `docs/parallel-work.md` §326–356.
5. Parse the wrapper (same path as `/lookup-filament` — `result` field / `content` string / `content[].text`), strip code fences, `JSON.parse` the inner payload, force-set `ok: true`, return.
6. Unlink the temp PDF in `finally` (also on errors).
7. 120 s timeout — `504 { error: "timeout" }` on miss.

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

# PDF order import (costs subscription quota — manual only)
curl.exe -X POST -F "pdf=@receipt.pdf;type=application/pdf" -F "filename=receipt.pdf" `
  http://127.0.0.1:5174/import-order
```

## Watchdog test

Standalone heartbeat path: start with `WATCHDOG_TIMEOUT_MS=3000` (and no `VITE_PID`), send no heartbeat, and the helper logs `"watchdog: no heartbeat for 3s, exiting"` and exits 0. Dev path: start with `VITE_PID=<some-live-pid>`, kill that pid, and the helper logs `"watchdog: vite pid=… is gone, exiting"` and exits 0.

## Why these design choices

- **Loopback only.** This service has filesystem write access and shells out to a process that calls a paid AI. It must never bind to anything reachable from outside the workstation.
- **Atomic writes** (`tmp` + `rename`). A crash mid-write leaves either the old file or the new file — never a half-written file the app can't parse.
- **Pretty-printed JSON with trailing newline.** Diff-friendly when the user commits `data/` to git.
- **Stdin-piped prompt.** The filament prompt contains `|` characters (TypeScript union types in the schema). Passing them as a positional CLI arg through cmd.exe corrupts the prompt; piping over stdin is robust on Windows, macOS, and Linux.
- **Owner-tracked lifecycle.** In dev the helper lives and dies with the vite process that spawned it — not with PWA heartbeats, which browsers throttle when the tab is backgrounded (that caused the helper to die under an open app, surfacing as "Failed to fetch" on AI calls). Standalone falls back to a generous heartbeat watchdog so an orphaned helper still self-cleans eventually.
