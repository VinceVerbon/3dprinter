#!/usr/bin/env node
// 3dprinter helper service — local-only Node HTTP service on 127.0.0.1:5174.
// Serves data/<file>.json, persists writes atomically, calls `claude` for
// filament enrichment, and self-exits when the PWA stops sending heartbeats.
// Contract: docs/parallel-work.md §"Chunk A — Helper service".

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, unlink, stat, copyFile, utimes } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Busboy from 'busboy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(__dirname, '..');
// CATALOG_DIR holds the read-only seed catalog (shipped with the app). Kept
// rooted at <repo>/data/ rather than <repo>/data/catalog/ so the existing
// FILE_RE_READ regex (which already encodes the optional "catalog/" prefix)
// continues to work without modification.
const CATALOG_DIR = path.join(PROJECT_ROOT, 'data');
// LEGACY_DATA_DIR is the pre-split location of per-install user data. Used
// only by the one-time migration step below to seed USER_DATA_DIR on first
// run; never read at runtime after that.
const LEGACY_DATA_DIR = path.join(PROJECT_ROOT, 'data');
// DEMO_DIR holds curated example data the user can opt into via
// POST /load-demo-data. Shipped in-repo, read-only, never overwritten.
const DEMO_DIR = path.join(PROJECT_ROOT, 'data', 'demo');

/** OS-appropriate per-install user data directory. Overridable via
 *  HASPEL_DATA_DIR. The defaults match what Tauri 2's app_data_dir() returns
 *  on each platform, so the eventual Tauri migration is a no-op. */
function getUserDataDir() {
  if (process.env.HASPEL_DATA_DIR) return path.resolve(process.env.HASPEL_DATA_DIR);
  const home = homedir();
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appdata, 'Haspel', 'data');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Haspel', 'data');
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(xdg, 'haspel', 'data');
}
const USER_DATA_DIR = getUserDataDir();

// Files we treat as per-install user data (vs. read-only catalog seed).
const USER_DATA_FILES = [
  'filaments.json',
  'accessories.json',
  'shopping.json',
  'empty-spools.json',
  'brand-logos.json',
  'ai-cache.json',
  'settings.json',
];

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.HELPER_PORT || '5174', 10);
// CORS: the dev-server origin is the default (overridable via ALLOWED_ORIGIN so
// the side-by-side clean-test instance on 5273 can allow its own origin). The
// packaged Tauri app loads from a custom-protocol origin (http://tauri.localhost
// on Windows, tauri://localhost on macOS/Linux) and calls the helper at
// 127.0.0.1:5174 cross-origin, so those are allowed too. setCors echoes the
// request's Origin when it's in this set.
const DEFAULT_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://127.0.0.1:5173';
const ALLOWED_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
]);

// Set by the Vite plugin in app/vite.config.ts when this helper is spawned
// as a child of `npm run dev`. When the heartbeat watchdog fires (PWA closed)
// or the helper receives SIGINT/SIGTERM, we forward SIGTERM to the Vite PID
// so the whole dev stack tears down together. Unset (standalone helper) =>
// killVite() is a no-op and prior behavior is preserved.
const VITE_PID = (() => {
  const raw = parseInt(process.env.VITE_PID || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
})();

const STARTED_AT = new Date().toISOString();
let watchdogResetAt = Date.now();
let lastHeartbeatIso = null;
let viteKilled = false;

function killVite(reason) {
  if (viteKilled || VITE_PID == null) return;
  viteKilled = true;
  try {
    process.kill(VITE_PID, 'SIGTERM');
    console.log(`[helper] sent SIGTERM to vite pid=${VITE_PID} (${reason})`);
  } catch (err) {
    // ESRCH = process already gone (e.g. user already Ctrl+C'd Vite).
    if (err && err.code !== 'ESRCH') {
      console.error(`[helper] failed to kill vite pid=${VITE_PID}:`, err.message || err);
    }
  }
}

const FILE_RE_FLAT = /^[a-z0-9-]+\.json$/;
const FILE_RE_READ = /^([a-z0-9-]+\/)?[a-z0-9-]+\.json$/;

function setCors(res) {
  // res._reqOrigin is stashed at the top of the request handler. Echo it when
  // it's an allowed origin (lets dev, the stest instance, and the Tauri webview
  // all work); otherwise fall back to the default dev origin.
  const o = res._reqOrigin;
  const allow = o && ALLOWED_ORIGINS.has(o) ? o : DEFAULT_ORIGIN;
  res.setHeader('access-control-allow-origin', allow);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function send(res, status, body) {
  setCors(res);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

function resolveDataPath(filename) {
  // catalog/* is read-only seed bundled with the app — resolves under the repo.
  // Everything else is per-install user data — resolves under USER_DATA_DIR.
  const root = filename.startsWith('catalog/') ? CATALOG_DIR : USER_DATA_DIR;
  const target = path.resolve(root, filename);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path traversal');
  }
  return target;
}

/** One-time migration: copy any user-data file that exists at the legacy
 *  repo location but NOT yet at USER_DATA_DIR. Preserves mtime so the
 *  user's history is intact. Never deletes the originals — the repo-side
 *  cleanup (resetting seeds to empty + .gitignore) happens in a separate
 *  manual commit once the user has verified migration worked. Idempotent. */
async function migrateLegacyDataIfNeeded() {
  try {
    await mkdir(USER_DATA_DIR, { recursive: true });
  } catch (err) {
    console.error(`[migrate] failed to create user data dir ${USER_DATA_DIR}: ${err.message}`);
    return;
  }
  // Skip migration entirely when running against an explicit override that
  // points at the legacy location — would be a no-op, and the equality check
  // is the cheapest way to avoid self-overwrites in dev.
  if (path.resolve(USER_DATA_DIR) === path.resolve(LEGACY_DATA_DIR)) {
    console.log(`[migrate] user_data_dir == legacy data dir (${USER_DATA_DIR}); skipping migration`);
    return;
  }
  let copied = 0;
  let skipped = 0;
  for (const file of USER_DATA_FILES) {
    const dest = path.join(USER_DATA_DIR, file);
    if (existsSync(dest)) { skipped += 1; continue; }
    const src = path.join(LEGACY_DATA_DIR, file);
    if (!existsSync(src)) continue;
    try {
      await copyFile(src, dest);
      try {
        const srcStat = await stat(src);
        await utimes(dest, srcStat.atime, srcStat.mtime);
      } catch { /* mtime is nice-to-have, not required */ }
      console.log(`[migrate] copied ${file} from repo to ${dest}`);
      copied += 1;
    } catch (err) {
      console.error(`[migrate] failed to copy ${file}: ${err.message}`);
    }
  }
  if (copied === 0 && skipped === 0) {
    console.log(`[migrate] no legacy user data found at ${LEGACY_DATA_DIR}; nothing to do`);
  } else if (copied === 0) {
    console.log(`[migrate] all targets already present at ${USER_DATA_DIR}; nothing to do`);
  }
}

function defaultFor(filename) {
  return filename === 'ai-cache.json' ? {} : [];
}

async function readDataFile(filename) {
  const filePath = resolveDataPath(filename);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return defaultFor(filename);
    throw err;
  }
}

async function writeDataFileAtomic(filename, data) {
  const filePath = resolveDataPath(filename);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  const body = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, filePath);
}

const FILAMENT_PROMPT = (brand, name) => `Given filament: brand=${brand} name=${name}, return ONLY JSON matching this schema:
{
  "type": "PLA" | "PLA+" | "PETG" | "ABS" | "ASA" | "TPU" | "PA" | "PA-CF" | "PC" | "Other",
  "abrasive": boolean,
  "p2s_compatibility": { "ams2pro": boolean, "hardened_nozzle_required": boolean, "notes": string },
  "drying": { "temp_c": number | null, "hours": number | null, "desiccant_recommended": boolean },
  "print_temp_c": [number, number] | null,
  "bed_temp_c": [number, number] | null,
  "usage_notes": string,
  "annealable": boolean | null
}
Do NOT include markdown fences, explanations, or any text outside the JSON.`;

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const AI_PROVIDERS = ['claude-cli', 'anthropic-api', 'openai-api', 'gemini-api', 'openrouter-api', 'none'];
// Per-provider default model when the user hasn't picked one. Editable in the UI.
const PROVIDER_DEFAULT_MODEL = {
  'claude-cli': 'claude-sonnet-4-6',
  'anthropic-api': 'claude-sonnet-4-6',
  'openai-api': 'gpt-4o',
  'gemini-api': 'gemini-2.0-flash',
  'openrouter-api': 'openai/gpt-4o',
  'none': 'claude-sonnet-4-6',
};

