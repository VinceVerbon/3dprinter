<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount } from 'vue'
import { useShoppingStore } from '../stores/shopping'
import type { ShoppingItem } from '../types'
import { Plus, Trash2, Printer, Eraser, BookOpen } from 'lucide-vue-next'
import CatalogPicker from '../components/CatalogPicker.vue'

const store = useShoppingStore()
const newLabel = ref('')
const newQty = ref(1)
const saving = ref(false)
const message = ref<string | null>(null)
const showPicker = ref(false)

onMounted(() => store.load())

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

async function addFromCatalog(picked: { source_type: 'replacement_part' | 'consumable'; source_id: string; label: string; notes?: string }) {
  const item: ShoppingItem = {
    id: uuid(),
    source_type: picked.source_type,
    source_id: picked.source_id,
    label: picked.label,
    quantity: 1,
    notes: picked.notes,
    added_at: new Date().toISOString(),
  }
  store.add(item)
  showPicker.value = false
  await persist()
}

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
        <button
          @click="remove(item.id)"
          class="p-1 text-slate-500 hover:text-red-400 print:hidden"
          title="Remove"
        ><Trash2 :size="14" /></button>
      </li>
    </ul>

    <p class="text-xs text-slate-500 mt-4 print:hidden">
      Tip: open this on your phone via the same Wi-Fi at <code class="text-slate-300">http://&lt;your-pc-ip&gt;:5173/#/shopping</code>, or use Print → Save as PDF for an offline checklist.
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
