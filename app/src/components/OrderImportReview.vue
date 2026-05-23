<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFilamentsStore } from '../stores/filaments'
import { useAccessoriesStore } from '../stores/accessories'
import type { Filament, Accessory, AccessoryCategory } from '../types'
import type { ImportResult, ImportedItem } from './OrderDropZone.vue'
import { cleanFilamentName, detectPackaging } from '../lib/filamentName'
import { Check, X } from 'lucide-vue-next'

const props = defineProps<{ result: ImportResult }>()
const emit = defineEmits<{ done: []; cancel: [] }>()

const filaments = useFilamentsStore()
const accessories = useAccessoriesStore()

type RowState = {
  enabled: boolean
  quantity: number
  matchedId: string | null   // existing filament/accessory id; null = create new
}

const rows = ref<RowState[]>(
  props.result.items.map(i => ({
    enabled: true,
    quantity: i.quantity,
    matchedId: findMatch(i),
  })),
)

function findMatch(item: ImportedItem): string | null {
  const norm = (s?: string) => (s ?? '').trim().toLowerCase()
  if (item.kind === 'filament') {
    const f = filaments.items.find(x =>
      (item.sku && norm(x.sku) === norm(item.sku)) ||
      (item.ean && norm(x.ean) === norm(item.ean)) ||
      (norm(x.brand) === norm(item.brand) &&
       norm(x.name) === norm(cleanFilamentName(item.name)) &&
       norm(x.variant) === norm(item.variant)),
    )
    return f?.id ?? null
  }
  if (item.kind === 'accessory' || item.kind === 'consumable') {
    const a = accessories.items.find(x =>
      (item.sku && norm(x.sku) === norm(item.sku)) ||
      (norm(x.brand) === norm(item.brand) && norm(x.name) === norm(item.name)),
    )
    return a?.id ?? null
  }
  return null
}

function uuid(prefix: 'f' | 'a' = 'f'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return prefix + '_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function inferAccessoryCategory(item: ImportedItem): AccessoryCategory {
  const t = `${item.brand} ${item.name} ${item.variant ?? ''}`.toLowerCase()
  if (/nozzle|hotend/.test(t)) return /nozzle\b/.test(t) ? 'nozzle' : 'hotend'
  if (/build plate|cool plate|engineering plate|pei|textured/.test(t)) return 'build_plate'
  if (/ams\b/.test(t)) return 'ams'
  if (/fan/.test(t)) return 'fan'
  if (/belt/.test(t)) return 'belt'
  if (/grease|oil|lube|lubricant/.test(t)) return 'lubricant'
  if (/glue|magigoo|3dlac|hairspray|stick/.test(t)) return 'glue'
  if (/desiccant|silica/.test(t)) return 'desiccant'
  if (/cutter|brush|wiper|cloth|swab|ipa|isopropanol|alcohol|cleaner|needle/.test(t)) return 'cleaning'
  return 'other'
}

const enabledCount = computed(() => rows.value.filter(r => r.enabled).length)
const filamentMatchCount = computed(() => rows.value.filter((r, i) => r.enabled && props.result.items[i].kind === 'filament' && r.matchedId != null).length)
const filamentNewCount = computed(() => rows.value.filter((r, i) => r.enabled && props.result.items[i].kind === 'filament' && r.matchedId === null).length)
const accessoryMatchCount = computed(() => rows.value.filter((r, i) => r.enabled && (props.result.items[i].kind === 'accessory' || props.result.items[i].kind === 'consumable') && r.matchedId != null).length)
const accessoryNewCount = computed(() => rows.value.filter((r, i) => r.enabled && (props.result.items[i].kind === 'accessory' || props.result.items[i].kind === 'consumable') && r.matchedId === null).length)
const skippedCount = computed(() => rows.value.filter((r, i) => r.enabled && props.result.items[i].kind === 'unknown').length)

const saving = ref(false)
const message = ref<string | null>(null)

const newFilamentIds: { id: string; item: ImportedItem }[] = []

async function resolveOneSwatch({ id, item }: { id: string; item: ImportedItem }): Promise<boolean> {
  try {
    const r = await fetch('/api/lookup-swatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brand: item.brand,
        name: item.name,
        variant: item.variant,
        sku: item.sku,
      }),
    })
    if (!r.ok) return false
    const json = await r.json() as {
      ok?: boolean
      result?: { hex?: string; stops?: string[]; effects?: string[]; source?: string; confidence?: string }
    }
    if (!json.ok || !json.result || !json.result.hex) return false
    const swatch = {
      hex: json.result.hex,
      stops: json.result.stops?.length ? json.result.stops : [json.result.hex],
      effects: ((json.result.effects ?? []).filter(e => ['matte','silk','sparkle','marble','metallic','glow','multicolor','translucent','transparent'].includes(e)) as Filament['swatch']['effects']),
      source: 'ai' as const,
    }
    filaments.update(id, { swatch } as Partial<Filament>)
    return true
  } catch {
    /* helper offline or claude failed — keep Tier 1 hint */
    return false
  }
}