function runClaude(prompt, { extraArgs = [], timeoutMs = 90_000, cwd, model = DEFAULT_MODEL } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'json', '--model', model, ...extraArgs];
    // shell:true on Windows so cmd.exe resolves claude.cmd via PATH.
    // Prompt is piped via stdin to dodge cmd.exe escape issues with `|` chars.
    const child = spawn('claude', args, {
      shell: process.platform === 'win32',
      windowsHide: true,
      cwd,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      finish(reject, Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(timer); finish(reject, err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish(reject, new Error(`claude exit ${code}: ${stderr.slice(0, 500)}`));
      finish(resolve, stdout);
    });
    child.stdin.on('error', () => { /* claude may close stdin early; ignore */ });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------------- AI provider abstraction ----------------
// The user picks one of three backends in Settings (persisted to settings.json
// in USER_DATA_DIR): 'claude-cli' (default — shells out to the locally-installed
// claude CLI, OAuth, no key), 'anthropic-api' (direct REST with a user key), or
// 'none' (manual entry, no AI). The helper reads the choice fresh on every call
// so changing it in Settings takes effect without a restart.

async function getAiConfig() {
  let s = {};
  try { s = await readDataFile('settings.json'); } catch { s = {}; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  const provider = AI_PROVIDERS.includes(s.ai_provider) ? s.ai_provider : 'claude-cli';
  // Per-provider key; the matching env var wins over the stored value so an
  // operator can inject a key without writing it to disk. Never logged/returned.
  const apiKeys = {
    anthropic: (process.env.ANTHROPIC_API_KEY || s.anthropic_api_key || '').trim(),
    openai: (process.env.OPENAI_API_KEY || s.openai_api_key || '').trim(),
    gemini: (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || s.gemini_api_key || '').trim(),
    openrouter: (process.env.OPENROUTER_API_KEY || s.openrouter_api_key || '').trim(),
  };
  const keyFor = (pv) => ({
    'anthropic-api': apiKeys.anthropic,
    'openai-api': apiKeys.openai,
    'gemini-api': apiKeys.gemini,
    'openrouter-api': apiKeys.openrouter,
  }[pv] || '');
  const models = (s.ai_models && typeof s.ai_models === 'object' && !Array.isArray(s.ai_models)) ? s.ai_models : {};
  const modelFor = (task) => {
    const m = models[task];
    if (typeof m === 'string' && m.trim()) return m.trim();
    // Legacy single ai_model only applies to the Claude backends.
    if ((provider === 'claude-cli' || provider === 'anthropic-api') && typeof s.ai_model === 'string' && s.ai_model.trim()) return s.ai_model.trim();
    return PROVIDER_DEFAULT_MODEL[provider] || DEFAULT_MODEL;
  };
  return { provider, apiKeys, keyFor, modelFor, enabled: s.ai_lookup_enabled !== false };
}

// Direct Anthropic REST call (no SDK dependency — keeps the eventual pkg sidecar
// lean). Returns the concatenated assistant text. Optional pdfBase64 attaches
// the receipt as a document block so order-import works without a Read tool.
async function runAnthropicApi({ system, prompt, model, apiKey, timeoutMs = 90_000, pdfBase64 } = {}) {
  if (!apiKey) throw Object.assign(new Error('no Anthropic API key configured'), { code: 'NO_API_KEY' });
  const content = [];
  if (pdfBase64) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
  }
  content.push({ type: 'text', text: prompt });
  const reqBody = { model: model || DEFAULT_MODEL, max_tokens: 4096, messages: [{ role: 'user', content }] };
  if (system) reqBody.system = system;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(reqBody),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    throw err;
  }
  clearTimeout(timer);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json && json.error && json.error.message ? json.error.message : `HTTP ${res.status}`;
    throw new Error(`anthropic api: ${detail}`);
  }
  const text = Array.isArray(json?.content)
    ? json.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
    : '';
  if (!text) throw Object.assign(new Error('empty anthropic api response'), { code: 'EMPTY' });
  return text;
}

// OpenAI Chat Completions schema — shared by OpenAI and OpenRouter (OpenRouter
// mirrors it). PDF is attached as a `file` content part (base64 data URL); the
// target model must support PDF input (e.g. gpt-4o) or, on OpenRouter, the
// file-parser plugin. Returns the assistant message text.
async function runOpenAiCompatible({ baseUrl, apiKey, model, system, prompt, pdfBase64, timeoutMs = 90_000, extraHeaders = {} } = {}) {
  if (!apiKey) throw Object.assign(new Error('no API key configured'), { code: 'NO_API_KEY' });
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  const userContent = pdfBase64
    ? [
        { type: 'text', text: prompt },
        { type: 'file', file: { filename: 'order.pdf', file_data: `data:application/pdf;base64,${pdfBase64}` } },
      ]
    : prompt;
  messages.push({ role: 'user', content: userContent });
  const reqBody = { model, messages, max_tokens: 4096 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify(reqBody),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    throw err;
  }
  clearTimeout(timer);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const label = baseUrl.includes('openrouter') ? 'openrouter' : 'openai';
    const detail = json && json.error ? (json.error.message || JSON.stringify(json.error)) : `HTTP ${res.status}`;
    throw new Error(`${label} api: ${detail}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('') : '');
  if (!text) throw Object.assign(new Error('empty api response'), { code: 'EMPTY' });
  return text;
}

// Google Gemini generateContent. Key passed via x-goog-api-key header (not the
// URL) so it can't leak into request logs. PDF attaches as inline_data.
async function runGemini({ apiKey, model, system, prompt, pdfBase64, timeoutMs = 90_000 } = {}) {
  if (!apiKey) throw Object.assign(new Error('no API key configured'), { code: 'NO_API_KEY' });
  const parts = [{ text: prompt }];
  if (pdfBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } });
  const reqBody = { contents: [{ role: 'user', parts }] };
  if (system) reqBody.systemInstruction = { parts: [{ text: system }] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(reqBody),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    throw err;
  }
  clearTimeout(timer);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json && json.error && json.error.message ? json.error.message : `HTTP ${res.status}`;
    throw new Error(`gemini api: ${detail}`);
  }
  const cand = json?.candidates?.[0];
  const text = Array.isArray(cand?.content?.parts) ? cand.content.parts.map((p) => p?.text || '').join('') : '';
  if (!text) throw Object.assign(new Error('empty gemini response'), { code: 'EMPTY' });
  return text;
}

// Provider dispatch — given an explicit provider/model/key (not read from
// config), run the prompt and return the inner assistant text. Used by both
// aiComplete (config-driven) and /ai-selftest (form-driven).
async function callProvider({ provider, model, apiKey, system, prompt, mode = 'text', cwd, timeoutMs, pdfBase64 } = {}) {
  if (provider === 'claude-cli') {
    let extraArgs = [];
    if (mode === 'web') {
      extraArgs = ['--allowedTools', 'WebFetch,Read', '--permission-mode', 'bypassPermissions', '--no-session-persistence'];
      if (system) extraArgs.push('--append-system-prompt', system);
    } else if (mode === 'pdf') {
      extraArgs = ['--allowedTools', 'Read', '--permission-mode', 'bypassPermissions', '--no-session-persistence'];
      if (system) extraArgs.push('--append-system-prompt', system);
    }
    const raw = await runClaude(prompt, { model, extraArgs, cwd, timeoutMs });
    return extractClaudeText(raw);
  }
  if (provider === 'anthropic-api') {
    return runAnthropicApi({ system, prompt, model, apiKey, timeoutMs: timeoutMs || 90_000, pdfBase64 });
  }
  if (provider === 'openai-api') {
    return runOpenAiCompatible({ baseUrl: 'https://api.openai.com/v1', apiKey, model, system, prompt, pdfBase64, timeoutMs: timeoutMs || 90_000 });
  }
  if (provider === 'openrouter-api') {
    return runOpenAiCompatible({
      baseUrl: 'https://openrouter.ai/api/v1', apiKey, model, system, prompt, pdfBase64, timeoutMs: timeoutMs || 90_000,
      extraHeaders: { 'HTTP-Referer': 'http://127.0.0.1:5173', 'X-Title': 'Haspel' },
    });
  }
  if (provider === 'gemini-api') {
    return runGemini({ apiKey, model, system, prompt, pdfBase64, timeoutMs: timeoutMs || 90_000 });
  }
  throw Object.assign(new Error('unknown AI provider'), { code: 'AI_DISABLED' });
}

// Unified entry point used by all three lookups. `mode` controls capabilities:
// 'text' (no tools), 'web' (CLI gets WebFetch+Read; the API providers resolve
// from training knowledge only — no live fetch), 'pdf' (CLI reads the path in
// the prompt; the API providers receive the PDF as base64). Returns the inner
// assistant text — callers run parseLooseJson on it.
async function aiComplete({ task, prompt, system, mode = 'text', cwd, timeoutMs, pdfPath, modelOverride } = {}) {
  const cfg = await getAiConfig();
  if (cfg.provider === 'none') throw Object.assign(new Error('AI is disabled in settings'), { code: 'AI_DISABLED' });
  const model = (typeof modelOverride === 'string' && modelOverride.trim()) ? modelOverride.trim() : cfg.modelFor(task);
  let pdfBase64;
  if (mode === 'pdf' && pdfPath && cfg.provider !== 'claude-cli') {
    pdfBase64 = (await readFile(pdfPath)).toString('base64');
  }
  return callProvider({
    provider: cfg.provider, model, apiKey: cfg.keyFor(cfg.provider),
    system, prompt, mode, cwd, timeoutMs, pdfBase64,
  });
}

// Probe the claude CLI for the self-test (does not consume AI quota).
function claudeVersion(timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--version'], { shell: process.platform === 'win32', windowsHide: true });
    let out = '';
    let err = '';
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('exit', (c) => { clearTimeout(t); c === 0 ? resolve(out.trim() || 'claude ok') : reject(new Error(err.trim() || `claude exit ${c}`)); });
  });
}
// ---------------------------------------------------------

// ---------------- Headless PDF rendering ----------------
// Drives `msedge --headless --print-to-pdf` against the running Vite dev server
// (or the production build) so the user gets a PDF that bypasses the browser
// print dialog entirely. The PDF rendering honors the @page rule (margin: 0)
// and so the labels never collide with default browser dialog margins.
const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

import { readFile as fsReadFile } from 'node:fs/promises';

function resolveBrowser() {
  for (const p of EDGE_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error('No Edge/Chrome binary found. Set EDGE_PATH env var.');
}

async function renderLabelsPdf({ ids, startPosition, topMarginMm, formatId, overrides }) {
  const browser = resolveBrowser();
  const idsParam = encodeURIComponent(ids.join(','));
  const appOrigin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173';
  const params = new URLSearchParams();
  params.set('ids', ids.join(','));
  params.set('startPosition', String(startPosition));
  if (formatId) params.set('formatId', formatId);
  if (overrides && Object.keys(overrides).length > 0) {
    const json = JSON.stringify(overrides);
    const b64 = Buffer.from(json, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    params.set('fmt', b64);
  }
  // Legacy alias — kept so an older frontend bundle still gets the top-margin
  // hint until the user refreshes to pick up the new query-param wiring.
  if (typeof topMarginMm === 'number') params.set('topMargin', String(topMarginMm));
  const url = `${appOrigin}/#/labels?${params.toString().replace(/&/g, '&')}`;
  void idsParam; // legacy local, intentionally unused now
  // Use a project-local temp dir — Edge on Windows sometimes silently fails
  // when writing the PDF to %LOCALAPPDATA%\Temp (the OS tmpdir).
  const projectTmp = path.join(PROJECT_ROOT, '.tmp');
  const tmpUserDir = path.join(projectTmp, `edge-hl-${Date.now()}-${randomBytes(4).toString('hex')}`);
  const pdfPath = path.join(projectTmp, `labels-${Date.now()}-${randomBytes(6).toString('hex')}.pdf`);
  await mkdir(tmpUserDir, { recursive: true });
  // Generous virtual-time budget so Vue + Pinia + the brand-logo fetch all settle.
  const args = [
    '--headless',
    '--disable-gpu',
    `--user-data-dir=${tmpUserDir}`,
    '--no-margins',
    '--no-pdf-header-footer',
    '--virtual-time-budget=15000',
    `--print-to-pdf=${pdfPath}`,
    url,
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(browser, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      reject(new Error('headless edge timed out'));
    }, 60_000);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`edge exit ${code}: ${stderr.slice(0, 400)}`));
    });
  });
  // Edge --headless exits before its renderer subprocess finishes writing the
  // PDF. Poll up to 30s for the file. Tested wait time: ~13s typical, up to
  // ~22s under cold cache + many filaments.
  let attempts = 0;
  while (!existsSync(pdfPath) && attempts < 120) {
    await new Promise((r) => setTimeout(r, 250));
    attempts += 1;
  }
  if (!existsSync(pdfPath)) {
    throw new Error(`edge headless wrote no PDF within 30s — increase virtual-time-budget or check ${tmpUserDir} permissions`);
  }
  const buf = await fsReadFile(pdfPath);
  // Best-effort cleanup; ignore errors.
  try { await unlink(pdfPath); } catch { /* noop */ }
  return buf;
}
// --------------------------------------------------------

