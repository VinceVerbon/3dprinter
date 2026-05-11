#!/usr/bin/env node
// One-shot backfill: replaces the OrderImportReview grey-placeholder
// swatches with real resolved colours via /api/lookup-swatch.
// Spec: docs/chunk-e-swatch-resolver.md §"Backfill plan".

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FILAMENTS_PATH = path.join(REPO_ROOT, 'data', 'filaments.json');
const HELPER_URL = process.env.HELPER_URL || 'http://127.0.0.1:5174';

function preflightGit() {
  try {
    const out = execSync('git status --porcelain data/filaments.json', { cwd: REPO_ROOT, encoding: 'utf8' });
    if (out.trim().length > 0) {
      console.error('REFUSING: data/filaments.json has uncommitted modifications. Commit or stash first, then re-run.');
      process.exit(2);
    }
  } catch (err) {
    console.warn('[warn] git preflight skipped:', err.message || err);
  }
}

function matchesGreyCriteria(f) {
  return f.swatch
    && f.swatch.hex === '#888888'
    && Array.isArray(f.swatch.stops)
    && f.swatch.stops.length === 1
    && f.swatch.stops[0] === '#888888'
    && f.swatch.source === 'manual';
}

async function postLookup(f) {
  const body = {
    brand: f.brand,
    name: f.name,
    variant: f.variant,
    sku: f.sku,
    product_url: f.product_url,
  };
  const r = await fetch(`${HELPER_URL}/lookup-swatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const json = await r.json();
  if (!json.ok || !json.result || !json.result.hex) {
    throw new Error(`unresolved: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.result;
}

async function writeAtomic(filePath, data) {
  const body = JSON.stringify(data, null, 2) + '\n';
  const tmp = filePath + '.tmp';
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, filePath);
}

async function main() {
  if (!process.env.SKIP_GIT_CHECK) preflightGit();

  const raw = await readFile(FILAMENTS_PATH, 'utf8');
  const data = JSON.parse(raw);
  const targets = data.filter(matchesGreyCriteria);
  console.log(`[backfill] ${targets.length} filament(s) match grey-swatch criteria.`);
  if (targets.length === 0) return;

  // Confirm helper is reachable before burning subscription quota.
  try {
    const health = await fetch(`${HELPER_URL}/healthz`);
    if (!health.ok) throw new Error(`healthz ${health.status}`);
  } catch (err) {
    console.error(`[backfill] helper not reachable at ${HELPER_URL}: ${err.message}`);
    process.exit(3);
  }

  let resolved = 0;
  let failed = 0;
  for (const f of targets) {
    const label = `${f.brand} | ${f.name} | ${f.variant || '(no variant)'}`;
    process.stdout.write(`[backfill] ${label} → `);
    try {
      const result = await postLookup(f);
      f.swatch = {
        hex: result.hex,
        stops: result.stops && result.stops.length > 0 ? result.stops : [result.hex],
        effects: result.effects || [],
        source: 'ai',
      };
      const summary = result.stops && result.stops.length > 1
        ? `${result.hex} + ${result.stops.length - 1} stop(s)`
        : result.hex;
      console.log(`${summary} (source=${result.source}, conf=${result.confidence})`);
      resolved++;
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      failed++;
    }
  }

  await writeAtomic(FILAMENTS_PATH, data);
  console.log(`\n[backfill] done. resolved=${resolved} failed=${failed}. Wrote ${path.relative(REPO_ROOT, FILAMENTS_PATH)}.`);
  console.log(`[backfill] Review changes:  git diff data/filaments.json`);
  console.log(`[backfill] Rollback:        git restore data/filaments.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });
