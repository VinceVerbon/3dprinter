// Filament product-name normalisation.
//
// Retailer/order PDFs often name a product like
//   "PLA Matte 1 kg refill (Bijvullen)"
//   "TPU 85A / TPU 90A — TPU 90A 1 kg with spool"
//   "PLA Silk Multi-Color 1 kg with spool"
// We want the clean product name on the label, card, detail and form — the
// weight, packaging ("with spool" / "refill") and combo-prefix cruft does not
// belong in the title. Whether a unit is a refill or comes on its own spool is
// tracked separately in `inventory.on_spool` / `inventory.refill`.
//
// NOTE: a plain-JS mirror of this lives in `scripts/migrate-packaging.mjs` for
// the one-time on-disk migration. Keep the two in sync if you change the rules.

export type Packaging = 'on_spool' | 'refill' | null

/** Detect packaging hints in a raw product name. `refill` wins over `on_spool`
 *  because some names carry both a "refill" word and a generic weight phrase. */
export function detectPackaging(raw: string): Packaging {
  const s = raw ?? ''
  if (/\b(?:refill|bijvullen|navulling)\b/i.test(s)) return 'refill'
  if (/\b(?:with|incl(?:\.|usive)?|met)\s+spool\b/i.test(s)) return 'on_spool'
  return null
}

/** Strip retailer cruft so only the clean product name remains. Idempotent:
 *  running it on an already-clean name is a no-op. */
export function cleanFilamentName(raw: string): string {
  let n = (raw ?? '').trim()
  if (!n) return n

  // Combo names like "TPU 85A / TPU 90A — TPU 90A 1 kg with spool" carry the
  // actual variant after a spaced em/en dash; prefer that specific half.
  const dashSplit = n.split(/\s+[—–]\s+/)
  if (dashSplit.length >= 2) {
    const prefix = dashSplit[0].trim()
    const suffix = dashSplit.slice(1).join(' — ').trim()
    n = /\s\/\s/.test(prefix) ? suffix : prefix
  }

  // Drop trailing weight + packaging phrases: "1 kg with spool", "500 g refill",
  // "1kg met spool", "1 kg refill (Bijvullen)".
  n = n.replace(/\s*\d+(?:[.,]\d+)?\s*(?:kg|g)\s+(?:with|incl(?:\.|usive)?|met)\s+spool/gi, '')
  n = n.replace(/\s*\d+(?:[.,]\d+)?\s*(?:kg|g)\s+(?:refill|navulling)/gi, '')
  // Bare weight with no packaging word ("PLA Basic 1 kg").
  n = n.replace(/\s*\d+(?:[.,]\d+)?\s*(?:kg|g)\b/gi, '')
  // Diameter tokens ("1.75 mm", "1,75 mm", "2.85mm") — shown separately on the label.
  n = n.replace(/\s*\d(?:[.,]\d+)?\s*mm\b/gi, '')
  // Standalone packaging words / parentheticals.
  n = n.replace(/\s*\(\s*(?:bijvullen|navulling|refill)\s*\)/gi, '')
  n = n.replace(/\s*\b(?:refill|bijvullen|navulling)\b/gi, '')
  n = n.replace(/\s*\b(?:with|incl(?:\.|usive)?|met)\s+spool\b/gi, '')

  // Tidy up leftover separators / whitespace.
  n = n.replace(/\s{2,}/g, ' ').replace(/[\s,;·\-–—]+$/g, '').trim()
  return n
}
