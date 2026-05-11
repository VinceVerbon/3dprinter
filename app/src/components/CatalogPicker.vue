<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useCatalogStore } from '../stores/catalog'
import type { CatalogReplacementPart, CatalogConsumable } from '../types'
import { Search, X } from 'lucide-vue-next'

const emit = defineEmits<{
  pick: [
    {
      source_type: 'replacement_part' | 'consumable'
      source_id: string
      label: string
      notes?: string
      unit_price_eur?: number
    },
  ]
  close: []
}>()

const store = useCatalogStore()
const tab = ref<'parts' | 'consumables'>('parts')
const query = ref('')

onMounted(() => store.load())

const partsFiltered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.parts
  return store.parts.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.sku || '').toLowerCase().includes(q) ||
    (p.sub_category || '').toLowerCase().includes(q),
  )
})
const consumablesFiltered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.consumables
  return store.consumables.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.category).toLowerCase().includes(q),
  )
})

function pickPart(p: CatalogReplacementPart) {
  emit('pick', {
    source_type: 'replacement_part',
    source_id: p.id,
    label: p.name + (p.sku ? ` (${p.sku})` : ''),
    notes: p.notes,
    unit_price_eur: p.price_eur_estimate,
  })
}
function pickConsumable(c: CatalogConsumable) {
  emit('pick', {
    source_type: 'consumable',
    source_id: c.id,
    label: c.name,
    notes: c.notes,
  })
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-16 px-4">
    <div class="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
      <header class="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h3 class="font-semibold">Add from catalog</h3>
        <button
          @click="emit('close')"
          class="p-1 text-slate-400 hover:text-slate-100"
          aria-label="Close"
        ><X :size="18" /></button>
      </header>

      <div class="px-4 pt-3 flex items-center gap-2 border-b border-slate-800">
        <button
          @click="tab = 'parts'"
          :class="['px-3 py-1.5 text-sm rounded-t', tab === 'parts'
            ? 'bg-slate-800 text-slate-100 border-x border-t border-slate-700'
            : 'text-slate-400 hover:text-slate-200']"
        >Replacement parts <span class="text-slate-500">({{ store.parts.length }})</span></button>
        <button
          @click="tab = 'consumables'"
          :class="['px-3 py-1.5 text-sm rounded-t', tab === 'consumables'
            ? 'bg-slate-800 text-slate-100 border-x border-t border-slate-700'
            : 'text-slate-400 hover:text-slate-200']"
        >Consumables <span class="text-slate-500">({{ store.consumables.length }})</span></button>
      </div>

      <div class="px-4 py-3 border-b border-slate-800">
        <div class="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded px-2 py-1">
          <Search :size="14" class="text-slate-500" />
          <input
            v-model="query"
            placeholder="Search by name / SKU / category"
            class="flex-1 bg-transparent text-sm text-slate-100 outline-none"
          />
        </div>
      </div>

      <div class="overflow-y-auto flex-1">
        <ul v-if="tab === 'parts'" class="divide-y divide-slate-800">
          <li
            v-for="p in partsFiltered"
            :key="p.id"
            class="px-4 py-2.5 hover:bg-slate-800/40 cursor-pointer"
            @click="pickPart(p)"
          >
            <div class="flex items-baseline justify-between gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ p.name }}</p>
                <p class="text-xs text-slate-500 truncate">
                  <span class="uppercase tracking-wide">{{ p.category }}</span>
                  <template v-if="p.sub_category"> &middot; {{ p.sub_category }}</template>
                  <template v-if="p.sku"> &middot; SKU {{ p.sku }}</template>
                </p>
              </div>
              <span v-if="p.price_eur_estimate != null" class="text-xs text-slate-400 tabular-nums whitespace-nowrap">€{{ p.price_eur_estimate.toFixed(2) }}</span>
            </div>
          </li>
          <li v-if="partsFiltered.length === 0" class="px-4 py-6 text-center text-sm text-slate-500">
            No matches.
          </li>
        </ul>
        <ul v-else class="divide-y divide-slate-800">
          <li
            v-for="c in consumablesFiltered"
            :key="c.id"
            class="px-4 py-2.5 hover:bg-slate-800/40 cursor-pointer"
            @click="pickConsumable(c)"
          >
            <div class="flex items-baseline justify-between gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ c.name }}</p>
                <p class="text-xs text-slate-500 truncate">
                  <span class="uppercase tracking-wide">{{ c.category }}</span>
                  <template v-if="c.typical_unit"> &middot; {{ c.typical_unit }}</template>
                </p>
              </div>
              <a
                v-if="c.source_url"
                :href="c.source_url"
                target="_blank"
                rel="noopener"
                class="text-xs text-sky-400 hover:underline whitespace-nowrap"
                @click.stop
              >link ↗</a>
            </div>
          </li>
          <li v-if="consumablesFiltered.length === 0" class="px-4 py-6 text-center text-sm text-slate-500">
            No matches.
          </li>
        </ul>
      </div>

      <footer class="px-4 py-2 border-t border-slate-800 text-xs text-slate-500">
        Click an item to add it to your shopping list. Hit Esc or × to close.
      </footer>
    </div>
  </div>
</template>