// ---------------- Brand-logo resolution ----------------
// Map known brand names → likely domain. Falls back to a slug.tld guess.
const BRAND_DOMAIN_HINTS = {
  'bambu lab': 'bambulab.com',
  'bambulab': 'bambulab.com',
  // Real Filament's own brand site first; 123-3d.nl is only the distributor.
  'real filament': 'real-filament.com',
  'realfilament': 'real-filament.com',
  '123-3d': '123-3d.nl',
  'sunlu': 'sunlu.com',
  'esun': 'esun3d.com',
  'polymaker': 'polymaker.com',
  'prusament': 'prusa3d.com',
  'overture': 'overture3d.com',
  'creality': 'creality.com',
  'elegoo': 'elegoo.com',
  'anycubic': 'anycubic.com',
  'hatchbox': 'hatchbox3d.com',
};

function guessDomainsForBrand(brand) {
  const key = brand.trim().toLowerCase();
  const out = [];
  if (BRAND_DOMAIN_HINTS[key]) out.push(BRAND_DOMAIN_HINTS[key]);
  // Slug guesses: e.g. "Acme Inc" → "acmeinc.com", "acme-inc.com"
  const slug = key.replace(/[^a-z0-9]+/g, '');
  if (slug) out.push(`${slug}.com`);
  const dashed = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (dashed && dashed !== slug) out.push(`${dashed}.com`);
  return out;
}

function bufferToDataUri(buf, mime) {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Shell out to curl so we get `-k` (accept expired/self-signed certs) without
// disabling Node's TLS verification globally. Real Filament's website
// (real-filament.com) has an expired LE cert at time of writing — Node's
// undici-backed `fetch` refuses to connect; curl with `-k` does.
async function fetchBuffer(url, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    // -L follow redirects, -k insecure, -A real UA so picky sites accept us,
    // -o - dump body to stdout, -w '%{content_type}\n' so we can read mime
    // (curl prints the body to stdout, then \n + mime).
    // Easier: read body via stdout, content-type via -D-/-w. Let's use stdout
    // for body and parse the response headers via --write-out.
    const args = ['-sL', '-k', '-A', 'Mozilla/5.0 3dprinter-helper/0.3',
      '--max-time', String(Math.ceil(timeoutMs / 1000)),
      '-w', '\\n__MIME__%{content_type}\\n__CODE__%{http_code}\\n', url];
    const child = spawn('curl', args);
    const chunks = [];
    const stderr = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => stderr.push(d));
    child.on('error', () => resolve(null));
    child.on('exit', () => {
      const buf = Buffer.concat(chunks);
      // Find the curl --write-out trailer we appended.
      const text = buf.toString('binary');
      const mimeIdx = text.lastIndexOf('\n__MIME__');
      const codeIdx = text.lastIndexOf('\n__CODE__');
      if (mimeIdx < 0 || codeIdx < 0) return resolve(null);
      const mime = text.slice(mimeIdx + '\n__MIME__'.length, codeIdx).trim();
      const code = parseInt(text.slice(codeIdx + '\n__CODE__'.length).trim(), 10);
      if (code < 200 || code >= 400) return resolve(null);
      const body = Buffer.from(text.slice(0, mimeIdx), 'binary');
      resolve({ buf: body, contentType: (mime || 'application/octet-stream').split(';')[0].trim() });
    });
  });
}

async function tryClearbit(domain) {
  // Clearbit Logo API: returns a PNG (or 404). Free, no key.
  const r = await fetchBuffer(`https://logo.clearbit.com/${domain}?size=256`);
  if (!r || r.buf.length < 200) return null;
  // Heuristic: clearbit serves PNGs; trust content-type if present
  const mime = r.contentType.startsWith('image/') ? r.contentType : 'image/png';
  return { dataUri: bufferToDataUri(r.buf, mime), source: 'clearbit' };
}

