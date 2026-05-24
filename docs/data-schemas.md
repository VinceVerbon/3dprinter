# Data Schemas

One-page reference for every JSON file under `data/`. Source of truth for the runtime types: `app/src/types/index.ts`. **If a schema changes, update both files in the same commit.**

## File location and helper contract

- All files live under `data/` at repo root.
- The helper serves them via `GET /data/<file>.json` (one optional subdir level — so `/data/catalog/replacement-parts.json` works).
- Atomic writes via `POST /api/save-data` `{file, data}` — filename must match `^[a-z0-9-]+\.json$` (no subdirs writable; only flat files).
- Missing files return defaults: `[]` for arrays, `{}` for `ai-cache.json`.

---

## `data/filaments.json` — `Filament[]`

User-managed filament inventory. One entry per distinct **product+color**, not per spool. Multiple spools of the same product live in `inventory.{sealed,open,in_use}` counts.

```ts
{
  id: string                    // uuid
  brand: string                 // "Bambu Lab", "SUNLU", ...
  name: string                  // exact product name on label, e.g. "PLA Basic"
  variant?: string              // human color/finish, e.g. "Sunset Orange"

  // supplier-stable identifiers (all optional; the more, the better lookups work)
  sku?: string                  // supplier SKU, e.g. Bambu "GFA00:11101"
  product_url?: string          // canonical product page (used by swatch + spec resolvers)
  color_code?: string           // brand-internal color code (Bambu uses 5 digits)
  rfid_uid?: string             // Bambu AMS RFID UID (truly unique per spool)
  ean?: string                  // EAN/barcode (scan-on-receive)

  // presentation + AI-derived
  swatch: {
    hex: string                 // primary, e.g. "#ff8800"
    stops: string[]             // 1–5 hex strings; multicolor renders as gradient
    effects: ('matte' | 'silk' | 'sparkle' | 'marble' | 'metallic' | 'glow' | 'multicolor' | 'translucent')[]
    source: 'bambu' | 'sunlu' | '123-3d' | 'realfilament' | 'manual' | string
  }
  ai?: FilamentAi               // populated by Lookup AI; see below
  rating?: 1 | 2 | 3 | 4 | 5
  notes?: string

  // inventory — two partitions of the SAME total stock:
  //   state:     sealed (off-shelf reserve) + open + in_use (loaded in AMS)
  //   packaging: on_spool + refill
  // INVARIANT: on_spool + refill === sealed + open + in_use (form refuses save otherwise)
  inventory: { sealed: number; open: number; in_use: number; on_spool: number; refill: number }
  spool_grams_total?: number    // 1000 by default for Bambu refills
  spool_grams_remaining?: number
  purchased?: {
    date?: string               // ISO
    price_eur?: number
    source?: string             // e.g. "bambulab.com", "123-3d.nl", "Amazon NL"
    order_ref?: string
  }
  added_at: string              // ISO
}
```

### `FilamentAi` (the AI-resolved usage block)

```ts
{
  type: 'PLA' | 'PLA+' | 'PLA-CF' | 'PETG' | 'ABS' | 'ASA'
      | 'TPU' | 'PA' | 'PA-CF' | 'PC' | 'Other'
  abrasive: boolean             // requires hardened nozzle
  p2s_compatibility: {
    ams2pro: boolean
    hardened_nozzle_required: boolean
    notes: string
  }
  drying: {
    temp_c: number | null
    hours: number | null
    desiccant_recommended: boolean
  }
  print_temp_c: [number, number] | null    // [min, max]
  bed_temp_c: [number, number] | null
  usage_notes: string
  annealable: boolean | null
}
```

---

## `data/filament-history.json` — `ArchivedFilament[]`

Filaments removed from active inventory, kept so an earlier-used one can be revisited or restored. Per-install (lives in `USER_DATA_DIR`, never seeded in the repo). Newest-first.

```ts
ArchivedFilament = Filament & {
  removed_at: string   // ISO timestamp the filament was archived
}
```

Written on remove (the full `Filament` record is cloned in, plus `removed_at`). Restore strips `removed_at` and re-adds to `filaments.json` (a fresh `id` is minted only if the original id is somehow back in active inventory). Hard-delete drops the entry permanently. Managed by `useFilamentHistoryStore` / `FilamentHistory.vue`.

---

## `data/accessories.json` — `Accessory[]`

User-managed accessory inventory.

```ts
{
  id: string
  brand: string
  name: string
  category: 'nozzle' | 'hotend' | 'build_plate' | 'ams' | 'fan' | 'belt'
          | 'lubricant' | 'glue' | 'desiccant' | 'tool' | 'cleaning' | 'other'
  sub_category?: string         // e.g. "0.4 mm" for nozzles
  sku?: string
  rating?: 1 | 2 | 3 | 4 | 5
  notes?: string
  in_stock?: number             // count
  added_at: string              // ISO
}
```

---

## `data/shopping.json` — `ShoppingItem[]`

```ts
{
  id: string
  source_type: 'filament' | 'accessory' | 'replacement_part' | 'consumable' | 'free_text'
  source_id?: string            // id of the source item (catalog or inventory); omit for free_text
  label: string                 // human-readable, used in printable list
  quantity: number
  notes?: string
  added_at: string              // ISO
  done?: boolean                // checked off in the printable list
}
```

