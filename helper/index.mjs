#!/usr/bin/env node
// 3dprinter helper service — local-only Node HTTP service on 127.0.0.1:5174.
// Serves data/<file>.json, persists writes atomically, calls `claude` for
// filament enrichment, and self-exits when the PWA stops sending heartbeats.
// Contract: docs/parallel-work.md §"Chunk A — Helper service".

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.HELPER_PORT || '5174', 10);
const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';

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
  res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
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
  const target = path.resolve(DATA_DIR, filename);
  const rel = path.relative(DATA_DIR, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path traversal');
  }
  return target;
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

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'json', '--model', 'claude-sonnet-4-6'];
    // shell:true on Windows so cmd.exe resolves claude.cmd via PATH.
    // Prompt is piped via stdin to dodge cmd.exe escape issues with `|` chars.
    const child = spawn('claude', args, {
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      finish(reject, Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
    }, 90_000);
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

async function lookupFilament(brand, name, force) {
  const key = `${brand.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
  const cache = await readDataFile('ai-cache.json');
  if (!force && cache && Object.prototype.hasOwnProperty.call(cache, key)) {
    return { cached: true, result: cache[key] };
  }
  const raw = await runClaude(FILAMENT_PROMPT(brand, name));
  let inner;
  try {
    inner = extractClaudeText(raw);
  } catch {
    const e = new Error('unparseable');
    e.raw = raw.slice(0, 500);
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(inner));
  } catch {
    const e = new Error('unparseable');
    e.raw = inner.slice(0, 500);
    throw e;
  }
  cache[key] = parsed;
  await writeDataFileAtomic('ai-cache.json', cache);
  return { cached: false, result: parsed };
}

const server = createServer(async (req, res) => {
  try {
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

    if (req.method === 'POST' && p === '/lookup-swatch') {
      const body = await readJsonBody(req);
      if (body == null) return send(res, 400, { ok: false, error: 'invalid json' });
      // Stub for v0.1 — real per-supplier resolvers land in v0.2.
      return send(res, 200, { hex: null, source: null, confidence: 'none' });
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
} else {
  watchdogTimer = setInterval(() => {
    if (Date.now() - watchdogResetAt > 45_000) {
      console.log('watchdog: no heartbeat for 45s, exiting');
      killVite('watchdog timeout');
      process.exit(0);
    }
  }, 5_000);
  watchdogTimer.unref();
}

server.listen(PORT, HOST, () => {
  console.log(`helper listening on http://${HOST}:${PORT}`);
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