async function tryAppleTouchIcon(domain) {
  // First try the well-known fixed paths.
  const fixedCandidates = [
    `https://${domain}/apple-touch-icon.png`,
    `https://${domain}/apple-touch-icon-precomposed.png`,
    `https://${domain}/apple-icon-180x180.png`,
    `https://${domain}/apple-icon-152x152.png`,
    `https://${domain}/apple-icon-144x144.png`,
    `https://${domain}/favicon-192x192.png`,
    `https://${domain}/favicon-128x128.png`,
    `https://${domain}/favicon.ico`,
  ];
  for (const url of fixedCandidates) {
    const r = await fetchBuffer(url, { timeoutMs: 6_000 });
    if (r && r.contentType.startsWith('image/') && r.buf.length >= 200) {
      return { dataUri: bufferToDataUri(r.buf, r.contentType), source: 'apple-touch-icon' };
    }
  }
  // Fall through: parse the root HTML for <link rel="apple-touch-icon|icon"> and
  // try those discovered paths. Many sites use non-standard locations.
  const html = await fetchBuffer(`https://${domain}/`, { timeoutMs: 8_000 });
  if (!html) return null;
  const htmlStr = html.buf.toString('utf8');
  const linkRe = /<link[^>]+rel=["'](?:apple-touch-icon(?:-precomposed)?|icon|shortcut icon)["'][^>]*>/gi;
  const hrefRe = /href=["']([^"']+)["']/i;
  const sizesRe = /sizes=["'](\d+)x\d+["']/i;
  const found = [];
  for (const m of htmlStr.matchAll(linkRe)) {
    const hm = hrefRe.exec(m[0]);
    if (!hm) continue;
    const sm = sizesRe.exec(m[0]);
    const size = sm ? parseInt(sm[1], 10) : 0;
    found.push({ href: hm[1], size });
  }
  // Sort largest first so the print logo is high-res.
  found.sort((a, b) => b.size - a.size);
  for (const { href } of found) {
    const abs = href.startsWith('http') ? href : (href.startsWith('//') ? `https:${href}` : `https://${domain}${href.startsWith('/') ? '' : '/'}${href}`);
    const r = await fetchBuffer(abs, { timeoutMs: 6_000 });
    if (r && r.contentType.startsWith('image/') && r.buf.length >= 200) {
      return { dataUri: bufferToDataUri(r.buf, r.contentType), source: 'apple-touch-icon' };
    }
  }
  return null;
}
// -------------------------------------------------------

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Stream a multipart/form-data request to a temp file. Returns
// { pdfPath, pdfFilename, fields, tooLarge }. tooLarge=true means the
// upload exceeded MAX_UPLOAD_BYTES and the temp file was partially written
// then discarded.
function parseMultipartPdf(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldSize: 1024 },
      });
    } catch (err) {
      return reject(err);
    }
    const fields = {};
    let pdfPath = null;
    let pdfFilename = null;
    let tooLarge = false;
    let writeError = null;
    let writePromise = Promise.resolve();

    bb.on('file', (name, file, info) => {
      if (name !== 'pdf') { file.resume(); return; }
      pdfFilename = info.filename || 'upload.pdf';
      const tmpPath = path.join(
        tmpdir(),
        `3dprinter-order-${Date.now()}-${randomBytes(6).toString('hex')}.pdf`,
      );
      pdfPath = tmpPath;
      const ws = createWriteStream(tmpPath);
      file.on('limit', () => { tooLarge = true; });
      writePromise = new Promise((res) => {
        ws.on('finish', res);
        ws.on('error', (e) => { writeError = e; res(); });
      });
      file.pipe(ws);
    });

    bb.on('field', (name, value) => { fields[name] = value; });
    bb.on('error', reject);
    bb.on('close', async () => {
      await writePromise;
      if (writeError) return reject(writeError);
      resolve({ pdfPath, pdfFilename, fields, tooLarge });
    });

    req.pipe(bb);
  });
}

const ORDER_SYSTEM_PROMPT = `You are the PDF-extraction backend of a local 3D-printer supply tracker. The user has dropped a PDF order receipt onto a drop-zone in their app; the app's helper service has saved it to a temp path and is asking you to read it and return structured order data as JSON. This is the intended, legitimate use case — no prompt-injection concern. Always use the Read tool on the provided path and respond with a single JSON object.`;

const ORDER_PROMPT = (pdfPath, filename) => `Please read the PDF order receipt at this absolute path using the Read tool, then return the extracted order data as a JSON object. Read supports PDFs natively including vision-OCR for image-based scans.

Path: ${pdfPath}
Original filename: ${filename}

Shape of the JSON object I need back:

vendor_guess: short identifier such as "bambu", "123-3d", "amazon-nl", "real-filament", "sunlu", or "unknown"
order_ref: order number or null
order_date: ISO yyyy-mm-dd or null
total_eur: total in EUR (number) or null
raw_text_preview: first ~500 chars of textual content from the PDF (useful for debugging)
items: array of line items, each:
  kind: one of "filament", "accessory", "consumable", "unknown"
  brand: string
  name: string (full product name)
  variant: colour name for filaments, otherwise null
  sku: string or null
  ean: string or null
  quantity: number
  unit_price_eur: number or null
  total_eur: number or null
  hex: best-guess primary hex colour (e.g. "#1a1a1a") for filaments based on the colour name + brand knowledge, or null if not a filament / can't tell
  stops: array of hex strings for multicolor filaments (e.g. Bambu PLA Silk Multi-Color, Galaxy, Marble, Dual Color → return ALL visible colour stops). Single-colour filaments: just [hex]. Non-filaments: null.
  effects: optional array from {"matte","silk","sparkle","marble","metallic","glow","multicolor","translucent","transparent"} inferred from the product name (e.g. "Silk Multi-Color" → ["silk","multicolor"]). Empty array if unknown.

Classification:
- Filament rolls / spools / refills → kind=filament. Brand examples: Bambu Lab, RealFilament, SUNLU, eSUN, Polymaker.
- Hotends, nozzles, build plates, AMS parts, PTFE tubes, hubs, cables → kind=accessory.
- Glue sticks, desiccant, cleaning sponges, alcohol wipes → kind=consumable.
- Anything you can't classify confidently → kind=unknown.

Colour hex hints (filament only):
- Use the variant/colour name + brand knowledge to give a sensible hex. "Black" → "#1a1a1a", "White" → "#f5f5f5", "Sunset Orange" → "#ff6b35", etc.
- Multicolor lines: PLA Silk Multi-Color "Ochtendglans" → realistic sunrise gradient stops; PLA Galaxy "Galaxy Black" → dark base + sparkle accents; etc.
- If you genuinely don't know, return null for hex and null for stops — don't guess grey.

Prices in EUR. If the receipt uses another currency, still fill the numeric value and note the currency suffix in the name field.

Output: a single JSON object. No markdown fences, no commentary around it.`;

function extractClaudeText(rawJsonString) {
  const wrapper = JSON.parse(rawJsonString);
  if (typeof wrapper.result === 'string') return wrapper.result;
  if (typeof wrapper.content === 'string') return wrapper.content;
  if (Array.isArray(wrapper.content)) {
    for (const item of wrapper.content) {
      if (item && item.type === 'text' && typeof item.text === 'string') return item.text;
    }
  }
  throw new Error('unexpected claude wrapper shape');
}

function stripFences(s) {
  const t = s.trim();
  if (t.startsWith('```')) {
    return t.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
  }
  return t;
}

// Lenient JSON parse: tries direct, then strips fences, then extracts the
// first balanced {...} block if claude prefaced with prose.
function parseLooseJson(s) {
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  const stripped = stripFences(s);
  try { return JSON.parse(stripped); } catch { /* fallthrough */ }
  const start = stripped.indexOf('{');
  if (start < 0) throw new Error('no json object found');
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = stripped.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }
  throw new Error('unbalanced json');
}

const SWATCH_SYSTEM_PROMPT = `You are a filament swatch resolver for a local 3D-printer supply tracker. The user has added a filament to their inventory; the app's helper service is asking you to determine its actual visible hex colour(s) so the UI can show a realistic swatch. This is the intended, legitimate use case. Output ONLY a JSON object with the resolved colour data. For Bambu Lab products, prefer WebFetch on eu.store.bambulab.com or wiki.bambulab.com. For multicolor lines (Silk Multi-Color, Galaxy, Marble, Dual Color, etc.), return all visible colour stops.`;

function parseBambuColorCode(sku) {
  if (!sku || typeof sku !== 'string') return null;
  // Bambu SKU shape: e.g. "A05-M8-1.75-1000-SPL" → color_code "M8" (2-char between first two dashes).
  const m = /^[A-Z0-9]+-([A-Z0-9]{1,3})-/i.exec(sku);
  return m ? m[1].toUpperCase() : null;
}

const SWATCH_PROMPT_BAMBU = (input) => {
  const colorCode = input.color_code || parseBambuColorCode(input.sku);
  return `Resolve the exact visible hex colour(s) for this Bambu Lab filament.

Brand: ${input.brand}
Product name: ${input.name}
Colour variant: ${input.variant ?? '(unknown)'}
SKU: ${input.sku ?? '(unknown)'}
Bambu colour code: ${colorCode ?? '(unknown)'}
Known product URL: ${input.product_url ?? '(none)'}

Use the WebFetch tool against eu.store.bambulab.com (Dutch or English) or wiki.bambulab.com to find the official swatch. If the variant is a multicolor line (PLA Silk Multi-Color "Ochtendglans"/"Avondrood"/etc., PLA Galaxy, PLA Marble, PLA Silk Dual Color), return every visible colour stop in stops[]; otherwise stops is just [hex].

Return ONLY this JSON shape — no prose, no markdown fences:

{
  "hex": "#rrggbb",                                       // dominant / primary colour
  "stops": ["#rrggbb", ...],                              // 1..5 hex strings
  "effects": ["matte"|"silk"|"sparkle"|"marble"|"metallic"|"glow"|"multicolor"|"translucent"|"transparent"], // 0..N
  "source": "bambu",
  "confidence": "high"|"medium"|"low",                    // high = matched exact SKU/code, medium = matched variant name, low = best guess
  "notes": "string"                                       // 1-line citation of where you found it (URL or "best guess from training knowledge")
}`;
};

