<script setup lang="ts">
import { reactive, onMounted, ref } from 'vue'
import type { Printer, PrinterTechnology, CatalogPrinter } from '../types'
import { useCatalogStore } from '../stores/catalog'

const props = defineProps<{ initial?: Printer }>()
const emit = defineEmits<{ submit: [printer: Omit<Printer, 'id' | 'added_at'>]; cancel: [] }>()

const catalog = useCatalogStore()
const prefillKey = ref('')

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
function joinList(a?: string[] | null) { return (a ?? []).join('\n') }
function joinNums(a?: number[] | null) { return (a ?? []).join(', ') }

const i = props.initial
const sp = i?.spec ?? {}
const form = reactive({
  brand: i?.brand ?? '',
  model: i?.model ?? '',
  nickname: i?.nickname ?? '',
  technology: (i?.technology ?? 'FDM') as PrinterTechnology,
  detail_url: i?.detail_url ?? '',
  store_url: i?.store_url ?? '',
  notes: i?.notes ?? '',
  bvx: sp.build_volume_mm?.x ?? null as number | null,
  bvy: sp.build_volume_mm?.y ?? null as number | null,
  bvz: sp.build_volume_mm?.z ?? null as number | null,
  max_hotend_temp_c: sp.max_hotend_temp_c ?? null as number | null,
  max_bed_temp_c: sp.max_bed_temp_c ?? null as number | null,
  enclosed: sp.enclosed ?? false,
  chamber_heated: sp.chamber_heated ?? false,
  filament_diameter_mm: sp.filament_diameter_mm ?? 1.75 as number | null,
  default_nozzle_mm: sp.default_nozzle_mm ?? null as number | null,
  nozzle_options: joinNums(sp.nozzle_options_mm),
  ams_type: sp.ams?.type ?? '',
  ams_slots: sp.ams?.slots ?? null as number | null,
  common_accessories: joinList(sp.common_accessories),
})

onMounted(() => { catalog.load() })

function applyPrefill() {
  const cp = catalog.printers.find((p: CatalogPrinter) => `${p.brand} ${p.model}` === prefillKey.value)
  if (!cp) return
  form.brand = cp.brand
  form.model = cp.model
  form.technology = cp.technology ?? 'FDM'
  form.detail_url = cp.detail_url ?? ''
  form.store_url = cp.store_url ?? ''
  const s = cp.spec ?? {}
  form.bvx = s.build_volume_mm?.x ?? null
  form.bvy = s.build_volume_mm?.y ?? null
  form.bvz = s.build_volume_mm?.z ?? null
  form.max_hotend_temp_c = s.max_hotend_temp_c ?? null
  form.max_bed_temp_c = s.max_bed_temp_c ?? null
  form.enclosed = s.enclosed ?? false
  form.chamber_heated = s.chamber_heated ?? false
  form.filament_diameter_mm = s.filament_diameter_mm ?? 1.75
  form.default_nozzle_mm = s.default_nozzle_mm ?? null
  form.nozzle_options = joinNums(s.nozzle_options_mm)
  form.ams_type = s.ams?.type ?? ''
  form.ams_slots = s.ams?.slots ?? null
  form.common_accessories = joinList(s.common_accessories)
}

function onSubmit() {
  if (!form.brand.trim() || !form.model.trim()) return
  const x = num(form.bvx), y = num(form.bvy), z = num(form.bvz)
  const nozzles = form.nozzle_options.split(/[,\s]+/).map(num).filter((n): n is number => n != null)
  const accessories = form.common_accessories.split(/\r?\n|,/).map((a) => a.trim()).filter(Boolean)
  const amsType = form.ams_type.trim()
  const payload: Omit<Printer, 'id' | 'added_at'> = {
    brand: form.brand.trim(),
    model: form.model.trim(),
    nickname: form.nickname.trim() || undefined,
    technology: form.technology,
    detail_url: form.detail_url.trim() || undefined,
    store_url: form.store_url.trim() || undefined,
    notes: form.notes.trim() || undefined,
    is_active: props.initial?.is_active,
    spec: {
      build_volume_mm: x != null && y != null && z != null ? { x, y, z } : null,
      max_build_height_mm: z ?? null,
      max_hotend_temp_c: num(form.max_hotend_temp_c),
      max_bed_temp_c: num(form.max_bed_temp_c),
      enclosed: form.enclosed,
      chamber_heated: form.chamber_heated,
      filament_diameter_mm: num(form.filament_diameter_mm),
      default_nozzle_mm: num(form.default_nozzle_mm),
      nozzle_options_mm: nozzles,
      ams: amsType ? { type: amsType, slots: num(form.ams_slots) } : null,
      common_accessories: accessories,
    },
  }
  emit('submit', payload)
}

