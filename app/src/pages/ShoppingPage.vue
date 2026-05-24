<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount, computed } from 'vue'
import { useShoppingStore } from '../stores/shopping'
import { useStoreListsStore } from '../stores/storeLists'
import { usePrintersStore } from '../stores/printers'
import { useStoreFetch } from '../composables/useStoreFetch'
import type { ShoppingItem } from '../types'
import { Plus, Trash2, Printer, Eraser, BookOpen, RefreshCw } from 'lucide-vue-next'
import CatalogPicker from '../components/CatalogPicker.vue'

const store = useShoppingStore()
const storeLists = useStoreListsStore()
const printersStore = usePrintersStore()
const { fetchStore, loading: fetchLoading, error: fetchError } = useStoreFetch()

const newLabel = ref('')
const newQty = ref(1)
const saving = ref(false)
const message = ref<string | null>(null)
const showPicker = ref(false)

// Brand-store panel state — selection is per owned PRINTER (make+model),
// because the parts list differs per model.
const selectedBrand = ref<string>('')
const selectedModel = ref<string | null>(null)
/** Editable store URL (prefilled from the brand's EU store base / printer). */
const editableStoreUrl = ref<string>('')
/** Filter: '' = show items from all owned stores; else a brand. */
const storeFilter = ref<string>('')

function printerKey(brand: string, model?: string | null): string {
  return `${brand}${model ?? ''}`
}
const selectedKey = computed(() => printerKey(selectedBrand.value, selectedModel.value))

interface PrinterOption { brand: string; model: string | null; label: string; key: string }
/** Owned printers (make+model), plus any already-fetched lists not currently owned. */
const ownedPrinters = computed<PrinterOption[]>(() => {
  const seen = new Map<string, PrinterOption>()
  const add = (brand: string, model: string | null) => {
    if (!brand) return
    const key = printerKey(brand, model)
    if (!seen.has(key)) seen.set(key, { brand, model: model || null, label: model ? `${brand} ${model}` : brand, key })
  }
  for (const p of printersStore.printers) add(p.brand, p.model ?? null)
  for (const l of storeLists.lists) add(l.brand, l.model ?? null)
  return [...seen.values()]
})

function selectPrinter(brand: string, model: string | null) {
  selectedBrand.value = brand
  selectedModel.value = model
  editableStoreUrl.value = storeUrlForBrand(brand)
}

onMounted(async () => {
  await Promise.all([store.load(), storeLists.load(), printersStore.load()])
  const a = printersStore.active
  if (a?.brand) selectPrinter(a.brand, a.model ?? null)
  else if (ownedPrinters.value.length > 0) {
    const p = ownedPrinters.value[0]
    selectPrinter(p.brand, p.model)
  }
})

// Known EU store bases per brand — used so the prefill is the actual shop, not
// a printer product page (the owned printer's store_url is often a US/model
// page, e.g. us.store.bambulab.com/products/p1s, which isn't where parts live).
const BRAND_STORE_BASE: Record<string, string> = {
  'bambu lab': 'https://eu.store.bambulab.com',
}

function storeUrlForBrand(brand: string): string {
  // 1) an already-fetched list's canonical url (helper returns the right base),
  // 2) a known EU brand store base, 3) the owned printer's store_url (last
  // resort — may be a US/product page), else ''.
  const fetched = storeLists.get(brand)?.store_url
  if (fetched) return fetched
  const base = BRAND_STORE_BASE[brand.trim().toLowerCase()]
  if (base) return base
  const printer = printersStore.printers.find(
    (p) => p.brand.toLowerCase() === brand.toLowerCase(),
  )
  return printer?.store_url ?? ''
}

function onPrinterChange(key: string) {
  const p = ownedPrinters.value.find((x) => x.key === key)
  if (p) selectPrinter(p.brand, p.model)
}

const selectedList = computed(() =>
  selectedBrand.value ? storeLists.get(selectedBrand.value, selectedModel.value) : undefined,
)

const ageLabel = computed<string>(() => {
  const list = selectedList.value
  if (!list) return ''
  const days = storeLists.ageDays(list)
  if (!isFinite(days)) return 'unknown age'
  if (days < 1) return 'updated today'
  if (days < 2) return 'updated yesterday'
  return `updated ${Math.floor(days)} day${Math.floor(days) !== 1 ? 's' : ''} ago`
})

const isStale = computed(() =>
  selectedList.value ? storeLists.isStale(selectedList.value) : false,
)

async function doFetch() {
  if (!selectedBrand.value) return
  await fetchStore(selectedBrand.value, selectedModel.value ?? undefined, editableStoreUrl.value || undefined, true)
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

async function persist() {
  saving.value = true
  const r = await store.save()
  saving.value = false
  message.value = r.ok
    ? 'Saved.'
    : r.offlineFallback
      ? 'Helper offline — saved to localStorage.'
      : 'Save failed.'
  setTimeout(() => (message.value = null), 4000)
}

async function add() {
  const label = newLabel.value.trim()
  if (!label) return
  const item: ShoppingItem = {
    id: uuid(),
    source_type: 'free_text',
    label,
    quantity: Math.max(1, newQty.value | 0),
    added_at: new Date().toISOString(),
  }
  store.add(item)
  newLabel.value = ''
  newQty.value = 1
  await persist()
}

async function addFromCatalog(picked: {
  source_type: 'replacement_part'
  source_id: string
  label: string
  notes?: string
  unit_price_eur?: number
}) {
  const item: ShoppingItem = {
    id: uuid(),
    source_type: 'replacement_part',
    source_id: picked.source_id,
    label: picked.label,
    quantity: 1,
    unit_price_eur: picked.unit_price_eur,
    notes: picked.notes,
    added_at: new Date().toISOString(),
  }
  store.add(item)
  showPicker.value = false
  await persist()
}

function lineTotal(item: ShoppingItem): number | null {
  if (item.unit_price_eur == null) return null
  return item.unit_price_eur * Math.max(1, item.quantity | 0)
}
function fmtEur(v: number): string {
  return '€' + v.toFixed(2)
}

/** Items to display, optionally filtered to one brand-store's source_ids */
const filteredItems = computed(() => {
  if (!storeFilter.value) return store.items
  const prefix = `${storeFilter.value}|`
  return store.items.filter(
    (i) => i.source_type === 'replacement_part' && !!i.source_id && i.source_id.startsWith(prefix),
  )
})

const openTotalPriced = computed(() =>
  filteredItems.value.filter((i) => !i.done).reduce((sum, i) => sum + (lineTotal(i) ?? 0), 0),
)
const openUnpricedCount = computed(() =>
  filteredItems.value.filter((i) => !i.done && i.unit_price_eur == null).length,
)
const doneTotalPriced = computed(() =>
  filteredItems.value.filter((i) => i.done).reduce((sum, i) => sum + (lineTotal(i) ?? 0), 0),
)

async function toggle(id: string) {
  store.toggleDone(id)
  await persist()
}
async function remove(id: string) {
  store.remove(id)
  await persist()
}
async function clearDone() {
  store.clearDone()
  await persist()
}

function printList() {
  window.print()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') showPicker.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="max-w-2xl">
    <header class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">
        Shopping list
        <span class="text-slate-500 font-normal">
          ({{ store.open.length }} open<template v-if="store.done.length">, {{ store.done.length }} done</template>)
        </span>
      </h2>
      <div class="flex items-center gap-2 print:hidden">
        <button
          v-if="store.done.length > 0"
          @click="clearDone"
          class="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-slate-700 text-slate-400 hover:text-slate-200"
          title="Remove all checked items"
        >
          <Eraser :size="14" /> Clear done
        </button>
        <button
          @click="printList"
          class="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-slate-700 text-slate-300 hover:text-slate-100"
          title="Print or save as PDF"
        >
          <Printer :size="14" /> Print
        </button>
      </div>
    </header>

    <!-- ------------------------------------------------------------------ -->
    <!-- Brand-store panel                                                   -->
    <!-- ------------------------------------------------------------------ -->
    <div class="mb-4 border border-slate-800 rounded-lg bg-slate-900/40 print:hidden">
      <div class="px-3 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <span class="text-xs text-slate-400 font-medium shrink-0">Brand store</span>

        <!-- Brand selector -->
        <select
          v-if="ownedPrinters.length > 0"
          :value="selectedKey"
          @change="onPrinterChange(($event.target as HTMLSelectElement).value)"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-sm text-slate-200"
        >
          <option v-for="p in ownedPrinters" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
        <span v-else class="text-xs text-slate-500">No printers configured — add one in the Printers tab first.</span>

        <!-- Age / staleness indicator -->
        <span
          v-if="selectedList"
          class="ml-auto text-xs"
          :class="isStale ? 'text-amber-400' : 'text-slate-500'"
        >
          {{ ageLabel }}<template v-if="isStale"> — stale</template>
        </span>
        <span v-else-if="selectedBrand" class="ml-auto text-xs text-slate-500">No list yet</span>
      </div>

      <div class="px-3 py-2 flex items-start gap-2 flex-wrap">
        <!-- Editable store URL -->
        <input
          v-model="editableStoreUrl"
          placeholder="Store URL (optional)"
          class="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
          :disabled="!selectedBrand"
        />
        <!-- Update button -->
        <button
          @click="doFetch"
          :disabled="!selectedBrand || fetchLoading"
          class="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 shrink-0"
        >
          <RefreshCw :size="12" :class="{ 'animate-spin': fetchLoading }" />
          {{ fetchLoading ? 'Fetching…' : 'Update store' }}
        </button>
      </div>

      <!-- Fetch error -->
      <div v-if="fetchError" class="px-3 pb-2 text-xs text-red-400">
        Fetch failed: {{ fetchError }}. Try again, or add items manually with free text below.
      </div>

      <!-- Empty state for selected brand -->
      <div
        v-if="selectedBrand && !selectedList && !fetchLoading && !fetchError"
        class="px-3 pb-2 text-xs text-slate-500"
      >
        No store list yet — click <strong class="text-slate-300">Update store</strong> to fetch, or add items manually below.
      </div>
    </div>

    <!-- ------------------------------------------------------------------ -->
    <!-- Toolbar: store filter + add-from-catalog + free-text               -->
    <!-- ------------------------------------------------------------------ -->
    <p v-if="message" class="text-xs text-slate-400 mb-2 print:hidden">{{ message }}</p>

    <div class="flex gap-2 mb-2 print:hidden flex-wrap items-center">
      <button
        @click="showPicker = true"
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800"
      >
        <BookOpen :size="14" /> Add from store list
      </button>

      <!-- Per-store filter: only visible when at least one list exists -->
      <template v-if="storeLists.count > 0">
        <span class="text-xs text-slate-500">Show:</span>
        <select
          v-model="storeFilter"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
        >
          <option value="">All items</option>
          <option v-for="b in storeLists.brands" :key="b" :value="b">{{ b }} store only</option>
        </select>
      </template>
    </div>

    <form
      @submit.prevent="add"
      class="flex gap-2 mb-4 print:hidden"
    >
      <input
        v-model="newLabel"
        placeholder="Add free-text item (e.g. zip ties)"
        class="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
      />
      <input
        v-model.number="newQty"
        type="number"
        min="1"
        class="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
      />
      <button
        type="submit"
        :disabled="!newLabel.trim()"
        class="flex items-center gap-1 px-3 py-1 text-sm rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40"
      >
        <Plus :size="14" /> Add
      </button>
    </form>

    <!-- ------------------------------------------------------------------ -->
    <!-- Shopping list                                                       -->
    <!-- ------------------------------------------------------------------ -->
    <div v-if="filteredItems.length === 0" class="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-800 rounded-lg print:hidden">
      <template v-if="storeFilter">
        No items from the <strong class="text-slate-300">{{ storeFilter }}</strong> store in your list yet.
        <a class="text-sky-400 hover:underline cursor-pointer" @click="storeFilter = ''">Show all items</a> or
        <a class="text-sky-400 hover:underline cursor-pointer" @click="showPicker = true">add from store list</a>.
      </template>
      <template v-else>
        Empty list. Add from store list or type a free-text item above.
      </template>
    </div>

    <ul v-else class="grid gap-1.5">
      <li
        v-for="item in filteredItems"
        :key="item.id"
        class="flex items-center gap-2 px-3 py-2 border border-slate-800 rounded bg-slate-900/40"
        :class="{ 'opacity-50': item.done }"
      >
        <input
          type="checkbox"
          :checked="item.done"
          @change="toggle(item.id)"
          class="h-4 w-4 accent-sky-500 cursor-pointer"
        />
        <span class="flex-1" :class="{ 'line-through text-slate-500': item.done }">
          <strong class="text-slate-200">{{ item.quantity }}×</strong>
          {{ item.label }}
          <span v-if="item.notes" class="text-xs text-slate-500"> — {{ item.notes }}</span>
        </span>
        <span class="text-xs tabular-nums whitespace-nowrap text-slate-300" :class="{ 'line-through text-slate-500': item.done }">
          <template v-if="lineTotal(item) != null">{{ fmtEur(lineTotal(item)!) }}</template>
          <span v-else class="text-slate-600">—</span>
        </span>
        <button
          @click="remove(item.id)"
          class="p-1 text-slate-500 hover:text-red-400 print:hidden"
          title="Remove"
        ><Trash2 :size="14" /></button>
      </li>
    </ul>

    <footer
      v-if="filteredItems.length > 0"
      class="mt-3 px-3 py-2 border border-slate-800 rounded bg-slate-900/40 text-sm flex items-center justify-between gap-3"
    >
      <div class="text-slate-400">
        <span class="text-slate-200 font-medium">Estimated total</span>
        <span v-if="openUnpricedCount > 0" class="text-xs text-slate-500">
          &middot; {{ openUnpricedCount }} item<template v-if="openUnpricedCount !== 1">s</template> without price not counted
        </span>
        <span v-if="storeFilter" class="text-xs text-slate-500"> &middot; {{ storeFilter }} store only</span>
      </div>
      <div class="text-right tabular-nums">
        <div class="text-base text-slate-100 font-semibold">{{ fmtEur(openTotalPriced) }}</div>
        <div v-if="filteredItems.some(i => i.done)" class="text-xs text-slate-500">+ {{ fmtEur(doneTotalPriced) }} already checked off</div>
      </div>
    </footer>

    <p class="text-xs text-slate-500 mt-4 print:hidden">
      Tip: open this on your phone via the same Wi-Fi at <code class="text-slate-300">http://&lt;your-pc-ip&gt;:5173/#/shopping</code>, or use Print → Save as PDF for an offline checklist. Prices are estimates snapshotted at the moment you added each item.
    </p>

    <CatalogPicker
      v-if="showPicker"
      @pick="addFromCatalog"
      @close="showPicker = false"
    />
  </section>
</template>

<style scoped>
@media print {
  section { color: black; }
}
</style>
