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
  // --- state breakdown (how the stock is stored right now) ---
  sealed: number              // unopened spools held in reserve (off-shelf)
  open: number                // opened, not currently loaded in the printer (e.g. in the drybox)
  in_use: number              // currently loaded in the AMS / direct extruder
  // --- packaging breakdown (independent partition of the SAME total) ---
  // INVARIANT: on_spool + refill === sealed + open + in_use (total in stock).
  // The form refuses to save when this is violated.
  on_spool: number            // units that ship wound on their own (reusable) spool
  refill: number              // refills — filament only, no spool (mount on a reusable spool)
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

/** A filament that was removed from active inventory but kept in history, so an
 *  earlier-used filament can be revisited or restored. Carries the full record
 *  (swatch, ai, inventory, purchase) — restore re-creates it verbatim. */
export interface ArchivedFilament extends Filament {
  removed_at: string          // ISO timestamp the filament was archived
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

export type AiProvider = 'claude-cli' | 'anthropic-api' | 'openai-api' | 'gemini-api' | 'openrouter-api' | 'none'

export type AiTask = 'enrichment' | 'swatch' | 'order_import'

export interface AppSettings {
  default_filament_brand?: string
  /** Which backend resolves AI lookups. 'claude-cli' (default) shells out to the
   *  user's locally-installed `claude` CLI (OAuth, no key, own quota). The
   *  *-api providers call the respective REST API with a user-supplied key.
   *  'none' disables all AI lookups (manual entry only). */
  ai_provider?: AiProvider
  /** Per-provider API keys — only the one matching ai_provider is used. Stored
   *  in the per-install settings.json (outside the repo), never committed. The
   *  matching env var (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY /
   *  OPENROUTER_API_KEY) takes precedence over the stored value. */
  anthropic_api_key?: string
  openai_api_key?: string
  gemini_api_key?: string
  openrouter_api_key?: string
  /** Per-task model override. Falls back to ai_model (Claude backends only),
   *  then the provider's built-in default. */
  ai_models?: Partial<Record<AiTask, string>>
  /** Legacy/global default model. Retained for back-compat with older settings. */
  ai_model?: string          // claude-sonnet-4-6 default
  ai_lookup_enabled?: boolean
  /** When true, the first-run "add a printer?" prompt is suppressed on startup
   *  (user ticked "don't ask again"). */
  printer_prompt_dismissed?: boolean
  /** Keyed notification state (disabled + snoozed). Managed from Settings →
   *  Notifications. Drives the store-staleness prompt; extensible to others. */
  notifications?: NotificationState
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

// ---------------------------------------------------------------------------
// Printers — user-configured machines + a read-only seed of known models.
// ---------------------------------------------------------------------------

export type PrinterTechnology = 'FDM' | 'resin' | 'other'

/** AMS / multi-material capability of a printer. `type: 'none'` = no AMS. */
export interface PrinterAms {
  type: string                 // e.g. "AMS 2 Pro", "AMS", "AMS lite", "AMS HT", "none"
  slots?: number | null        // filament slots per unit (e.g. 4)
  max_units?: number | null    // how many units can be chained
}

export interface PrinterSpec {
  build_volume_mm?: { x: number; y: number; z: number } | null  // z is the build height
  max_build_height_mm?: number | null     // usually build_volume.z; kept explicit
  max_hotend_temp_c?: number | null        // max standard extruder/hotend temperature
  max_bed_temp_c?: number | null
  enclosed?: boolean | null
  chamber_heated?: boolean | null
  filament_diameter_mm?: number | null     // 1.75 typical
  default_nozzle_mm?: number | null
  nozzle_options_mm?: number[]             // e.g. [0.2, 0.4, 0.6, 0.8]
  ams?: PrinterAms | null
  common_accessories?: string[]            // e.g. ["Hardened nozzle", "Textured PEI plate"]
}

export interface Printer {
  id: string
  brand: string
  model: string
  nickname?: string            // user label, e.g. "Workshop P2S"
  technology?: PrinterTechnology
  spec: PrinterSpec
  detail_url?: string          // brand/model detail page
  store_url?: string           // brand store page
  notes?: string
  is_active?: boolean          // the "active" printer for filtering/defaults
  added_at: string             // ISO date
}

/** Read-only seed of known printer models, for prefilling the add-printer form.
 *  Lives at data/catalog/printers.json. */
export interface CatalogPrinter {
  brand: string
  model: string
  technology?: PrinterTechnology
  spec: PrinterSpec
  detail_url?: string
  store_url?: string
}

// ---------------------------------------------------------------------------
// Brand-store shopping — on-demand store lists (never preloaded) + keyed
// notification state. See docs/architecture.md / project memory.
// ---------------------------------------------------------------------------

/** A single shoppable item from a brand store (replacement part / consumable). */
export interface StoreItem {
  name: string
  sku?: string
  category?: string            // e.g. "nozzle", "build_plate", "glue", "consumable"
  price_eur?: number
  url?: string                 // direct product URL where known
  note?: string                // P2S/AMS relevance or other context
}

/** Per-brand store contents, fetched/inferred ON DEMAND (never shipped
 *  preloaded). Persisted per-install at store-lists.json as StoreList[], one
 *  entry per brand. `fetched_at` drives the >30-day staleness prompt. */
export interface StoreList {
  brand: string                // e.g. "Bambu Lab"
  model?: string | null        // tailored per make+model (e.g. "P2S"); null = brand-wide
  store_url?: string           // brand store page this was sourced from
  fetched_at: string           // ISO timestamp of the last fetch (staleness clock)
  source: 'ai' | 'manual'
  items: StoreItem[]
}

/** General, keyed notification state. A notification key is "active" (allowed to
 *  prompt) unless it's in `disabled` or snoozed past now. Managed from
 *  Settings → Notifications. Store-staleness uses keys `store-stale:<brand-slug>`. */
export interface NotificationState {
  disabled: string[]                  // keys turned off ("disable this notification")
  snoozed: Record<string, string>     // key -> ISO timestamp to stay quiet until ("ask me in a week")
}