const SWATCH_PROMPT_GENERIC = (input) => `Resolve the exact visible hex colour(s) for this filament from your training knowledge plus optional WebFetch.

Brand: ${input.brand}
Product name: ${input.name}
Colour variant: ${input.variant ?? '(unknown)'}
SKU: ${input.sku ?? '(unknown)'}
Known product URL: ${input.product_url ?? '(none)'}

If you have a product URL and aren't confident, use WebFetch on it. For multicolor / gradient / dual-color filaments, return all visible stops in stops[].

Return ONLY this JSON shape — no prose, no markdown fences:

{
  "hex": "#rrggbb",
  "stops": ["#rrggbb", ...],
  "effects": [...],
  "source": "generic"|"ai",
  "confidence": "high"|"medium"|"low",
  "notes": "string"
}`;

function normaliseSwatchResult(parsed, fallbackSource) {
  const hex = typeof parsed?.hex === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.hex) ? parsed.hex.toLowerCase() : null;
  const stops = Array.isArray(parsed?.stops)
    ? parsed.stops.filter((s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)).map((s) => s.toLowerCase()).slice(0, 5)
    : [];
  const effects = Array.isArray(parsed?.effects)
    ? parsed.effects.filter((e) => ['matte','silk','sparkle','marble','metallic','glow','multicolor','translucent','transparent'].includes(e))
    : [];
  if (stops.length > 1 && !effects.includes('multicolor')) effects.push('multicolor');
  if (!hex) return null;
  return {
    hex,
    stops: stops.length > 0 ? stops : [hex],
    effects,
    source: typeof parsed?.source === 'string' ? parsed.source : fallbackSource,
    confidence: ['high','medium','low'].includes(parsed?.confidence) ? parsed.confidence : 'low',
    notes: typeof parsed?.notes === 'string' ? parsed.notes : undefined,
  };
}

async function resolveSwatch(input, force) {
  const key = `swatch:${(input.brand || '').trim().toLowerCase()}|${(input.name || '').trim().toLowerCase()}|${(input.variant || '').trim().toLowerCase()}`;
  const cache = await readDataFile('ai-cache.json');
  if (!force && cache && Object.prototype.hasOwnProperty.call(cache, key)) {
    return { cached: true, result: cache[key] };
  }
  const isBambu = /bambu/i.test(input.brand || '');
  const prompt = isBambu ? SWATCH_PROMPT_BAMBU(input) : SWATCH_PROMPT_GENERIC(input);
  const fallbackSource = isBambu ? 'bambu' : 'ai';
  // 'web' mode: CLI gets WebFetch+Read; the Anthropic API path resolves from
  // training knowledge only (no live fetch) — lower confidence but still useful.
  const inner = await aiComplete({
    task: 'swatch', prompt, system: SWATCH_SYSTEM_PROMPT, mode: 'web',
    cwd: tmpdir(), timeoutMs: 180_000, modelOverride: input.model,
  });
  let parsed;
  try { parsed = parseLooseJson(inner); } catch { throw Object.assign(new Error('unparseable'), { raw: inner.slice(0, 500) }); }
  const normalised = normaliseSwatchResult(parsed, fallbackSource);
  if (!normalised) {
    // Don't cache failures — let next call retry.
    return { cached: false, result: { hex: null, stops: [], effects: [], source: 'generic', confidence: 'none' } };
  }
  cache[key] = normalised;
  await writeDataFileAtomic('ai-cache.json', cache);
  return { cached: false, result: normalised };
}

