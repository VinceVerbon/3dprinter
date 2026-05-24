<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useStoreListsStore } from '../stores/storeLists'
import type { StoreItem, StoreList } from '../types'
import { Search, X } from 'lucide-vue-next'

const emit = defineEmits<{
  pick: [
    {
      source_type: 'replacement_part'   // maps to the existing ShoppingItem union value
      source_id: string                 // `${brand}|${item.name}` — stable label key
      label: string
      notes?: string
      unit_price_eur?: number
    },
  ]
  close: []
}>()

const storeLists = useStoreListsStore()
const brandFilter = ref<string>('')   // '' = all brands
const query = ref('')

onMounted(async () => {
  if (!storeLists.loaded) await storeLists.load()
  // Default to first brand if one exists
  if (!brandFilter.value && storeLists.brands.length > 0) {
    brandFilter.value = storeLists.brands[0]
  }
})

/** Lists to show: filtered by selected brand, or all if '' */
const activeLists = computed<StoreList[]>(() => {
  if (!brandFilter.value) return storeLists.lists
  return storeLists.lists.filter((l) => l.brand === brandFilter.value)
})

/** All items across active lists, each annotated with its brand */
interface FlatItem {
  brand: string
  item: StoreItem
}
const flatItems = computed<FlatItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  const out: FlatItem[] = []
  for (const list of activeLists.value) {
    for (const item of list.items) {
      if (
        !q ||
        item.name.toLowerCase().includes(q) ||
        (item.sku || '').toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q)
      ) {
        out.push({ brand: list.brand, item })
      }
    }
  }
  return out
})

/** Group flat items by brand for display */
const grouped = computed<Array<{ brand: string; items: StoreItem[] }>>(() => {
  const map = new Map<string, StoreItem[]>()
  for (const { brand, item } of flatItems.value) {
    if (!map.has(brand)) map.set(brand, [])
    map.get(brand)!.push(item)
  }
  return [...map.entries()].map(([brand, items]) => ({ brand, items }))
})

const totalCount = computed(() => flatItems.value.length)

function pickItem(brand: string, item: StoreItem) {
  emit('pick', {
    source_type: 'replacement_part',
    source_id: `${brand}|${item.name}`,
    label: item.name + (item.sku ? ` (${item.sku})` : ''),
    notes: item.note,
    unit_price_eur: item.price_eur,
  })
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-16 px-4">
    <div class="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
      <header class="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h3 class="font-semibold">Add from store list</h3>
        <button
          @click="emit('close')"
          class="p-1 text-slate-400 hover:text-slate-100"
          aria-label="Close"
        ><X :size="18" /></button>
      </header>

      <!-- Brand filter tabs -->
      <div class="px-4 pt-3 flex items-center gap-2 flex-wrap border-b border-slate-800 pb-0">
        <button
          @click="brandFilter = ''"
          :class="['px-3 py-1.5 text-sm rounded-t', brandFilter === ''
            ? 'bg-slate-800 text-slate-100 border-x border-t border-slate-700'
            : 'text-slate-400 hover:text-slate-200']"
        >
          All
          <span class="text-slate-500">({{ storeLists.lists.reduce((n, l) => n + l.items.length, 0) }})</span>
        </button>
        <button
          v-for="brand in storeLists.brands"
          :key="brand"
          @click="brandFilter = brand"
          :class="['px-3 py-1.5 text-sm rounded-t', brandFilter === brand
            ? 'bg-slate-800 text-slate-100 border-x border-t border-slate-700'
            : 'text-slate-400 hover:text-slate-200']"
        >
          {{ brand }}
          <span class="text-slate-500">({{ storeLists.lists.filter((l) => l.brand === brand).reduce((n, l) => n + l.items.length, 0) }})</span>
        </button>
      </div>

      <!-- Search -->
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

      <!-- Item list -->
      <div class="overflow-y-auto flex-1">
        <!-- No store lists at all -->
        <div v-if="storeLists.count === 0" class="px-4 py-8 text-center text-sm text-slate-400">
          No store lists yet. Close this panel and use <strong class="text-slate-200">Update store</strong> on the Shopping page to fetch items for a brand, or add items manually with free text.
        </div>

        <!-- Has lists but search/filter returned nothing -->
        <div v-else-if="totalCount === 0" class="px-4 py-6 text-center text-sm text-slate-500">
          No items match.
        </div>

        <!-- Items grouped by brand -->
        <template v-else>
          <div v-for="group in grouped" :key="group.brand">
            <div
              v-if="grouped.length > 1"
              class="px-4 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-900/60 border-b border-slate-800"
            >
              {{ group.brand }}
            </div>
            <ul class="divide-y divide-slate-800">
              <li
                v-for="item in group.items"
                :key="item.name"
                class="px-4 py-2.5 hover:bg-slate-800/40 cursor-pointer"
                @click="pickItem(group.brand, item)"
              >
                <div class="flex items-baseline justify-between gap-3">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ item.name }}</p>
                    <p class="text-xs text-slate-500 truncate">
                      <span v-if="item.category" class="uppercase tracking-wide">{{ item.category }}</span>
                      <template v-if="item.sku"> &middot; SKU {{ item.sku }}</template>
                      <template v-if="item.note"> &middot; {{ item.note }}</template>
                    </p>
                  </div>
                  <div class="flex items-center gap-3 shrink-0">
                    <span v-if="item.price_eur != null" class="text-xs text-slate-400 tabular-nums">€{{ item.price_eur.toFixed(2) }}</span>
                    <a
                      v-if="item.url"
                      :href="item.url"
                      target="_blank"
                      rel="noopener"
                      class="text-xs text-sky-400 hover:underline"
                      @click.stop
                    >link ↗</a>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </template>
      </div>

      <footer class="px-4 py-2 border-t border-slate-800 text-xs text-slate-500">
        Click an item to add it to your shopping list. Hit Esc or × to close.
      </footer>
    </div>
  </div>
</template>
