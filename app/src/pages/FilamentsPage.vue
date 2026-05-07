<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useFilamentsStore } from '../stores/filaments'
import FilamentCard from '../components/FilamentCard.vue'
import FilamentForm from '../components/FilamentForm.vue'
import OrderDropZone, { type ImportResult } from '../components/OrderDropZone.vue'
import OrderImportReview from '../components/OrderImportReview.vue'
import type { Filament } from '../types'
import { Plus, FileUp } from 'lucide-vue-next'

const store = useFilamentsStore()
const showForm = ref(false)
const editing = ref<Filament | undefined>(undefined)
const saving = ref(false)
const message = ref<string | null>(null)
const showDropZone = ref(false)
const importResult = ref<ImportResult | null>(null)

onMounted(() => store.load())

const filaments = computed(() => store.items)

function startAdd() { editing.value = undefined; showForm.value = true; message.value = null }
function startEdit(id: string) {
  const f = store.items.find(x => x.id === id)
  if (f) { editing.value = f; showForm.value = true; message.value = null }
}
async function onSubmit(f: Filament) {
  if (editing.value) store.update(f.id, f)
  else store.add(f)
  showForm.value = false
  saving.value = true
  const r = await store.save()
  saving.value = false
  message.value = r.ok ? 'Saved.' : (r.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
  setTimeout(() => (message.value = null), 4000)
}
async function onRemove(id: string) {
  store.remove(id)
  saving.value = true
  await store.save()
  saving.value = false
}

function onImportResult(result: ImportResult) {
  importResult.value = result
  showDropZone.value = false
}
function onImportDone() {
  importResult.value = null
  message.value = 'Order imported.'
  setTimeout(() => (message.value = null), 4000)
}
</script>

<template>
  <section class="max-w-3xl">
    <header class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">Filaments <span class="text-slate-500 font-normal">({{ store.count }})</span></h2>
      <div class="flex gap-2">
        <button
          @click="showDropZone = true"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800"
          title="Drop a PDF order receipt to bulk-add filaments"
        >
          <FileUp :size="16" /> Import order
        </button>
        <button
          @click="startAdd"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500"
        >
          <Plus :size="16" /> Add filament
        </button>
      </div>
    </header>

    <p v-if="message" class="text-sm text-slate-400 mb-3">{{ message }}</p>
    <p v-if="saving" class="text-xs text-slate-500 mb-3">Saving…</p>

    <div v-if="showForm" class="mb-6">
      <FilamentForm
        :initial="editing"
        @submit="onSubmit"
        @cancel="showForm = false"
      />
    </div>

    <div v-if="filaments.length === 0" class="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-800 rounded-lg">
      No filaments yet. Click <em>Add filament</em> to add one manually, or <em>Import order</em> to drop a PDF receipt.
    </div>
    <ul v-else class="grid gap-2">
      <li v-for="f in filaments" :key="f.id">
        <FilamentCard :filament="f" @edit="startEdit" @remove="onRemove" />
      </li>
    </ul>

    <OrderDropZone
      v-if="showDropZone"
      @result="onImportResult"
      @close="showDropZone = false"
    />
    <OrderImportReview
      v-if="importResult"
      :result="importResult"
      @done="onImportDone"
      @cancel="importResult = null"
    />
  </section>
</template>