// Each /lookup-swatch spawns a heavyweight `claude` + WebFetch subprocess in
// the helper. Firing them all at once (the old Promise.all) overloaded the
// machine on larger orders, so some calls timed out and silently fell back to
// the weaker Tier-1 hex hint — that's why a re-import (warm cache) produced
// noticeably better swatches. Cap concurrency so every lookup actually lands.
const SWATCH_CONCURRENCY = 3

async function resolveSwatchesAsync(): Promise<number> {
  if (newFilamentIds.length === 0) return 0
  let resolved = 0
  const queue = [...newFilamentIds]
  const worker = async () => {
    for (;;) {
      const next = queue.shift()
      if (!next) return
      if (await resolveOneSwatch(next)) {
        resolved++
        message.value = `Imported. Resolving swatches… (${resolved}/${newFilamentIds.length})`
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SWATCH_CONCURRENCY, queue.length) }, worker))
  if (resolved > 0) await filaments.save()
  return resolved
}

async function apply() {
  saving.value = true
  let touchedFilaments = false
  let touchedAccessories = false
  newFilamentIds.length = 0
  for (let i = 0; i < props.result.items.length; i++) {
    const item = props.result.items[i]
    const row = rows.value[i]
    if (!row.enabled) continue
    if (item.kind === 'filament') {
      touchedFilaments = true
      // Re-check identity at apply time, not just when the dialog opened. The
      // matching entry may have been added by an earlier row in this same batch
      // or loaded after the dialog mounted — without this, a re-import creates a
      // duplicate spool instead of bumping the sealed count.
      const matchId = row.matchedId ?? findMatch(item)
      if (matchId) {
        const existing = filaments.items.find(f => f.id === matchId)
        if (existing) {
          const inv = existing.inventory ?? { sealed: 0, open: 0, in_use: 0, on_spool: 0, refill: 0 }
          // Bump the matching packaging count alongside sealed so the
          // on_spool+refill == sealed+open+in_use invariant stays balanced.
          const isRefill = detectPackaging(item.name) === 'refill'
          filaments.update(existing.id, {
            inventory: {
              ...inv,
              sealed: (inv.sealed ?? 0) + row.quantity,
              on_spool: (inv.on_spool ?? 0) + (isRefill ? 0 : row.quantity),
              refill: (inv.refill ?? 0) + (isRefill ? row.quantity : 0),
            },
          } as Partial<Filament>)
        }
      } else {
        const hexHint = item.hex ?? null
        const stopsHint = item.stops && item.stops.length > 0 ? item.stops : (hexHint ? [hexHint] : null)
        const isRefill = detectPackaging(item.name) === 'refill'
        const newId = uuid('f')
        const f: Filament = {
          id: newId,
          brand: item.brand,
          name: cleanFilamentName(item.name),
          variant: item.variant,
          sku: item.sku,
          ean: item.ean,
          swatch: hexHint
            ? {
                hex: hexHint,
                stops: stopsHint ?? [hexHint],
                effects: ((item.effects ?? []).filter(e => ['matte','silk','sparkle','marble','metallic','glow','multicolor','translucent','transparent'].includes(e)) as Filament['swatch']['effects']),
                source: 'ai',
              }
            : { hex: '#888888', stops: ['#888888'], effects: [], source: 'manual' },
          inventory: {
            sealed: row.quantity, open: 0, in_use: 0,
            on_spool: isRefill ? 0 : row.quantity,
            refill: isRefill ? row.quantity : 0,
          },
          spool_grams_total: 1000,
          purchased: {
            date: props.result.order_date,
            price_eur: item.unit_price_eur,
            source: props.result.vendor_guess,
            order_ref: props.result.order_ref,
          },
          added_at: new Date().toISOString(),
        } as Filament
        filaments.add(f)
        newFilamentIds.push({ id: newId, item })
      }
    } else if (item.kind === 'accessory' || item.kind === 'consumable') {
      touchedAccessories = true
      if (row.matchedId) {
        const existing = accessories.items.find(a => a.id === row.matchedId)
        if (existing) {
          accessories.update(existing.id, {
            in_stock: (existing.in_stock ?? 0) + row.quantity,
          } as Partial<Accessory>)
        }
      } else {
        const a: Accessory = {
          id: uuid('a'),
          brand: item.brand,
          name: item.name,
          category: inferAccessoryCategory(item),
          sku: item.sku,
          in_stock: row.quantity,
          notes: props.result.order_ref ? `from order ${props.result.order_ref}` : undefined,
          added_at: new Date().toISOString(),
        }
        accessories.add(a)
      }
    }
  }
  const results = await Promise.all([
    touchedFilaments ? filaments.save() : Promise.resolve({ ok: true, offlineFallback: false }),
    touchedAccessories ? accessories.save() : Promise.resolve({ ok: true, offlineFallback: false }),
  ])
  saving.value = false
  const allOk = results.every(r => r.ok)
  const anyOffline = results.some(r => !r.ok && r.offlineFallback)
  message.value = allOk ? 'Imported.' : (anyOffline ? 'Helper offline — saved to localStorage.' : 'Save failed (partial).')
  if (newFilamentIds.length > 0) {
    message.value = `Imported. Resolving swatches… (0/${newFilamentIds.length})`
    const resolved = await resolveSwatchesAsync()
    message.value = `Imported. Swatches resolved: ${resolved}/${newFilamentIds.length}.`
  }
  setTimeout(() => emit('done'), 1200)
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-12 px-4">
    <div class="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[85vh]">
      <header class="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h3 class="font-semibold">Review extracted order</h3>
          <p class="text-xs text-slate-400 mt-0.5">
            <template v-if="result.vendor_guess">Vendor: <strong>{{ result.vendor_guess }}</strong></template>
            <template v-if="result.order_ref"> &middot; Ref: {{ result.order_ref }}</template>
            <template v-if="result.order_date"> &middot; {{ result.order_date }}</template>
            <template v-if="result.total_eur != null"> &middot; Total: €{{ result.total_eur.toFixed(2) }}</template>
          </p>
        </div>
        <button @click="emit('cancel')" class="p-1 text-slate-400 hover:text-slate-100" aria-label="Cancel">
          <X :size="18" />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-800/50 text-xs uppercase tracking-wide text-slate-400 sticky top-0">
            <tr>
              <th class="px-3 py-2 text-left w-8"></th>
              <th class="px-3 py-2 text-left">Item</th>
              <th class="px-3 py-2 text-left">Kind</th>
              <th class="px-3 py-2 text-left">Match</th>
              <th class="px-3 py-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
            <tr v-for="(item, i) in result.items" :key="i" :class="{ 'opacity-40': !rows[i].enabled }">
              <td class="px-3 py-2">
                <input
                  type="checkbox"
                  v-model="rows[i].enabled"
                  class="h-4 w-4 accent-sky-500"
                />
              </td>
              <td class="px-3 py-2">
                <div class="font-medium">{{ item.brand }} &middot; {{ item.name }}</div>
                <div class="text-xs text-slate-500">
                  <template v-if="item.variant">{{ item.variant }}</template>
                  <template v-if="item.sku"> &middot; SKU {{ item.sku }}</template>
                  <template v-if="item.ean"> &middot; EAN {{ item.ean }}</template>
                  <template v-if="item.unit_price_eur != null"> &middot; €{{ item.unit_price_eur.toFixed(2) }}/ea</template>
                </div>
              </td>
              <td class="px-3 py-2 text-xs text-slate-300 uppercase tracking-wide">{{ item.kind }}</td>
              <td class="px-3 py-2 text-xs">
                <span v-if="item.kind !== 'filament'" class="text-slate-500">— skipped —</span>
                <span v-else-if="rows[i].matchedId" class="text-emerald-400 flex items-center gap-1"><Check :size="14" /> existing</span>
                <span v-else class="text-amber-400">+ new entry</span>
              </td>
              <td class="px-3 py-2 text-right">
                <input
                  v-model.number="rows[i].quantity"
                  type="number"
                  min="0"
                  class="w-14 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-right text-sm"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="px-4 py-3 border-t border-slate-800 flex items-center justify-between">
        <p class="text-xs text-slate-400">
          {{ enabledCount }} selected
          <template v-if="filamentMatchCount + filamentNewCount + accessoryMatchCount + accessoryNewCount > 0">
            (filaments: {{ filamentMatchCount }} match → +sealed, {{ filamentNewCount }} new;
            accessories: {{ accessoryMatchCount }} match → +stock, {{ accessoryNewCount }} new<template v-if="skippedCount">; {{ skippedCount }} unknown skipped</template>)
          </template>
          <template v-if="message"> &middot; {{ message }}</template>
        </p>
        <div class="flex gap-2">
          <button
            @click="emit('cancel')"
            class="px-3 py-1.5 text-sm border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
          >Cancel</button>
          <button
            @click="apply"
            :disabled="saving || enabledCount === 0"
            class="px-3 py-1.5 text-sm rounded bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40"
          >Apply to inventory</button>
        </div>
      </footer>
    </div>
  </div>
</template>
