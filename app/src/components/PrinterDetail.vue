<script setup lang="ts">
import { computed } from 'vue'
import type { Printer } from '../types'
import { X, Pencil, Trash2, Star, ExternalLink } from 'lucide-vue-next'

const props = defineProps<{ printer: Printer }>()
defineEmits<{ close: []; edit: []; remove: []; setActive: [] }>()

const s = computed(() => props.printer.spec ?? {})
const buildVolume = computed(() => {
  const bv = s.value.build_volume_mm
  return bv ? `${bv.x} × ${bv.y} × ${bv.z} mm` : null
})
const nozzles = computed(() =>
  s.value.nozzle_options_mm?.length ? s.value.nozzle_options_mm.map((n) => `${n} mm`).join(', ') : null,
)
const ams = computed(() => {
  const a = s.value.ams
  if (!a || !a.type || a.type.toLowerCase() === 'none') return 'None'
  return a.slots ? `${a.type} (${a.slots} slots${a.max_units && a.max_units > 1 ? `, up to ${a.max_units} units` : ''})` : a.type
})

// (label, value) rows — only rendered when value is non-empty.
const rows = computed<Array<[string, string | null]>>(() => [
  ['Build volume', buildVolume.value],
  ['Max build height', s.value.max_build_height_mm != null ? `${s.value.max_build_height_mm} mm` : null],
  ['Max hotend temp', s.value.max_hotend_temp_c != null ? `${s.value.max_hotend_temp_c} °C` : null],
  ['Max bed temp', s.value.max_bed_temp_c != null ? `${s.value.max_bed_temp_c} °C` : null],
  ['Enclosure', s.value.enclosed == null ? null : s.value.enclosed ? 'Enclosed' : 'Open frame'],
  ['Chamber heater', s.value.chamber_heated == null ? null : s.value.chamber_heated ? 'Yes' : 'No'],
  ['Filament', s.value.filament_diameter_mm != null ? `${s.value.filament_diameter_mm} mm` : null],
  ['Default nozzle', s.value.default_nozzle_mm != null ? `${s.value.default_nozzle_mm} mm` : null],
  ['Nozzle options', nozzles.value],
  ['AMS / multi-material', ams.value],
])
const shownRows = computed(() => rows.value.filter(([, v]) => v != null && v !== ''))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print-hide" @click.self="$emit('close')">
    <div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      <div class="flex items-start justify-between border-b border-slate-800 p-5">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-semibold">{{ printer.brand }} {{ printer.model }}</h2>
            <span v-if="printer.is_active" class="rounded-full bg-emerald-600/20 px-2 py-0.5 text-xs font-medium text-emerald-300">active</span>
          </div>
          <p v-if="printer.nickname" class="text-sm text-slate-400">“{{ printer.nickname }}”</p>
        </div>
        <button class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100" @click="$emit('close')"><X :size="20" /></button>
      </div>

      <div class="space-y-5 p-5">
        <!-- Spec sheet -->
        <div>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Specifications</h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <template v-for="[label, value] in shownRows" :key="label">
              <dt class="text-slate-400">{{ label }}</dt>
              <dd class="text-slate-100">{{ value }}</dd>
            </template>
          </dl>
        </div>

        <!-- Common accessories -->
        <div v-if="s.common_accessories?.length">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Common accessories</h3>
          <ul class="flex flex-wrap gap-2">
            <li v-for="a in s.common_accessories" :key="a" class="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">{{ a }}</li>
          </ul>
        </div>

        <!-- Links -->
        <div v-if="printer.detail_url || printer.store_url" class="flex flex-wrap gap-3 text-sm">
          <a v-if="printer.detail_url" :href="printer.detail_url" target="_blank" rel="noopener"
             class="inline-flex items-center gap-1 text-sky-400 hover:underline">
            <ExternalLink :size="14" /> Model page
          </a>
          <a v-if="printer.store_url" :href="printer.store_url" target="_blank" rel="noopener"
             class="inline-flex items-center gap-1 text-sky-400 hover:underline">
            <ExternalLink :size="14" /> Brand store
          </a>
        </div>

        <!-- Notes -->
        <div v-if="printer.notes">
          <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</h3>
          <p class="whitespace-pre-wrap text-sm text-slate-300">{{ printer.notes }}</p>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 border-t border-slate-800 p-4">
        <button
          v-if="!printer.is_active"
          class="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          @click="$emit('setActive')"
        >
          <Star :size="14" /> Set active
        </button>
        <span v-else class="text-xs text-emerald-400">This is your active printer</span>
        <div class="flex gap-2">
          <button class="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800" @click="$emit('edit')">
            <Pencil :size="14" /> Edit
          </button>
          <button class="inline-flex items-center gap-1 rounded-lg border border-rose-900 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-950" @click="$emit('remove')">
            <Trash2 :size="14" /> Remove
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