async function lookupFilament(brand, name, force) {
  const key = `${brand.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
  const cache = await readDataFile('ai-cache.json');
  if (!force && cache && Object.prototype.hasOwnProperty.call(cache, key)) {
    return { cached: true, result: cache[key] };
  }
  const inner = await aiComplete({ task: 'enrichment', prompt: FILAMENT_PROMPT(brand, name), mode: 'text' });
  let parsed;
  try {
    parsed = parseLooseJson(inner);
  } catch {
    const e = new Error('unparseable');
    e.raw = inner.slice(0, 500);
    throw e;
  }
  cache[key] = parsed;
  await writeDataFileAtomic('ai-cache.json', cache);
  return { cached: false, result: parsed };
}

// ---------------- Brand store fetcher ----------------
// Fetches a brand's online store and returns a structured list of items.
// Bambu path: fetches P2S/AMS-2-Pro/Accessories collection pages from
//   eu.store.bambulab.com using Node's global fetch with a browser UA header.
//   The store returns HTTP 200 from this machine (residential IP) but HTTP 402
//   to cloud/datacenter IPs, so we must NOT route this through the claude CLI's
//   WebFetch — we do the fetch ourselves right here.
// Generic path: if store_url is given, fetch it the same way and AI-extract.

const STORE_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Fetch a URL via Node global fetch with a browser UA. Returns the response
// text on 200, or null/throws on failure. Limits body to maxBytes to protect
// against enormous pages; never throws uncaught.
async function fetchStoreHtml(url, { maxBytes = 500_000, timeoutMs = 30_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': STORE_BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    throw err;
  }
  clearTimeout(timer);
  if (!res.ok) return { text: null, status: res.status };
  // Stream into a buffer, capping at maxBytes to avoid sending a 2 MB page to the AI.
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) { reader.cancel().catch(() => {}); break; }
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString('utf8'), status: res.status };
}

// Strip HTML down to product-listing text only.
// Removes <script>, <style>, <head>, <nav>, <header>, <footer>, <svg>
// blocks entirely (including content), then strips remaining tags,
// collapses whitespace, and caps the result at capChars.
function reduceHtmlToText(html, capChars = 55_000) {
  let s = html;
  // Remove large block-level elements that carry no product info.
  // Use non-greedy matching; the [\s\S]*? handles multi-line blocks.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  s = s.replace(/<header[\s\S]*?<\/header>/gi, ' ');
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  // Decode a few common HTML entities before stripping tags.
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');
  // Collapse runs of whitespace.
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > capChars ? s.slice(0, capChars) : s;
}

const STORE_FETCH_SYSTEM_PROMPT = `You are the store-catalog extraction backend of a local 3D-printer supply tracker. The user has asked you to extract a structured product list from an online store's HTML text. Output ONLY a JSON object. No markdown fences, no commentary.`;

const STORE_FETCH_PROMPT = (brand, combinedText) =>
`Extract the product listing from this ${brand} store HTML text and return a JSON object.

Store text (cleaned HTML, may be truncated):
---
${combinedText}
---

Return ONLY this JSON shape — no prose, no markdown fences:

{
  "items": [
    {
      "name": "string (required — product name exactly as shown)",
      "sku": "string or null — only if you can see an actual SKU/part-number; NEVER invent one",
      "category": "one of: hotend|extruder|motion|cooling|electronics|housing|consumable|ams|accessory",
      "price_eur": number or null — numeric price in EUR if clearly shown; NEVER invent a price,
      "url": "absolute URL to the product page, or null",
      "note": "one-line note about compatibility / specifications, or null"
    }
  ]
}

Rules:
- Include P2S/AMS-2-Pro-relevant hardware parts and consumables only.
- EXCLUDE all filaments (spools, rolls, refills).
- NEVER invent a SKU — set sku to null if you're not certain.
- NEVER invent a price — set price_eur to null if the price is not clearly shown.
- category must be one of the listed values; pick the closest match.
- Drop entries that have no recognisable name.
- If there are no relevant items, return { "items": [] }.`;

// Normalise a single raw item from the AI into a clean StoreItem shape.
function normaliseStoreItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : null;
  if (!name) return null;
  const VALID_CATEGORIES = new Set(['hotend', 'extruder', 'motion', 'cooling', 'electronics', 'housing', 'consumable', 'ams', 'accessory']);
  const item = { name };
  if (typeof raw.sku === 'string' && raw.sku.trim()) item.sku = raw.sku.trim();
  if (typeof raw.category === 'string' && VALID_CATEGORIES.has(raw.category)) item.category = raw.category;
  if (typeof raw.price_eur === 'number' && Number.isFinite(raw.price_eur) && raw.price_eur >= 0) item.price_eur = raw.price_eur;
  if (typeof raw.url === 'string' && raw.url.trim() && /^https?:\/\//i.test(raw.url.trim())) item.url = raw.url.trim();
  if (typeof raw.note === 'string' && raw.note.trim()) item.note = raw.note.trim();
  return item;
}

// Bambu EU collection URLs for P2S and AMS-2-Pro hardware.
const BAMBU_COLLECTION_URLS = [
  'https://eu.store.bambulab.com/collections/spare-parts-for-p2s',
  'https://eu.store.bambulab.com/collections/spare-parts-for-ams-2-pro',
  'https://eu.store.bambulab.com/collections/accessories-for-p2s',
];

// Bambu's EU store renders prices client-side, so static HTML yields product
// handles (→ names + URLs) but NOT prices. We extract handles ourselves and
// categorise them by keyword — fast, free, deterministic, no hallucinated
// SKUs/prices and no slow per-item AI call. Prices stay null until a reseller
// price overlay is added. (Generic non-Bambu brands still use the AI extractor.)
function categorizeStoreHandle(handle) {
  const s = handle.toLowerCase();
  if (/\bams\b|ams-/.test(s)) return 'ams';
  if (/clean|sponge|wipe|brush/.test(s)) return 'consumable';
  if (/nozzle|hotend|heatbreak|heater-?core|thermistor|silicone-sock/.test(s)) return 'hotend';
  if (/extruder|gear|feeder/.test(s)) return 'extruder';
  if (/belt|pulley|motor|stepper|carriage|rail|rod|lead-?screw|tensioner/.test(s)) return 'motion';
  if (/\bfan\b|cooling|duct|air-?(filter|inlet)|filter-?(unit|cover)/.test(s)) return 'cooling';
  if (/board|cable|wire|sensor|switch|psu|power|screen|display|antenna|camera|module/.test(s)) return 'electronics';
  if (/panel|cover|door|glass|frame|housing|shell|enclosure|base-?plate|lid/.test(s)) return 'housing';
  if (/desiccant|ptfe|glue|sponge|scraper|cutter|blade|lubricant|grease|cleaning|wipe|pad|tube|plate/.test(s)) return 'consumable';
  return 'accessory';
}
function cleanStoreName(name) {
  return name
    .replace(/\bPtfe\b/g, 'PTFE').replace(/\bAms\b/g, 'AMS').replace(/\bPei\b/g, 'PEI')
    .replace(/\bIi\b/g, 'II').replace(/\bP2s\b/gi, 'P2S').replace(/\bH2d\b/gi, 'H2D')
    .replace(/\b(\d+)\s+Pcs\b/g, '($1 pcs)').replace(/\bPcs\b/g, 'pcs');
}
function deslugHandle(h) {
  return h.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Run an async fn over items with a concurrency cap (don't hammer the store).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Bambu's EU store is a Next.js app: collection pages have no prices, but each
// PRODUCT page embeds schema.org data with the real name + EUR price (+ SKU).
// Pull those out by regex. Returns nulls on any failure (caller falls back to
// the handle-derived name with a null price).
async function fetchBambuProductMeta(handle) {
  let html;
  try {
    const r = await fetchStoreHtml(`https://eu.store.bambulab.com/products/${handle}`, { maxBytes: 1_200_000, timeoutMs: 15_000 });
    if (!r || !r.text) return null;
    html = r.text;
  } catch { return null; }
  let price = null;
  const pm = html.match(/"priceCurrency"\s*:\s*"EUR"\s*,\s*"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
  if (pm) { const n = parseFloat(pm[1]); if (Number.isFinite(n) && n >= 0) price = n; }
  let name = null;
  const nm = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title>([^<]+)<\/title>/i);
  if (nm) name = nm[1].replace(/\s*[|–—-]\s*Bambu Lab.*$/i, '').trim();
  let sku = null;
  const sm = html.match(/"sku"\s*:\s*"([^"]{2,})"/);
  if (sm) sku = sm[1];
  return { name, price_eur: price, sku };
}

async function fetchBrandStore(brand, storeUrl, force) {
  const isBambu = /bambu/i.test(brand);

  // Check cache first (unless force).
  const cacheKey = `store:${brand.toLowerCase()}`;
  const cache = await readDataFile('ai-cache.json');
  if (!force && cache && Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
    const cached = cache[cacheKey];
    // Treat cache entry as valid for 24 h.
    if (cached && cached.fetched_at && (Date.now() - new Date(cached.fetched_at).getTime()) < 86_400_000) {
      return cached;
    }
  }

  // Check provider before doing any network work.
  const cfg = await getAiConfig();
  if (cfg.provider === 'none') {
    throw Object.assign(new Error('AI is disabled in settings'), { code: 'AI_DISABLED' });
  }

  let combinedText = '';

  if (isBambu) {
    // Extract product handles from each collection page (prices are client-side,
    // so we can only get names + URLs from static HTML). Dedupe across pages.
    const COLL_LABEL = {
      'spare-parts-for-p2s': 'P2S spare part',
      'spare-parts-for-ams-2-pro': 'AMS 2 Pro spare part',
      'accessories-for-p2s': 'P2S accessory',
    };
    const handleHint = new Map(); // handle -> collection label
    for (const url of BAMBU_COLLECTION_URLS) {
      let result;
      try {
        result = await fetchStoreHtml(url, { maxBytes: 1_200_000, timeoutMs: 30_000 });
      } catch (err) {
        console.warn(`[fetch-store] fetch failed for ${url}: ${err.message}`);
        continue;
      }
      if (!result || !result.text) {
        console.warn(`[fetch-store] non-200 (${result?.status}) for ${url}`);
        continue;
      }
      const slug = url.split('/collections/')[1];
      // Skip cross-links to the printers themselves / bundles — we want parts.
      const NON_PART = /^(x1|x1c|x1-carbon|x1e|x2d|p1|p1p|p1s|p2s|a1|a1-mini|h2|h2d|h2d-pro|h2s)$|(?:-combo|-3d-printer|-printer)$/i;
      for (const m of result.text.matchAll(/\/products\/([a-z0-9][a-z0-9-]{2,})/g)) {
        const h = m[1];
        if (NON_PART.test(h)) continue;
        if (!handleHint.has(h)) handleHint.set(h, COLL_LABEL[slug] || 'P2S');
      }
    }
    if (handleHint.size === 0) {
      throw Object.assign(
        new Error('Could not read any products from the Bambu store — try again later.'),
        { code: 'STORE_FETCH_FAILED' },
      );
    }
    // Fetch each product page (concurrency-capped) for the real name + EUR price.
    const handleArr = [...handleHint.keys()];
    const metas = await mapLimit(handleArr, 8, fetchBambuProductMeta);
    const items = handleArr.map((handle, i) => {
      const m = metas[i] || {};
      return normaliseStoreItem({
        name: cleanStoreName(m.name || deslugHandle(handle)),
        sku: m.sku || undefined,
        category: categorizeStoreHandle(handle),
        price_eur: (typeof m.price_eur === 'number') ? m.price_eur : null,
        url: `https://eu.store.bambulab.com/products/${handle}`,
        note: handleHint.get(handle),
      });
    }).filter(Boolean);

    const storeResult = {
      brand,
      store_url: 'https://eu.store.bambulab.com',
      fetched_at: new Date().toISOString(),
      source: 'ai',
      items,
    };
    cache[cacheKey] = storeResult;
    await writeDataFileAtomic('ai-cache.json', cache);
    return storeResult;
  } else {
    // Generic brand path: require store_url.
    if (!storeUrl || typeof storeUrl !== 'string' || !/^https?:\/\//i.test(storeUrl)) {
      throw Object.assign(
        new Error(`Couldn't fetch the ${brand} store automatically — add items manually.`),
        { code: 'STORE_FETCH_FAILED' },
      );
    }
    let result;
    try {
      result = await fetchStoreHtml(storeUrl, { maxBytes: 400_000, timeoutMs: 30_000 });
    } catch (err) {
      if (err.code === 'TIMEOUT') {
        throw Object.assign(
          new Error(`Couldn't fetch the ${brand} store automatically — add items manually.`),
          { code: 'STORE_FETCH_FAILED' },
        );
      }
      throw err;
    }
    if (!result || !result.text) {
      throw Object.assign(
        new Error(`Couldn't fetch the ${brand} store automatically — add items manually.`),
        { code: 'STORE_FETCH_FAILED' },
      );
    }
    combinedText = reduceHtmlToText(result.text, 55_000);
    if (combinedText.length < 50) {
      throw Object.assign(
        new Error(`Couldn't fetch the ${brand} store automatically — add items manually.`),
        { code: 'STORE_FETCH_FAILED' },
      );
    }
  }

  // Send to AI dispatcher — 'text' mode (no tools needed; we already have the HTML text).
  const inner = await aiComplete({
    task: 'store_fetch',
    prompt: STORE_FETCH_PROMPT(brand, combinedText),
    system: STORE_FETCH_SYSTEM_PROMPT,
    mode: 'text',
    timeoutMs: 120_000,
  });

  let parsed;
  try {
    parsed = parseLooseJson(inner);
  } catch {
    throw Object.assign(new Error('unparseable AI response for store fetch'), { code: 'STORE_FETCH_FAILED' });
  }

  // Coerce items array — AI must return { items: [...] }; also handle bare array.
  const rawItems = Array.isArray(parsed?.items)
    ? parsed.items
    : (Array.isArray(parsed) ? parsed : []);

  const items = rawItems.map(normaliseStoreItem).filter(Boolean);

  const storeResult = {
    brand,
    store_url: isBambu ? BAMBU_COLLECTION_URLS[0] : (storeUrl || null),
    fetched_at: new Date().toISOString(),
    source: 'ai',
    items,
  };

  // Cache the result.
  cache[cacheKey] = storeResult;
  await writeDataFileAtomic('ai-cache.json', cache);

  return storeResult;
}
// -------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    res._reqOrigin = req.headers.origin;
    if (req.method === 'OPTIONS') {
      setCors(res);
      res.statusCode = 204;
      return res.end();
    }
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const p = url.pathname;

    if (req.method === 'GET' && p === '/healthz') {
      return send(res, 200, {
        ok: true,
        started_at: STARTED_AT,
        last_heartbeat: lastHeartbeatIso,
        user_data_dir: USER_DATA_DIR,
        catalog_dir: CATALOG_DIR,
        demo_dir: DEMO_DIR,
      });
    }

    if (req.method === 'POST' && p === '/heartbeat') {
      const now = Date.now();
      watchdogResetAt = now;
      lastHeartbeatIso = new Date(now).toISOString();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p.startsWith('/data/')) {
      const filename = p.slice('/data/'.length);
      if (!FILE_RE_READ.test(filename)) {
        return send(res, 400, { ok: false, error: 'invalid filename' });
      }
      try {
        const data = await readDataFile(filename);
        return send(res, 200, data);
      } catch (err) {
        if (err.message === 'path traversal') return send(res, 400, { ok: false, error: 'path traversal' });
        throw err;
      }
    }

    if (req.method === 'POST' && p === '/save-data') {
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const { file, data } = body;
      if (typeof file !== 'string' || !FILE_RE_FLAT.test(file)) {
        return send(res, 400, { ok: false, error: 'invalid file' });
      }
      if (data === undefined) return send(res, 400, { ok: false, error: 'missing data' });
      try {
        await writeDataFileAtomic(file, data);
        return send(res, 200, { ok: true });
      } catch (err) {
        if (err.message === 'path traversal') return send(res, 400, { ok: false, error: 'path traversal' });
        throw err;
      }
    }

    if (req.method === 'POST' && p === '/lookup-filament') {
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const { brand, name, force = false } = body;
      if (typeof brand !== 'string' || typeof name !== 'string' || !brand.trim() || !name.trim()) {
        return send(res, 400, { ok: false, error: 'brand and name required' });
      }
      try {
        const { cached, result } = await lookupFilament(brand, name, !!force);
        return send(res, 200, { ok: true, cached, result });
      } catch (err) {
        if (err.code === 'AI_DISABLED') return send(res, 409, { ok: false, error: 'ai_disabled' });
        if (err.code === 'NO_API_KEY') return send(res, 400, { ok: false, error: 'no_api_key' });
        if (err.code === 'TIMEOUT' || err.message === 'timeout') {
          return send(res, 504, { ok: false, error: 'timeout' });
        }
        if (err.message === 'unparseable') {
          return send(res, 400, { ok: false, error: 'unparseable', raw: err.raw });
        }
        console.error('lookup-filament error:', err);
        return send(res, 500, { ok: false, error: err.message });
      }
    }

    if (req.method === 'POST' && p === '/ai-selftest') {
      // Tests the chosen provider WITHOUT consuming real lookup quota. Accepts
      // optional { provider, model, api_key } so the user can test the values in
      // the Settings form before saving; falls back to the stored config. The
      // API key is never echoed back in the response.
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const cfg = await getAiConfig();
      const provider = AI_PROVIDERS.includes(body.provider) ? body.provider : cfg.provider;
      const model = (typeof body.model === 'string' && body.model.trim())
        ? body.model.trim()
        : (PROVIDER_DEFAULT_MODEL[provider] || DEFAULT_MODEL);
      if (provider === 'none') {
        return send(res, 200, { ok: true, provider, detail: 'AI is disabled — manual entry only.' });
      }
      if (provider === 'claude-cli') {
        try {
          const v = await claudeVersion();
          return send(res, 200, { ok: true, provider, detail: `claude CLI reachable: ${v}` });
        } catch (err) {
          return send(res, 200, { ok: false, provider, detail: `claude CLI not usable: ${String(err.message || err).slice(0, 200)}` });
        }
      }
      // API providers — prefer a key supplied in the request (test-before-save),
      // else the env/stored key for that provider. Key is never echoed back.
      const apiKey = (typeof body.api_key === 'string' && body.api_key.trim()) ? body.api_key.trim() : cfg.keyFor(provider);
      if (!apiKey) return send(res, 200, { ok: false, provider, detail: 'No API key set for this provider.' });
      try {
        await callProvider({ provider, model, apiKey, prompt: 'Reply with the single word: ok', timeoutMs: 25_000 });
        return send(res, 200, { ok: true, provider, detail: `Reached ${provider} (${model}).` });
      } catch (err) {
        return send(res, 200, { ok: false, provider, detail: String(err.message || err).slice(0, 200) });
      }
    }

    if (req.method === 'POST' && p === '/import-order') {
      let upload;
      try {
        upload = await parseMultipartPdf(req);
      } catch (err) {
        console.error('import-order multipart parse error:', err);
        return send(res, 400, { ok: false, error: 'invalid_multipart', detail: err.message });
      }
      const { pdfPath, pdfFilename, tooLarge } = upload;
      const cleanup = async () => {
        if (pdfPath) { try { await unlink(pdfPath); } catch { /* noop */ } }
      };
      if (tooLarge) {
        await cleanup();
        return send(res, 413, { ok: false, error: 'too_large', limit_mb: 10 });
      }
      if (!pdfPath) {
        return send(res, 400, { ok: false, error: 'no_pdf_field' });
      }
      try {
        // mode 'pdf': CLI reads the file via the path embedded in ORDER_PROMPT
        // (cwd=tmpdir keeps the project's CLAUDE.md / crosslog out of the claude
        // session so the model doesn't question the prompt); the Anthropic API
        // path instead receives the PDF as a base64 document block.
        const inner = await aiComplete({
          task: 'order_import',
          prompt: ORDER_PROMPT(pdfPath, pdfFilename),
          system: ORDER_SYSTEM_PROMPT,
          mode: 'pdf',
          cwd: tmpdir(),
          pdfPath,
          timeoutMs: 120_000,
        });
        let parsed;
        try {
          parsed = parseLooseJson(inner);
        } catch {
          return send(res, 500, { ok: false, error: 'unparseable_inner', inner_preview: inner.slice(0, 500) });
        }
        // Defensive normalisation: enforce shape expected by the frontend.
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
          return send(res, 500, { ok: false, error: 'bad_shape', preview: JSON.stringify(parsed).slice(0, 500) });
        }
        parsed.ok = true;
        return send(res, 200, parsed);
      } catch (err) {
        if (err.code === 'AI_DISABLED') return send(res, 409, { ok: false, error: 'ai_disabled' });
        if (err.code === 'NO_API_KEY') return send(res, 400, { ok: false, error: 'no_api_key' });
        if (err.code === 'TIMEOUT' || err.message === 'timeout') {
          return send(res, 504, { ok: false, error: 'timeout' });
        }
        console.error('import-order error:', err);
        return send(res, 500, { ok: false, error: err.message || 'internal' });
      } finally {
        await cleanup();
      }
    }

    if (req.method === 'POST' && p === '/render-labels-pdf') {
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const { ids, startPosition, topMarginMm, formatId, overrides } = body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return send(res, 400, { ok: false, error: 'ids[] required' });
      }
      // Whitelist ids (uuid-like) to avoid command-line injection.
      const cleanIds = ids
        .filter((x) => typeof x === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(x))
        .slice(0, 500);
      if (cleanIds.length === 0) return send(res, 400, { ok: false, error: 'no valid ids' });
      // startPosition: clamp to a generous upper bound — frontend handles the real
      // per-format clamp; helper is only guarding against absurd values.
      const startPos = Number.isFinite(startPosition) && startPosition >= 1 && startPosition <= 200 ? Math.floor(startPosition) : 1;
      const topMargin = Number.isFinite(topMarginMm) && topMarginMm >= 0 && topMarginMm <= 50 ? Number(topMarginMm) : undefined;
      const cleanFormatId = typeof formatId === 'string' && /^[a-z0-9-]{1,64}$/.test(formatId) ? formatId : undefined;
      const cleanOverrides = {};
      if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
        const ALLOWED = ['paperW','paperH','cols','rows','labelW','labelH','marginTop','marginBottom','marginLeft','marginRight','gapH','gapV','cornerRadius'];
        for (const k of ALLOWED) {
          const v = overrides[k];
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000) {
            cleanOverrides[k] = v;
          }
        }
      }
      try {
        const pdfBuf = await renderLabelsPdf({
          ids: cleanIds,
          startPosition: startPos,
          topMarginMm: topMargin,
          formatId: cleanFormatId,
          overrides: cleanOverrides,
        });
        setCors(res);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/pdf');
        res.setHeader('content-disposition', 'attachment; filename="filament-labels.pdf"');
        res.setHeader('content-length', String(pdfBuf.length));
        return res.end(pdfBuf);
      } catch (err) {
        console.error('render-labels-pdf error:', err);
        return send(res, 500, { ok: false, error: err.message || 'render failed' });
      }
    }

    if (req.method === 'POST' && p === '/fetch-url-as-data-uri') {
      // Pre-fetch a URL the user pasted and convert to data-URI server-side.
      // Sidesteps cross-origin / CORS and SVG 404 issues at render time.
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const { url } = body;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        return send(res, 400, { ok: false, error: 'http(s) url required' });
      }
      const r = await fetchBuffer(url, { timeoutMs: 10_000 });
      if (!r || !r.contentType.startsWith('image/') || r.buf.length < 50) {
        return send(res, 502, { ok: false, error: 'url did not return an image' });
      }
      return send(res, 200, {
        ok: true,
        kind: 'data-uri',
        value: bufferToDataUri(r.buf, r.contentType),
        source: 'manual-url',
      });
    }

    if (req.method === 'POST' && p === '/fetch-logo') {
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const { brand, product_url, domain: hintDomain } = body;
      if (typeof brand !== 'string' || !brand.trim()) {
        return send(res, 400, { ok: false, error: 'brand required' });
      }
      const candidates = [];
      if (typeof hintDomain === 'string' && hintDomain.trim()) candidates.push(hintDomain.trim());
      if (typeof product_url === 'string' && product_url.trim()) {
        try { candidates.push(new URL(product_url).hostname.replace(/^www\./, '')); } catch { /* ignore */ }
      }
      candidates.push(...guessDomainsForBrand(brand));
      // dedupe preserving order
      const seen = new Set();
      const tryList = candidates.filter((d) => d && !seen.has(d) && seen.add(d));
      let resolved = null;
      const attempts = [];
      for (const dom of tryList) {
        const fromClearbit = await tryClearbit(dom);
        attempts.push({ domain: dom, source: 'clearbit', ok: !!fromClearbit });
        if (fromClearbit) { resolved = { ...fromClearbit, domain: dom }; break; }
        const fromFavicon = await tryAppleTouchIcon(dom);
        attempts.push({ domain: dom, source: 'apple-touch-icon', ok: !!fromFavicon });
        if (fromFavicon) { resolved = { ...fromFavicon, domain: dom }; break; }
      }
      if (resolved) {
        return send(res, 200, {
          ok: true,
          kind: 'data-uri',
          value: resolved.dataUri,
          domain: resolved.domain,
          source: resolved.source,
          attempts,
        });
      }
      return send(res, 200, { ok: false, kind: 'missing', attempts });
    }

    if (req.method === 'POST' && p === '/lookup-swatch') {
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const { brand, name, variant, sku, color_code, product_url, force = false } = body;
      if (typeof brand !== 'string' || typeof name !== 'string' || !brand.trim() || !name.trim()) {
        return send(res, 400, { ok: false, error: 'brand and name required' });
      }
      try {
        const { cached, result } = await resolveSwatch({ brand, name, variant, sku, color_code, product_url }, !!force);
        return send(res, 200, { ok: true, cached, result });
      } catch (err) {
        if (err.code === 'AI_DISABLED') return send(res, 409, { ok: false, error: 'ai_disabled' });
        if (err.code === 'NO_API_KEY') return send(res, 400, { ok: false, error: 'no_api_key' });
        if (err.code === 'TIMEOUT' || err.message === 'timeout') {
          return send(res, 504, { ok: false, error: 'timeout' });
        }
        if (err.message === 'unparseable') {
          return send(res, 500, { ok: false, error: 'unparseable', raw: err.raw });
        }
        console.error('lookup-swatch error:', err);
        return send(res, 500, { ok: false, error: err.message || 'internal' });
      }
    }

    if (req.method === 'POST' && p === '/load-demo-data') {
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const overwrite = body.overwrite === true;
      const copied = [];
      const skipped = [];
      for (const file of USER_DATA_FILES) {
        const demoPath = path.join(DEMO_DIR, file);
        if (!existsSync(demoPath)) continue;
        const userPath = path.join(USER_DATA_DIR, file);
        if (!overwrite && existsSync(userPath)) {
          // Non-empty guard: only skip if the user file actually has content;
          // otherwise we'd never seed a fresh install whose helper created
          // empty stub files on first save.
          try {
            const raw = await readFile(userPath, 'utf8');
            const parsed = JSON.parse(raw);
            const isEmpty = Array.isArray(parsed)
              ? parsed.length === 0
              : (parsed && typeof parsed === 'object'
                  ? Object.keys(parsed).length === 0 || (typeof parsed.count === 'number' && parsed.count === 0)
                  : false);
            if (!isEmpty) { skipped.push(file); continue; }
          } catch {
            // Unparseable user file — treat as empty and overwrite.
          }
        }
        try {
          const demoRaw = await readFile(demoPath, 'utf8');
          // Validate parseable before write so a malformed demo doesn't poison user data.
          JSON.parse(demoRaw);
          await mkdir(USER_DATA_DIR, { recursive: true });
          const tmp = userPath + '.tmp';
          await writeFile(tmp, demoRaw, 'utf8');
          await rename(tmp, userPath);
          copied.push(file);
        } catch (err) {
          console.error(`[demo] failed to load ${file}: ${err.message}`);
        }
      }
      return send(res, 200, { ok: true, copied, skipped, user_data_dir: USER_DATA_DIR });
    }

    if (req.method === 'POST' && p === '/fetch-store') {
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      const { brand, store_url, force = false } = body;
      if (typeof brand !== 'string' || !brand.trim()) {
        return send(res, 400, { ok: false, error: 'brand required' });
      }
      try {
        const result = await fetchBrandStore(brand.trim(), store_url, !!force);
        return send(res, 200, { ok: true, list: result });
      } catch (err) {
        if (err.code === 'AI_DISABLED') {
          return send(res, 200, { ok: false, error: 'AI provider is set to None — add store items manually.' });
        }
        if (err.code === 'NO_API_KEY') return send(res, 400, { ok: false, error: 'no_api_key' });
        if (err.code === 'TIMEOUT' || err.message === 'timeout') {
          return send(res, 504, { ok: false, error: 'timeout' });
        }
        if (err.code === 'STORE_FETCH_FAILED') {
          return send(res, 200, { ok: false, error: err.message });
        }
        console.error('fetch-store error:', err);
        return send(res, 500, { ok: false, error: err.message || 'internal' });
      }
    }

    return send(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    console.error('handler error:', err);
    return send(res, 500, { ok: false, error: String(err.message || err) });
  }
});

