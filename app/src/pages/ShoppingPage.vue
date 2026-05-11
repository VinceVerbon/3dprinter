<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount, computed } from 'vue'
import { useShoppingStore } from '../stores/shopping'
import { useCatalogStore } from '../stores/catalog'
import type { ShoppingItem } from '../types'
import { Plus, Trash2, Printer, Eraser, BookOpen } from 'lucide-vue-next'
import CatalogPicker from '../components/CatalogPicker.vue'

const store = useShoppingStore()
const catalog = useCatalogStore()
const newLabel = ref('')
const newQty = ref(1)
const saving = ref(false)
const message = ref<string | null>(null)
const showPicker = ref(false)

onMounted(async () => {
  await Promise.all([store.load(), catalog.load()])
  await backfillPricesFromCatalog()
})

async function backfillPricesFromCatalog() {
  let changed = 0
  for (const item of store.items) {
    if (item.unit_price_eur != null) continue
    if (item.source_type !== 'replacement_part' || !item.source_id) continue
    const part = catalog.parts.find(p => p.id === item.source_id)
    if (part?.price_eur_estimate != null) {
      store.update(item.id, { unit_price_eur: part.price_eur_estimate })
      changed++
    }
  }
  if (changed > 0) {
    const r = await store.save()
    message.value = r.ok
      ? `Backfilled prices on ${changed} item${changed === 1 ? '' : 's'} from catalog.`
      : 'Backfill done locally; save failed.'
    setTimeout(() => (message.value = null), 4000)
  }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

async function persist() {
  saving.value = true
  const r = await store.save()
  saving.value = false
  message.value = r.ok ? 'Saved.' : (r.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
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

async function addFromCatalog(picked: { source_type: 'replacement_part' | 'consumable'; source_id: string; label: string; notes?: string; unit_price_eur?: number }) {
  const item: ShoppingItem = {
    id: uuid(),
    source_type: picked.source_type,
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

const openTotalPriced = computed(() =>
  store.open.reduce((sum, i) => sum + (lineTotal(i) ?? 0), 0),
)
const openUnpricedCount = computed(() =>
  store.open.filter(i => i.unit_price_eur == null).length,
)
const doneTotalPriced = computed(() =>
  store.done.reduce((sum, i) => sum + (lineTotal(i) ?? 0), 0),
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

    <p v-if="message" class="text-xs text-slate-400 mb-2 print:hidden">{{ message }}</p>

    <div class="flex gap-2 mb-2 print:hidden">
      <button
        @click="showPicker = true"
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800"
      >
        <BookOpen :size="14" /> Add from catalog
      </button>
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

    <div v-if="store.items.length === 0" class="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-800 rounded-lg print:hidden">
      Empty list. Add from catalog or type a free-text item above.
    </div>

    <ul v-else class="grid gap-1.5">
      <li
        v-for="item in store.items"
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
      v-if="store.items.length > 0"
      class="mt-3 px-3 py-2 border border-slate-800 rounded bg-slate-900/40 text-sm flex items-center justify-between gap-3"
    >
      <div class="text-slate-400">
        <span class="text-slate-200 font-medium">Estimated total</span>
        <span v-if="openUnpricedCount > 0" class="text-xs text-slate-500"> &middot; {{ openUnpricedCount }} item<template v-if="openUnpricedCount !== 1">s</template> without price not counted</span>
      </div>
      <div class="text-right tabular-nums">
        <div class="text-base text-slate-100 font-semibold">{{ fmtEur(openTotalPriced) }}</div>
        <div v-if="store.done.length > 0" class="text-xs text-slate-500">+ {{ fmtEur(doneTotalPriced) }} already checked off</div>
      </div>
    </footer>

    <p class="text-xs text-slate-500 mt-4 print:hidden">
      Tip: open this on your phone via the same Wi-Fi at <code class="text-slate-300">http://&lt;your-pc-ip&gt;:5173/#/shopping</code>, or use Print → Save as PDF for an offline checklist. Prices are estimates snapshotted from the catalog at the moment you added each item.
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
