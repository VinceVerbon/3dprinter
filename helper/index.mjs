#!/usr/bin/env node
// 3dprinter helper service — local-only Node HTTP service on 127.0.0.1:5174.
// Serves data/<file>.json, persists writes atomically, calls `claude` for
// filament enrichment, and self-exits when the PWA stops sending heartbeats.
// Contract: docs/parallel-work.md §"Chunk A — Helper service".

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Busboy from 'busboy';

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

function runClaude(prompt, { extraArgs = [], timeoutMs = 90_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'json', '--model', 'claude-sonnet-4-6', ...extraArgs];
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
  const raw = await runClaude(prompt, {
    cwd: tmpdir(),
    extraArgs: [
      '--allowedTools', 'WebFetch,Read',
      '--permission-mode', 'bypassPermissions',
      '--no-session-persistence',
      '--append-system-prompt', SWATCH_SYSTEM_PROMPT,
    ],
    timeoutMs: 180_000,
  });
  let inner;
  try { inner = extractClaudeText(raw); } catch { throw Object.assign(new Error('unparseable'), { raw: raw.slice(0, 500) }); }
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
        const raw = await runClaude(ORDER_PROMPT(pdfPath, pdfFilename), {
          // cwd=tmpdir keeps the project's CLAUDE.md / crosslog out of the
          // claude session (otherwise the model can see the helper context
          // and start questioning the prompt). --no-session-persistence
          // keeps each extraction hermetic.
          cwd: tmpdir(),
          extraArgs: [
            '--allowedTools', 'Read',
            '--permission-mode', 'bypassPermissions',
            '--no-session-persistence',
            '--append-system-prompt', ORDER_SYSTEM_PROMPT,
          ],
          timeoutMs: 120_000,
        });
        let inner;
        try {
          inner = extractClaudeText(raw);
        } catch {
          return send(res, 500, { ok: false, error: 'unparseable_wrapper', raw_preview: raw.slice(0, 500) });
        }
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
        if (err.code === 'TIMEOUT' || err.message === 'timeout') {
          return send(res, 504, { ok: false, error: 'timeout' });
        }
        console.error('import-order error:', err);
        return send(res, 500, { ok: false, error: err.message || 'internal' });
      } finally {
        await cleanup();
      }
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
