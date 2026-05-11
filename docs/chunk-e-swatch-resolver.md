# Chunk E — swatch resolver + multicolor support + backfill

**Status:** spec frozen 2026-05-11 by Chat C. Implementation tasks #5–#10 follow this doc exactly. Any deviation gets written back here before execution.

## Why

`OrderImportReview.vue` creates new filaments with `swatch: { hex: '#888888', stops: ['#888888'], effects: [], source: 'manual' }` because the per-supplier swatch resolver chain (Chunk E in `docs/parallel-work.md` §"Chunk E — swatch resolver") was never built. As of `data/filaments.json` snapshot today there are **13 imported filaments** all carrying the grey placeholder, all Bambu Lab, all with `purchased.order_ref` set — clear evidence they came via the PDF import flow.

User-facing complaints driving this work:

1. "the swatches arent correctly updated after the inference run on the pdf and the import" — new imports show grey blobs in the UI.
2. "multicolor isnt shown on filament color filter choices" — `FilamentsPage.vue` color filter has no Multicolor pseudo-family even though `Effect = 'multicolor'` exists in the data model.

User explicitly asked for: option 3 of the swatch fix (the real Chunk E), **Bambu first**, **multicolor stops supported**, and **backfill on imported filaments**.

## Architecture

### 1. Helper endpoint — `POST /api/lookup-swatch`

Currently a v0.1 stub returning `{ hex: null, source: null, confidence: 'none' }`. Replacement contract:

```
POST /lookup-swatch
{
  brand: string,                       // e.g. "Bambu Lab"
  name: string,                        // e.g. "PLA Silk Multi-Color 1 kg with spool"
  variant?: string,                    // e.g. "Ochtendglans" (colour name on the label)
  sku?: string,                        // e.g. "A05-M8-1.75-1000-SPL"
  color_code?: string,                 // e.g. "M8" (2-char brand-internal code from Bambu SKU)
  product_url?: string,                // canonical product page if known
  force?: boolean                      // bypass cache
}

→ 200 {
  ok: true,
  cached: boolean,
  result: {
    hex: string,                       // dominant hex, e.g. "#1a1a1a"
    stops: string[],                   // 1..5 hex strings; >1 means multicolor
    effects: ("matte"|"silk"|"sparkle"|"marble"|"metallic"|"glow"|"multicolor"|"translucent"|"transparent")[],
    source: "bambu" | "123-3d" | "sunlu" | "real-filament" | "generic" | "ai",
    confidence: "high" | "medium" | "low" | "none",
    notes?: string                     // free-form, e.g. "Resolved via Bambu Lab product page"
  }
}

Errors: 400 invalid_input | 504 timeout | 500 internal
```

Cache: `data/ai-cache.json` keyed `swatch:<brand>|<name>|<variant>` (lowercased, trimmed) so structure mirrors filament cache. `force: true` bypasses.

### 2. Resolver strategy (Bambu first)

Single helper function `resolveSwatch(input)` runs a strategy chain:

1. **Bambu Lab** (brand match: `/bambu/i`):
   - Build a search context for claude including SKU, color_code (if SKU like `A05-M8-1.75-…`, extract `M8`), variant name, and `product_url` if present.
   - Prompt claude to use `WebFetch` against `eu.store.bambulab.com` (or `wiki.bambulab.com/en/filament-acc/filament/<series>` which has structured color tables) to identify the exact swatch.
   - For **multicolor** product lines (PLA Silk Multi-Color, PLA Galaxy, PLA Marble, PLA Silk Dual Color, etc.), return all visible color stops in `stops[]`. The dominant/first colour goes in `hex`. Set `effects: ['multicolor']` (plus `'silk'`/`'marble'` etc. when applicable).
   - Source: `"bambu"`, confidence: `"high"` if exact SKU/color_code matched, else `"medium"`.
2. **Generic AI fallback** (any other brand, or Bambu when fetch fails):
   - Prompt claude with `{ brand, name, variant }` and ask for best-guess hex(es) from training knowledge.
   - Source: `"ai"` or `"generic"`, confidence: `"low"`.
3. **Final fallback**: `{ hex: '#888888', stops: ['#888888'], source: 'generic', confidence: 'none' }` — never throws.

### 3. Claude invocation hardening

Same pattern as `/import-order`:
- `cwd: os.tmpdir()` so project `CLAUDE.md`/crosslog don't bleed into context.
- `--no-session-persistence --append-system-prompt "<framing as legitimate swatch resolver>"`.
- `--allowedTools WebFetch,Read --permission-mode bypassPermissions` (WebFetch needed to hit eu.store.bambulab.com).
- 60 s timeout (smaller surface than PDF).

### 4. Multicolor filter (FilamentsPage)

Add a pseudo-family alongside the existing 12 single-color buckets:

```ts
type ColorFamily =
  | 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue'
  | 'purple' | 'pink' | 'brown' | 'black' | 'white' | 'gray'
  | 'multicolor'    // NEW
```

Match rule:
```ts
isMulticolor(f) =>
  f.swatch.effects.includes('multicolor')
  || (f.swatch.stops.length > 1 && new Set(f.swatch.stops).size > 1)
```

`availableColors` includes `'multicolor'` iff at least one filament matches. The swatch dot for the multicolor option uses a CSS conic-gradient with all 12 family hues so it reads as "rainbow" at a glance.

