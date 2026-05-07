<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFilamentsStore } from '../stores/filaments'
import type { Filament } from '../types'
import type { ImportResult, ImportedItem } from './OrderDropZone.vue'
import { Check, X } from 'lucide-vue-next'

const props = defineProps<{ result: ImportResult }>()
const emit = defineEmits<{ done: []; cancel: [] }>()

const filaments = useFilamentsStore()

type RowState = {
  enabled: boolean
  quantity: number
  matchedId: string | null  // existing filament id, or null = create new
}

const rows = ref<RowState[]>(
  props.result.items.map(i => ({
    enabled: true,
    quantity: i.quantity,
    matchedId: findMatch(i),
  })),
)

function findMatch(item: ImportedItem): string | null {
  if (item.kind !== 'filament') return null
  const norm = (s?: string) => (s ?? '').trim().toLowerCase()
  const target = filaments.items.find(f =>
    (item.sku && norm(f.sku) === norm(item.sku)) ||
    (item.ean && norm(f.ean) === norm(item.ean)) ||
    (norm(f.brand) === norm(item.brand) &&
     norm(f.name) === norm(item.name) &&
     norm(f.variant) === norm(item.variant)),
  )
  return target?.id ?? null
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'f_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const enabledCount = computed(() => rows.value.filter(r => r.enabled).length)
const newCount = computed(() => rows.value.filter((r, i) => r.enabled && props.result.items[i].kind === 'filament' && r.matchedId === null).length)
const matchedCount = computed(() => rows.value.filter((r, i) => r.enabled && props.result.items[i].kind === 'filament' && r.matchedId != null).length)

const saving = ref(false)
const message = ref<string | null>(null)

async function apply() {
  saving.value = true
  for (let i = 0; i < props.result.items.length; i++) {
    const item = props.result.items[i]
    const row = rows.value[i]
    if (!row.enabled) continue
    if (item.kind !== 'filament') continue   // accessories handled in Accessories page; v0.2.x extension
    if (row.matchedId) {
      const existing = filaments.items.find(f => f.id === row.matchedId)
      if (existing) {
        const inv = existing.inventory ?? { sealed: 0, open: 0, in_use: 0 }
        filaments.update(existing.id, {
          inventory: { ...inv, sealed: (inv.sealed ?? 0) + row.quantity },
        } as Partial<Filament>)
      }
    } else {
      const f: Filament = {
        id: uuid(),
        brand: item.brand,
        name: item.name,
        variant: item.variant,
        sku: item.sku,
        ean: item.ean,
        swatch: { hex: '#888888', stops: ['#888888'], effects: [], source: 'manual' },
        inventory: { sealed: row.quantity, open: 0, in_use: 0 },
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
    }
  }
  const r = await filaments.save()
  saving.value = false
  message.value = r.ok ? 'Imported.' : (r.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
  setTimeout(() => emit('done'), 800)
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
          <template v-if="newCount + matchedCount > 0">
            ({{ matchedCount }} match{{ matchedCount === 1 ? '' : 'es' }} → +{{ matchedCount }} sealed,
            {{ newCount }} new {{ newCount === 1 ? 'entry' : 'entries' }})
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
