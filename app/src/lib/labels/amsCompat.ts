import type { Filament } from '../../types'

/** Reason returned alongside the boolean for the UI to show on hover. */
export interface AmsCompatResult {
  compatible: boolean
  reason: string
}

const BAMBU_RE = /bambu/i

// Non-Bambu filament types we treat as too stiff / abrasive for AMS feeding.
const NON_BAMBU_STIFF_TYPES = new Set(['PA', 'PA-CF', 'PC', 'PLA-CF'])

// Non-Bambu types that are AMS-friendly when not reinforced.
const NON_BAMBU_AMS_FRIENDLY = new Set(['PLA', 'PLA+', 'PETG', 'ABS', 'ASA'])

/**
 * Determine whether a filament can be loaded through the AMS 2 Pro.
 *
 * Rules (per user spec):
 *  - Bambu Lab branded filaments → trust their own guidance via `ai.p2s_compatibility.ams2pro`.
 *    Specifically Bambu "TPU for AMS" is the only AMS-compatible TPU; all other TPU is incompatible.
 *  - Any TPU NOT from Bambu (or any non-"for AMS" Bambu TPU) → not AMS compatible.
 *  - Non-Bambu stiff/reinforced (PA, PA-CF, PC, PLA-CF) → not AMS compatible.
 *  - Non-Bambu standard PLA / PETG / ABS / ASA (incl. matte/silk/etc.) → AMS compatible.
 *  - Everything else (e.g. type "Other") → fall back to ai data when present, otherwise default false.
 */
export function amsCompat(f: Filament): AmsCompatResult {
  const isBambu = BAMBU_RE.test(f.brand)
  const type = f.ai?.type ?? null
  const ams2pro = f.ai?.p2s_compatibility?.ams2pro
  const nameAmsTpu = /tpu\s*for\s*ams/i.test(f.name)

  // Bambu-branded path
  if (isBambu) {
    if (type === 'TPU') {
      if (nameAmsTpu) return { compatible: true, reason: 'Bambu TPU for AMS — engineered for AMS feeding.' }
      return { compatible: false, reason: 'Bambu TPU (non-"for AMS") — not AMS compatible.' }
    }
    if (ams2pro === true) return { compatible: true, reason: 'Bambu Lab data: AMS 2 Pro compatible.' }
    if (ams2pro === false) return { compatible: false, reason: 'Bambu Lab data: not AMS 2 Pro compatible.' }
    // No ai data yet — default to compatible for standard Bambu lines.
    return { compatible: true, reason: 'Bambu Lab default — AMS compatible (no AI data yet).' }
  }

  // Non-Bambu path
  if (type === 'TPU') {
    return { compatible: false, reason: 'Non-Bambu TPU — not AMS compatible.' }
  }
  if (type && NON_BAMBU_STIFF_TYPES.has(type)) {
    return { compatible: false, reason: `${type} (stiff / reinforced) — not AMS compatible.` }
  }
  if (type && NON_BAMBU_AMS_FRIENDLY.has(type)) {
    return { compatible: true, reason: `${type} — AMS compatible.` }
  }
  // Unknown / "Other" — defer to AI data if present.
  if (ams2pro === true) return { compatible: true, reason: 'AI: AMS 2 Pro compatible.' }
  if (ams2pro === false) return { compatible: false, reason: 'AI: not AMS 2 Pro compatible.' }
  return { compatible: false, reason: 'Unknown material — defaulting to not AMS compatible.' }
}