`filamentMatchesColor` short-circuits: if family is `'multicolor'`, return `isMulticolor(f)` and **don't** fall through to the per-stop family check (otherwise a Galaxy filament shows up in BOTH Multicolor and Black — confusing).

### 5. Import-time swatch population

Two-tier so the user never sees grey on a fresh import:

- **Tier 1 — extraction-time hint (always)**: `/import-order` prompt is extended with `hex` and `stops[]` per item. Claude gives a best-guess from the receipt text. Cheap (no extra round-trip) but lower confidence than a real product-page lookup.
- **Tier 2 — post-import resolver (best-effort, async)**: after `OrderImportReview.apply()` creates new filaments, fire `/api/lookup-swatch` per new item in parallel. Resolved swatches overwrite the Tier 1 hint. The user sees Tier 1 instantly, Tier 2 replaces it within a few seconds.

If Tier 2 errors out (helper offline, claude failure), Tier 1 stays — never regresses to grey.

### 6. Type changes

`app/src/components/OrderDropZone.vue`:
```ts
export type ImportedItem = {
  // ...existing fields...
  hex?: string          // NEW — Tier 1 hint from claude PDF extraction
  stops?: string[]      // NEW — for multicolor lines extracted from the receipt
}
```

`OrderImportReview.vue` line 106 swatch construction:
```ts
swatch: {
  hex: item.hex ?? '#888888',
  stops: item.stops?.length ? item.stops : [item.hex ?? '#888888'],
  effects: (item.stops?.length ?? 0) > 1 ? ['multicolor'] : [],
  source: 'ai',
}
```

### 7. Manual-add path (FilamentForm)

When the user adds a filament manually (no PDF), `/api/lookup-swatch` fires in the background on form open (debounced by 500 ms after brand+name+variant stop changing). Resolved hex pre-fills the color picker. User keeps full override. Cached results = instant.

## Backfill plan

### Selection criteria

A filament needs backfill iff **all** of:
- `swatch.hex === '#888888'`
- `swatch.stops.length === 1 && swatch.stops[0] === '#888888'`
- `swatch.source === 'manual'` (the OrderImportReview hardcode; user-typed manual swatches will have user-chosen hex and won't match)

The `purchased.order_ref` check is **not** part of the criteria — there might be manual-add records that hit the grey hardcode too, and they deserve resolution just as much.

### Procedure (one-shot, idempotent)

1. Helper-side script `scripts/backfill-swatches.mjs`:
   - Read `data/filaments.json`.
   - For each filament matching the criteria above:
     - Call `resolveSwatch({ brand, name, variant, sku, color_code: parseColorCode(sku), product_url })` (the same function the endpoint uses, called directly).
     - Replace `f.swatch` with the resolved swatch (preserve `f.swatch.effects` if they had non-grey content for some reason — unlikely but safe).
     - Log `<brand> <name> <variant>: #888888 → #<new>  (source=<source>, conf=<confidence>)`.
   - Write back atomically (same `tmp + rename` pattern as `/save-data`).
2. Frontend "Refresh swatches" button on Filaments page — exposed only when there are grey-swatch records to fix. Clicking it iterates the same criteria, calls `/api/lookup-swatch` per record, calls `store.update(...)`, then `store.save()`. Progress reported inline (`Refreshing swatches… 3/13`).

Both paths converge on the same `resolveSwatch` function — single source of truth.

### Rollback

Two safeguards:
1. **Pre-flight git status check** in the script: refuses to run if `data/filaments.json` has uncommitted modifications. If the user wants to retry, they can `git checkout data/filaments.json`.
2. **Diff is the audit log**: the operation is a single `data/filaments.json` write that touches only `swatch` blocks. `git diff data/filaments.json` shows exactly what changed. `git restore data/filaments.json` is the rollback.

### Today's snapshot (2026-05-11)

13 filaments match the criteria, all Bambu Lab from order `EN729057788556730368`:
- 4× TPU 85A (Light Cyan, Lime Green, Neon Orange, Sky Blue?)
- TPU 90A Grape Jelly
- PLA Silk Multi-Color Ochtendglans (multicolor — exercises the stops path)
- … plus 7 more (run the script to enumerate)

The Silk Multi-Color is the canary for multicolor support — if its `stops[]` doesn't come back with 2+ distinct colors, the resolver is failing on multicolor and the implementation needs another pass.

## Execution order

Tasks #5–#9 in order:

1. **#5** (multicolor filter) — pure frontend, no helper dependency. Safe to land first.
2. **#6** (extract-time hex hint) — frontend + helper prompt change. Makes new imports immediately better even before the resolver is built.
3. **#7** (`/lookup-swatch` endpoint) — helper-only. Standalone-testable via curl before any frontend wiring.
4. **#8** (FilamentForm + retro-fix button) — frontend wiring. Needs #7 live.
5. **#9** (backfill) — runs after #7. Either the script or the button; both work because they share `resolveSwatch`.

Crosslog entry written per task as it completes. On session boundary, the next chat reads this doc + the crosslog and resumes from the next pending task.

## Out of scope (deliberately)

- 123-3d.nl / RealFilament / SUNLU per-supplier resolvers — fall back to the AI-generic path. Tracked as follow-up in `docs/parallel-work.md` §"Chunk E".
- Swatch picker UI changes — the existing manual picker is fine; this work just feeds it better defaults.
- `purchased.source` normalisation — orthogonal.
- Auto-refresh stale swatches — out of scope; once resolved a swatch stays put unless the user clicks Re-resolve.