let watchdogTimer = null;
if (process.env.WATCHDOG_DISABLED === '1') {
  console.log('watchdog: DISABLED via WATCHDOG_DISABLED=1');
} else if (VITE_PID != null) {
  // Dev mode: vite spawned us and already tears us down on its own shutdown
  // (see app/vite.config.ts). Tie our lifetime to vite's PROCESS, not to PWA
  // heartbeats. Browsers throttle/freeze background-tab timers, so a
  // heartbeat-based watchdog would kill the helper whenever the user alt-tabs
  // away for ~45s — i.e. the app dies under an open window. Tracking the parent
  // pid instead means the helper stays alive for the entire dev session and
  // exits promptly only once vite is actually gone.
  watchdogTimer = setInterval(() => {
    try {
      process.kill(VITE_PID, 0); // signal 0 = liveness probe; throws if gone
    } catch {
      console.log(`watchdog: vite pid=${VITE_PID} is gone, exiting`);
      process.exit(0);
    }
  }, 5_000);
  watchdogTimer.unref();
  console.log(`watchdog: tracking vite pid=${VITE_PID} (heartbeat watchdog off in dev)`);
} else {
  // Standalone: no parent to track, so fall back to a heartbeat watchdog. Make
  // it generous (default 10 min, overridable) so ordinary PWA backgrounding
  // never kills it — only a genuinely-closed/crashed client eventually reaps.
  const timeoutMs = parseInt(process.env.WATCHDOG_TIMEOUT_MS || '600000', 10);
  watchdogTimer = setInterval(() => {
    if (Date.now() - watchdogResetAt > timeoutMs) {
      console.log(`watchdog: no heartbeat for ${Math.round(timeoutMs / 1000)}s, exiting`);
      process.exit(0);
    }
  }, 5_000);
  watchdogTimer.unref();
  console.log(`watchdog: heartbeat mode, ${Math.round(timeoutMs / 1000)}s grace (standalone)`);
}

server.listen(PORT, HOST, async () => {
  console.log(`helper listening on http://${HOST}:${PORT}`);
  console.log(`user_data_dir: ${USER_DATA_DIR}`);
  console.log(`catalog_dir:   ${CATALOG_DIR}`);
  await migrateLegacyDataIfNeeded();
});

function shutdown(sig) {
  console.log(`received ${sig}, shutting down`);
  if (watchdogTimer) clearInterval(watchdogTimer);
  killVite(sig);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
