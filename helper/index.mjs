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

import { existsSync } from 'node:fs';
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
