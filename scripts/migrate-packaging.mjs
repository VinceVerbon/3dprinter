#!/usr/bin/env node
// One-time migration: clean retailer cruft out of filament names and backfill
// the on_spool/refill packaging split on EXISTING data.
//
// Why a script as well as the in-app normalize: the app's filaments store now
// cleans names + backfills packaging on every load, so a fresh reload self-heals.
// But the running PWA holds the OLD (dirty) list in memory, and a save before
// reload would re-write the cruft. This script fixes the on-disk file directly
// (with a backup) so the data is correct immediately, independent of the app.
//
// The name-cleaning rules MIRROR app/src/lib/filamentName.ts — keep them in sync.
//
// Usage:
//   node scripts/migrate-packaging.mjs            # auto-resolve per-install data dir
//   node scripts/migrate-packaging.mjs <path>     # explicit filaments.json path
//   HASPEL_DATA_DIR=... node scripts/migrate-packaging.mjs

import { readFileSync, writeFileSync, copyFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'

// ---- name cleaner (mirror of app/src/lib/filamentName.ts) -------------------
function detectPackaging(raw) {
  const s = raw ?? ''
  if (/\b(?:refill|bijvullen|navulling)\b/i.test(s)) return 'refill'
  if (/\b(?:with|incl(?:\.|usive)?|met)\s+spool\b/i.test(s)) return 'on_spool'
  return null
}
function cleanFilamentName(raw) {
  let n = (raw ?? '').trim()
  if (!n) return n
  const dashSplit = n.split(/\s+[—–]\s+/)
  if (dashSplit.length >= 2) {
    const prefix = dashSplit[0].trim()
    const suffix = dashSplit.slice(1).join(' — ').trim()
    n = /\s\/\s/.test(prefix) ? suffix : prefix
  }
  n = n.replace(/\s*\d+(?:[.,]\d+)?\s*(?:kg|g)\s+(?:with|incl(?:\.|usive)?|met)\s+spool/gi, '')
  n = n.replace(/\s*\d+(?:[.,]\d+)?\s*(?:kg|g)\s+(?:refill|navulling)/gi, '')
  n = n.replace(/\s*\d+(?:[.,]\d+)?\s*(?:kg|g)\b/gi, '')
  n = n.replace(/\s*\d(?:[.,]\d+)?\s*mm\b/gi, '')
  n = n.replace(/\s*\(\s*(?:bijvullen|navulling|refill)\s*\)/gi, '')
  n = n.replace(/\s*\b(?:refill|bijvullen|navulling)\b/gi, '')
  n = n.replace(/\s*\b(?:with|incl(?:\.|usive)?|met)\s+spool\b/gi, '')
  n = n.replace(/\s{2,}/g, ' ').replace(/[\s,;·\-–—]+$/g, '').trim()
  return n
}

// ---- resolve the data file --------------------------------------------------
function defaultDataDir() {
  if (process.env.HASPEL_DATA_DIR) return process.env.HASPEL_DATA_DIR
  const p = platform()
  if (p === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Haspel', 'data')
  if (p === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Haspel', 'data')
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'haspel', 'data')
}

const file = process.argv[2] || join(defaultDataDir(), 'filaments.json')
if (!existsSync(file)) {
  console.error(`No filaments.json at: ${file}`)
  process.exit(1)
}

const list = JSON.parse(readFileSync(file, 'utf8'))
if (!Array.isArray(list)) {
  console.error('filaments.json is not an array — aborting.')
  process.exit(1)
}

// ---- backup -----------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${file}.bak-${stamp}`
copyFileSync(file, backup)

// ---- transform --------------------------------------------------------------
const renamed = []
let refillFlagged = 0
let packagingBackfilled = 0

for (const f of list) {
  const original = f.name ?? ''
  const pkg = detectPackaging(original)
  const cleaned = cleanFilamentName(original)
  if (cleaned !== original) renamed.push({ from: original, to: cleaned })
  f.name = cleaned

  const inv = f.inventory ?? (f.inventory = { sealed: 0, open: 0, in_use: 0 })
  const total = (inv.sealed || 0) + (inv.open || 0) + (inv.in_use || 0)
  if (inv.on_spool == null && inv.refill == null) {
    if (pkg === 'refill') { inv.refill = total; inv.on_spool = 0; refillFlagged++ }
    else { inv.on_spool = total; inv.refill = 0 }
    packagingBackfilled++
  } else {
    inv.on_spool = inv.on_spool || 0
    inv.refill = inv.refill || 0
  }
}

// ---- atomic write -----------------------------------------------------------
const tmp = `${file}.tmp`
writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8')
renameSync(tmp, file)   // atomic on Windows + POSIX; overwrites the original

// ---- report -----------------------------------------------------------------
console.log(`Migrated ${list.length} filament(s).`)
console.log(`Backup: ${backup}`)
console.log(`Packaging backfilled on ${packagingBackfilled} record(s); ${refillFlagged} flagged as refill.`)
if (renamed.length) {
  console.log(`\nNames cleaned (${renamed.length}):`)
  for (const r of renamed) console.log(`  "${r.from}"\n    → "${r.to}"`)
} else {
  console.log('No names needed cleaning.')
}
