// Data model types for 3dprinter. These mirror the JSON files under data/.
// If a schema changes, update both this file and `docs/data-schemas.md`.

export type FilamentType =
  | 'PLA' | 'PLA+' | 'PLA-CF' | 'PETG' | 'ABS' | 'ASA'
  | 'TPU' | 'PA' | 'PA-CF' | 'PC' | 'Other'

export type Effect =
  | 'matte' | 'silk' | 'sparkle' | 'marble' | 'metallic' | 'glow' | 'multicolor' | 'translucent' | 'transparent'

/** Multicolor uses 1–5 hex stops; non-multicolor uses just stops[0]. */
export interface Swatch {
  hex: string                 // primary hex, e.g. "#ff8800"
  stops: string[]             // 1–5 hex strings; multicolor renders as gradient
  effects: Effect[]
  source: 'bambu' | 'sunlu' | '123-3d' | 'realfilament' | 'manual' | string
}

export interface FilamentAi {
  type: FilamentType
  abrasive: boolean
  p2s_compatibility: { ams2pro: boolean; hardened_nozzle_required: boolean; notes: string }
  drying: { temp_c: number | null; hours: number | null; desiccant_recommended: boolean }
  print_temp_c: [number, number] | null
  bed_temp_c: [number, number] | null
  usage_notes: string
  annealable: boolean | null
}

export interface FilamentPurchase {
  date?: string               // ISO date
  price_eur?: number
  source?: string             // e.g. "bambulab.com", "123-3d.nl", "Amazon NL"
  order_ref?: string          // order/invoice number
}

/** A record describes one (brand, name, variant) — i.e. one SKU-equivalent. Multiple physical spools of the same SKU are tracked via inventory counts, not duplicate records. */
export interface FilamentInventory {
  sealed: number              // unopened spools on the shelf
  open: number                // opened, not currently loaded in the printer
  in_use: number              // currently loaded in the AMS / direct extruder
}

export interface Filament {
  id: string                  // uuid
  brand: string
  name: string                // exact product name as printed on label, e.g. "PLA Basic"
  variant?: string            // human-readable color/finish, e.g. "Sunset Orange"
  // --- supplier-stable identifiers (optional; the more we have, the better automated lookups work) ---
  sku?: string                // supplier SKU, e.g. Bambu "G02-G0-1.75-1000-SPL"
  product_url?: string        // canonical product page (used by the swatch + spec resolvers)
  color_code?: string         // brand-internal color code printed on label (Bambu uses 2-char in SKU; MakerWorld uses 5-digit)
  rfid_uid?: string           // Bambu AMS RFID UID (truly unique per spool — only meaningful for in_use slots; tracked via the printer)
  ean?: string                // EAN/barcode (scan-on-receive)
  // --- presentation + AI-derived ---
  swatch: Swatch
  ai?: FilamentAi             // populated by Lookup AI; otherwise undefined
  rating?: 1 | 2 | 3 | 4 | 5
  notes?: string
  // --- inventory ---
  inventory: FilamentInventory
  spool_grams_total?: number  // grams per spool for this SKU (1000 default for Bambu refills, 500 for support)
  purchased?: FilamentPurchase
  added_at: string            // ISO date
}

export type AccessoryCategory =
  | 'nozzle' | 'hotend' | 'build_plate' | 'ams' | 'fan' | 'belt' | 'lubricant'
  | 'glue' | 'desiccant' | 'tool' | 'cleaning' | 'other'

export interface Accessory {
  id: string
  brand: string
  name: string
  category: AccessoryCategory
  sub_category?: string
  sku?: string
  rating?: 1 | 2 | 3 | 4 | 5
  notes?: string
  in_stock?: number          // count
  added_at: string
}

export interface ShoppingItem {
  id: string
  source_type: 'filament' | 'accessory' | 'replacement_part' | 'consumable' | 'free_text'
  source_id?: string         // id of the source item (if not free_text)
  label: string              // human-readable, used in printable list
  quantity: number
  unit_price_eur?: number    // snapshot at add-time; multiplied by quantity for line/total
  notes?: string
  added_at: string
  done?: boolean             // checked off in the printed list
}

export interface EmptySpoolsState {
  count: number              // total free spools
  byType: Record<string, number>  // optional breakdown by spool size/brand
}

export interface AiCacheEntry {
  brand: string
  name: string
  result: FilamentAi
  fetched_at: string
}

export type AiCache = Record<string, AiCacheEntry>  // key = `${brand}|${name}` lowercased

export interface AppSettings {
  default_filament_brand?: string
  ai_model?: string          // claude-sonnet-4-6 default
  ai_lookup_enabled?: boolean
}

export interface CatalogReplacementPart {
  id: string
  name: string
  sku?: string
  category: AccessoryCategory
  sub_category?: string
  p2s_compatible: boolean
  notes?: string
  suggested_brands?: string[]
  typical_lifetime_hours?: number
  price_eur_estimate?: number
}

export interface CatalogConsumable {
  id: string
  name: string
  category: 'adhesion' | 'drying' | 'cleaning' | 'maintenance' | 'storage'
  typical_unit?: string
  suggested_brands?: string[]
  notes?: string
  source_url?: string
}
