<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Printer } from '../types'
import { usePrintersStore } from '../stores/printers'
import { useCatalogStore } from '../stores/catalog'
import PrinterForm from '../components/PrinterForm.vue'
import PrinterDetail from '../components/PrinterDetail.vue'
import { Plus, Star, Box, Layers } from 'lucide-vue-next'

const printers = usePrintersStore()
const catalog = useCatalogStore()
const route = useRoute()
const router = useRouter()

const showForm = ref(false)
const editing = ref<Printer | null>(null)
const detail = ref<Printer | null>(null)
const confirmRemoveId = ref<string | null>(null)

onMounted(() => {
  printers.load()
  catalog.load()
})

// Open the add form whenever ?add=1 is present. Uses a watch (not just
// onMounted) so it fires even when we're ALREADY on /printers — the first-run
// prompt's "Add a printer" routes here, and router.push to the same path does
// not remount the page, so an onMounted-only check would silently do nothing.
watch(
  () => route.query.add,
  (v) => {
    if (v != null) {
      openAdd()
      router.replace({ path: '/printers' })
    }
  },
  { immediate: true },
)

function openAdd() { editing.value = null; detail.value = null; showForm.value = true }
function openEdit(p: Printer) { editing.value = p; detail.value = null; showForm.value = true }

async function onSubmit(payload: Omit<Printer, 'id' | 'added_at'>) {
  if (editing.value) await printers.update(editing.value.id, payload)
  else await printers.add(payload)
  showForm.value = false
  editing.value = null
}
async function doRemove(p: Printer) {
  await printers.remove(p.id)
  confirmRemoveId.value = null
  if (detail.value?.id === p.id) detail.value = null
}
async function setActive(p: Printer) {
  await printers.setActive(p.id)
}

function buildVolume(p: Printer) {
  const bv = p.spec?.build_volume_mm
  return bv ? `${bv.x}×${bv.y}×${bv.z}` : null
}
function amsLabel(p: Printer) {
  const a = p.spec?.ams
  return a && a.type && a.type.toLowerCase() !== 'none' ? a.type : null
}
</script>

<template>
  <div>
    <div class="mb-5 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-semibold">Printers</h2>
        <p class="text-sm text-slate-400">{{ printers.printers.length }} configured</p>
      </div>
      <button class="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500" @click="openAdd">
        <Plus :size="16" /> Add printer
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="printers.loaded && printers.hasNone" class="rounded-xl border border-dashed border-slate-700 p-10 text-center">
      <p class="text-slate-300">No printers yet.</p>
      <p class="mx-auto mt-1 max-w-md text-sm text-slate-500">
        Add your printer to get a spec sheet (build volume, temperatures, nozzles, AMS) and let labels &amp;
        compatibility adapt to your machine.
      </p>
      <button class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500" @click="openAdd">
        <Plus :size="16" /> Add your first printer
      </button>
    </div>

    <!-- Printer cards -->
    <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="p in printers.printers"
        :key="p.id"
        class="rounded-xl border border-slate-800 bg-slate-900 p-4 text-left transition hover:border-slate-600"
        @click="detail = p"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="font-semibold leading-tight">{{ p.brand }} {{ p.model }}</h3>
            <p v-if="p.nickname" class="text-xs text-slate-400">“{{ p.nickname }}”</p>
          </div>
          <span v-if="p.is_active" class="inline-flex items-center gap-1 rounded-full bg-emerald-600/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
            <Star :size="11" /> active
          </span>
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5 text-xs">
          <span v-if="buildVolume(p)" class="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-slate-300">
            <Box :size="12" /> {{ buildVolume(p) }} mm
          </span>
          <span v-if="p.spec?.max_hotend_temp_c != null" class="rounded-md bg-slate-800 px-2 py-1 text-slate-300">
            {{ p.spec.max_hotend_temp_c }}°C
          </span>
          <span v-if="amsLabel(p)" class="inline-flex items-center gap-1 rounded-md bg-indigo-600/20 px-2 py-1 text-indigo-300">
            <Layers :size="12" /> {{ amsLabel(p) }}
          </span>
        </div>
      </button>
    </div>

    <!-- Add / edit form -->
    <PrinterForm
      v-if="showForm"
      :initial="editing ?? undefined"
      @submit="onSubmit"
      @cancel="showForm = false; editing = null"
    />

    <!-- Detail / spec view -->
    <PrinterDetail
      v-if="detail"
      :printer="detail"
      @close="detail = null"
      @edit="detail && openEdit(detail)"
      @set-active="detail && setActive(detail)"
      @remove="detail && (confirmRemoveId = detail.id)"
    />

    <!-- Remove confirm -->
    <div v-if="confirmRemoveId" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" @click.self="confirmRemoveId = null">
      <div class="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5">
        <p class="text-sm text-slate-200">Remove this printer? This can't be undone.</p>
        <div class="mt-4 flex justify-end gap-2">
          <button class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800" @click="confirmRemoveId = null">Cancel</button>
          <button
            class="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500"
            @click="doRemove(printers.printers.find((x) => x.id === confirmRemoveId)!)"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