const label = 'block text-xs font-medium text-slate-400 mb-1'
const input = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print-hide" @click.self="emit('cancel')">
    <form class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl" @submit.prevent="onSubmit">
      <div class="border-b border-slate-800 p-5">
        <h2 class="text-lg font-semibold">{{ props.initial ? 'Edit printer' : 'Add printer' }}</h2>
      </div>

      <div class="space-y-4 p-5">
        <!-- Prefill from known model -->
        <div v-if="!props.initial && catalog.printers.length">
          <label :class="label">Prefill from a known model</label>
          <div class="flex gap-2">
            <select v-model="prefillKey" :class="input">
              <option value="">— pick a model —</option>
              <option v-for="p in catalog.printers" :key="`${p.brand} ${p.model}`" :value="`${p.brand} ${p.model}`">
                {{ p.brand }} {{ p.model }}
              </option>
            </select>
            <button type="button" class="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800" :disabled="!prefillKey" @click="applyPrefill">
              Prefill
            </button>
          </div>
          <p class="mt-1 text-xs text-slate-500">Fills the fields below with verified specs — edit anything afterwards.</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div><label :class="label">Brand *</label><input v-model="form.brand" :class="input" required /></div>
          <div><label :class="label">Model *</label><input v-model="form.model" :class="input" required /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label :class="label">Nickname</label><input v-model="form.nickname" :class="input" placeholder="e.g. Workshop P2S" /></div>
          <div>
            <label :class="label">Technology</label>
            <select v-model="form.technology" :class="input">
              <option value="FDM">FDM</option><option value="resin">Resin</option><option value="other">Other</option>
            </select>
          </div>
        </div>

        <fieldset class="rounded-lg border border-slate-800 p-3">
          <legend class="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Specifications</legend>
          <div class="mb-3">
            <label :class="label">Build volume (mm) — X × Y × Z</label>
            <div class="flex items-center gap-2">
              <input v-model.number="form.bvx" type="number" min="0" :class="input" placeholder="X" />
              <span class="text-slate-500">×</span>
              <input v-model.number="form.bvy" type="number" min="0" :class="input" placeholder="Y" />
              <span class="text-slate-500">×</span>
              <input v-model.number="form.bvz" type="number" min="0" :class="input" placeholder="Z (height)" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label :class="label">Max hotend temp (°C)</label><input v-model.number="form.max_hotend_temp_c" type="number" :class="input" /></div>
            <div><label :class="label">Max bed temp (°C)</label><input v-model.number="form.max_bed_temp_c" type="number" :class="input" /></div>
            <div><label :class="label">Filament diameter (mm)</label><input v-model.number="form.filament_diameter_mm" type="number" step="0.01" :class="input" /></div>
            <div><label :class="label">Default nozzle (mm)</label><input v-model.number="form.default_nozzle_mm" type="number" step="0.1" :class="input" /></div>
          </div>
          <div class="mt-3">
            <label :class="label">Nozzle options (mm, comma-separated)</label>
            <input v-model="form.nozzle_options" :class="input" placeholder="0.2, 0.4, 0.6, 0.8" />
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div><label :class="label">AMS / multi-material type</label><input v-model="form.ams_type" :class="input" placeholder="AMS 2 Pro (blank = none)" /></div>
            <div><label :class="label">AMS slots</label><input v-model.number="form.ams_slots" type="number" :class="input" /></div>
          </div>
          <div class="mt-3 flex gap-6">
            <label class="flex items-center gap-2 text-sm text-slate-300"><input v-model="form.enclosed" type="checkbox" class="accent-sky-500" /> Enclosed</label>
            <label class="flex items-center gap-2 text-sm text-slate-300"><input v-model="form.chamber_heated" type="checkbox" class="accent-sky-500" /> Heated chamber</label>
          </div>
          <div class="mt-3">
            <label :class="label">Common accessories (one per line)</label>
            <textarea v-model="form.common_accessories" rows="3" :class="input" placeholder="Hardened steel nozzle&#10;Textured PEI plate"></textarea>
          </div>
        </fieldset>

        <div class="grid grid-cols-2 gap-3">
          <div><label :class="label">Model page URL</label><input v-model="form.detail_url" :class="input" placeholder="https://…" /></div>
          <div><label :class="label">Brand store URL</label><input v-model="form.store_url" :class="input" placeholder="https://…" /></div>
        </div>
        <div><label :class="label">Notes</label><textarea v-model="form.notes" rows="2" :class="input"></textarea></div>
      </div>

      <div class="flex justify-end gap-2 border-t border-slate-800 p-4">
        <button type="button" class="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800" @click="emit('cancel')">Cancel</button>
        <button type="submit" class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
          {{ props.initial ? 'Save changes' : 'Add printer' }}
        </button>
      </div>
    </form>
  </div>
</template>