---

## `data/empty-spools.json` — `EmptySpoolsState`

```ts
{
  count: number                 // total free spools available for re-use
  byType: Record<string, number>  // optional breakdown, e.g. { "Bambu 1kg": 3 }
}
```

---

## `data/printers.json` — `Printer[]`

User-configured 3D printers (per-install; lives under `%APPDATA%\Haspel\data` etc., not committed). Drives the first-run "add a printer?" prompt and AMS-aware UI.

```ts
{
  id: string                    // uuid
  brand: string                 // "Bambu Lab", "Original Prusa", ...
  model: string                 // exact model, e.g. "P2S"
  nickname?: string             // user label, e.g. "Workshop P2S"
  technology?: 'FDM' | 'resin' | 'other'
  spec: {
    build_volume_mm?: { x: number; y: number; z: number } | null   // z = build height
    max_build_height_mm?: number | null
    max_hotend_temp_c?: number | null     // max standard/stock hotend temperature
    max_bed_temp_c?: number | null
    enclosed?: boolean | null
    chamber_heated?: boolean | null        // active chamber heater (not just a passive enclosure)
    filament_diameter_mm?: number | null   // 1.75 typical
    default_nozzle_mm?: number | null
    nozzle_options_mm?: number[]
    ams?: { type: string; slots?: number | null; max_units?: number | null } | null  // type "none" = no AMS
    common_accessories?: string[]
  }
  detail_url?: string           // brand/model detail page
  store_url?: string            // brand store page
  notes?: string
  is_active?: boolean           // the active printer (filtering/defaults); first one added defaults to true
  added_at: string              // ISO date
}
```

---

## `data/ai-cache.json` — `AiCache`

Helper-managed. Keys are `${brand}|${name}` lowercased + trimmed.

```ts
Record<string, {
  brand: string
  name: string
  result: FilamentAi            // see Filament section
  fetched_at: string            // ISO
}>
```

---

## `data/settings.json` — `AppSettings`

```ts
{
  default_filament_brand?: string         // "Bambu Lab" by default
  ai_model?: string                       // "claude-sonnet-4-6" by default
  ai_lookup_enabled?: boolean
}
```

---

## `data/catalog/replacement-parts.json` — `CatalogReplacementPart[]` (read-only seed)

Reference list of P2S/AMS 2 Pro replacement parts the user can add to the shopping list. **Read-only at runtime** — edits go through PRs, not the helper.

```ts
{
  id: string                    // kebab-case
  name: string                  // human-readable, brand-prefixed
  sku?: string                  // Bambu / supplier SKU when known
  category: AccessoryCategory   // same enum as Accessory.category
  sub_category?: string
  p2s_compatible: boolean       // always true in this catalog
  notes?: string                // gotchas, when to buy
  suggested_brands?: string[]
  typical_lifetime_hours?: number
  price_eur_estimate?: number
}
```

Source for the v0.1 seed: `bambu-p2s-specialist` agent walking 3DJake / welectron / fbrc8 / west3d listings on 2026-05-08. Verified P2S compatibility for every entry; flagged uncertainty inline (e.g. AMS feeder unit price marked approximate due to stockouts).

---

## `data/catalog/consumables.json` — `CatalogConsumable[]` (read-only seed)

Reference list of common 3D-printing consumables (adhesion, drying, cleaning, maintenance, storage).

```ts
{
  id: string                    // kebab-case
  name: string
  category: 'adhesion' | 'drying' | 'cleaning' | 'maintenance' | 'storage'
  typical_unit?: string         // "50 ml pen", "200 g pouch", "500 ml bottle"
  suggested_brands?: string[]
  notes?: string
  source_url?: string           // optional; biased toward NL/EU retailers
}
```

---

## `data/catalog/printers.json` — `CatalogPrinter[]` (read-only seed)

Known printer models, used to prefill the add-printer form (the spec fields auto-fill, then the user can edit). Same `spec` shape as `Printer.spec` above, minus the user fields (`id`, `nickname`, `is_active`, `notes`, `added_at`).

```ts
{
  brand: string
  model: string
  technology?: 'FDM' | 'resin' | 'other'
  spec: PrinterSpec             // identical shape to Printer.spec
  detail_url?: string
  store_url?: string
}
```

Seeded with 12 models (Bambu Lab P2S / X1 Carbon / P1S / A1 / A1 mini / H2D, Original Prusa MK4S / CORE One, Voron 2.4, Creality K1 Max / K2 Plus, Elegoo Centauri Carbon), specs verified against official manufacturer sources. `null` where a model has no single stock value (e.g. Voron hotend/bed max).

---

## Conventions

- **All times are ISO 8601 strings** (`new Date().toISOString()`).
- **Hex colors are lowercase 7-char `#rrggbb`** (no shorthand, no alpha).
- **IDs:** uuid for user-created entities (filaments, accessories, shopping items); kebab-case stable IDs for catalog seed entries (so PRs that re-order a catalog don't break the IDs).
- **Optional vs required:** prefer making everything user-data optional except `id`, `added_at`, and category-defining fields (`brand`, `name`, `category`).
- **No PII**, no auth tokens, no API keys in any data file. The helper's CORS pin and 127.0.0.1-only binding assume the data is local-trust only.
