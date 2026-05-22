<script setup lang="ts">
import { onMounted, ref, computed, nextTick } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useFilamentsStore } from '../stores/filaments'
import { useBrandLogosStore } from '../stores/brandLogos'
import { useLabelFormatStore } from '../stores/labelFormat'
import { PRESETS, OVERRIDABLE_FIELDS, type OverridableField } from '../lib/labels/presets'
import type { Filament } from '../types'
import FilamentLabel from '../components/labels/FilamentLabel.vue'
import LabelSheet from '../components/labels/LabelSheet.vue'
import SheetPositionPicker from '../components/labels/SheetPositionPicker.vue'
import { amsCompat } from '../lib/labels/amsCompat'
import { Printer, Eye, X, CheckSquare, Square, Image as ImageIcon, FileDown, RotateCcw, Settings2 } from 'lucide-vue-next'

const filaments = useFilamentsStore()
const logos = useBrandLogosStore()
const labelFormat = useLabelFormatStore()
const route = useRoute()

const format = computed(() => labelFormat.format)
const slotsPerSheet = computed(() => format.value.cols * format.value.rows)

onMounted(async () => {
  await Promise.all([filaments.load(), logos.load()])

  // URL params consumed by the headless-PDF rendering pipeline.
  // ?ids=a,b,c        — pre-select exactly these filaments (precedence over autoSelect)
  // ?autoSelect=1     — pre-select all visible filaments
  // ?startPosition=N  — 1..slotsPerSheet, where the first label lands on sheet 1
  // ?formatId=...     — pick a preset by id
  // ?fmt=<base64url>  — JSON-encoded per-field overrides
  // ?topMargin=8.5    — legacy: maps to marginTop override on whatever preset is active
  const q = route.query
  if (typeof q.formatId === 'string') {
    labelFormat.setPreset(q.formatId)
  }
  if (typeof q.fmt === 'string' && q.fmt) {
    try {
      const json = atob(q.fmt.replace(/-/g, '+').replace(/_/g, '/'))
      const parsed = JSON.parse(json) as Partial<Record<OverridableField, number>>
      for (const k of OVERRIDABLE_FIELDS) {
        const v = parsed[k]
        if (typeof v === 'number' && Number.isFinite(v)) labelFormat.setOverride(k, v)
      }
    } catch { /* ignore malformed */ }
  }
  if (typeof q.startPosition === 'string') {
    const n = parseInt(q.startPosition, 10)
    if (Number.isFinite(n) && n >= 1 && n <= slotsPerSheet.value) startPosition.value = n
  }
  if (typeof q.topMargin === 'string') {
    const n = parseFloat(q.topMargin)
    if (Number.isFinite(n) && n >= 0 && n <= 50) labelFormat.setOverride('marginTop', n)
  }
  await nextTick()
  if (typeof q.ids === 'string' && q.ids.length > 0) {
    const idSet = new Set(q.ids.split(',').map(s => s.trim()).filter(Boolean))
    selected.value = new Set(filaments.items.filter(f => idSet.has(f.id)).map(f => f.id))
  } else if (q.autoSelect === '1') {
    selected.value = new Set(visible.value.map(f => f.id))
  }
})

// Selection (uuid set)
const selected = ref<Set<string>>(new Set())
function toggle(id: string) {
  if (selected.value.has(id)) selected.value.delete(id)
  else selected.value.add(id)
  selected.value = new Set(selected.value)
}
function selectAll() {
  selected.value = new Set(visible.value.map(f => f.id))
}
function clearSelection() {
  selected.value = new Set()
}
const allVisibleSelected = computed(() =>
  visible.value.length > 0 && visible.value.every(f => selected.value.has(f.id)),
)

// Lightweight inline filters — just brand + AMS, the heavyweight ones live on /filaments.
const filterBrand = ref('')
const filterAms = ref<'' | 'yes' | 'no'>('')

const brands = computed(() => Array.from(new Set(filaments.items.map(f => f.brand))).sort())
const visible = computed<Filament[]>(() =>
  filaments.items.filter(f => {
    if (filterBrand.value && f.brand !== filterBrand.value) return false
    if (filterAms.value) {
      const ok = amsCompat(f).compatible
      if (filterAms.value === 'yes' && !ok) return false
      if (filterAms.value === 'no' && ok) return false
    }
    return true
  }),
)
const selectedFilaments = computed<Filament[]>(() =>
  // Keep the order stable: follow visible order, then any extras (selections that no longer match filters).
  [
    ...visible.value.filter(f => selected.value.has(f.id)),
    ...filaments.items.filter(
      f => selected.value.has(f.id) && !visible.value.some(v => v.id === f.id),
    ),
  ],
)

// Preview state
const previewing = ref<Filament | null>(null)
function preview(f: Filament) { previewing.value = f }
function closePreview() { previewing.value = null }

// Print state
const startPosition = ref(1)
const showPrintPanel = ref(false)
const showCustomDims = ref(false)
const downloading = ref(false)
const downloadError = ref<string | null>(null)

// Clamp startPosition whenever the slot count changes (preset switch with smaller grid).
const clampedStartPosition = computed({
  get: () => Math.min(startPosition.value, slotsPerSheet.value),
  set: (n: number) => { startPosition.value = Math.min(Math.max(n, 1), slotsPerSheet.value) },
})

const sheetCount = computed(() =>
  Math.ceil((selectedFilaments.value.length + clampedStartPosition.value - 1) / slotsPerSheet.value),
)

const customDimFields: { key: OverridableField; label: string; step: number; max: number }[] = [
  { key: 'labelW', label: 'Label width', step: 0.5, max: 297 },
  { key: 'labelH', label: 'Label height', step: 0.5, max: 297 },
  { key: 'cols', label: 'Columns', step: 1, max: 20 },
  { key: 'rows', label: 'Rows', step: 1, max: 30 },
  { key: 'marginTop', label: 'Top margin', step: 0.5, max: 50 },
  { key: 'marginBottom', label: 'Bottom margin', step: 0.5, max: 50 },
  { key: 'marginLeft', label: 'Left margin', step: 0.5, max: 50 },
  { key: 'marginRight', label: 'Right margin', step: 0.5, max: 50 },
  { key: 'gapH', label: 'Horizontal gap', step: 0.5, max: 50 },
  { key: 'gapV', label: 'Vertical gap', step: 0.5, max: 50 },
]

function fieldValue(key: OverridableField): number {
  return labelFormat.overrides[key] ?? labelFormat.preset[key]
}
function fieldPlaceholder(key: OverridableField): string {
  return String(labelFormat.preset[key])
}
function onFieldInput(key: OverridableField, ev: Event) {
  const target = ev.target as HTMLInputElement
  const raw = target.value.trim()
  if (raw === '') { labelFormat.setOverride(key, null); return }
  const n = Number(raw)
  if (!Number.isFinite(n)) return
  if (n === labelFormat.preset[key]) {
    labelFormat.setOverride(key, null)
  } else {
    labelFormat.setOverride(key, n)
  }
}

function openPrintPanel() {
  if (selectedFilaments.value.length === 0) return
  showPrintPanel.value = true
}
async function doPrint() {
  // Give the DOM a tick to ensure the print-root is fully mounted with the
  // current selection + position offset.
  await nextTick()
  window.print()
}

function encodeOverrides(): string | null {
  const o = labelFormat.overrides
  if (Object.keys(o).length === 0) return null
  const json = JSON.stringify(o)
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function downloadPdf() {
  if (selectedFilaments.value.length === 0 || downloading.value) return
  downloadError.value = null
  downloading.value = true
  try {
    const r = await fetch('/api/render-labels-pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ids: selectedFilaments.value.map(f => f.id),
        startPosition: clampedStartPosition.value,
        formatId: labelFormat.presetId,
        overrides: labelFormat.overrides,
        // Legacy field — kept so an older helper still gets a usable hint.
        topMarginMm: format.value.marginTop,
      }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(body.error || `HTTP ${r.status}`)
    }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `filament-labels-${new Date().toISOString().slice(0, 10)}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    downloadError.value = (e as Error).message
  } finally {
    downloading.value = false
  }
}

// Silence "unused" lint for encodeOverrides — exported for debugging / future
// share-link feature; keep it available without removing.
void encodeOverrides
</script>

<template>
  <section class="max-w-5xl">
    <!-- NORMAL UI (hidden in print) -->
    <div class="print-hide">
      <header class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div class="flex items-baseline gap-3">
          <h2 class="text-lg font-semibold">Labels</h2>
          <span class="text-slate-500 text-sm">
            {{ visible.length }} filament<template v-if="visible.length !== 1">s</template>
            <template v-if="selected.size">· {{ selected.size }} selected</template>
          </span>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <RouterLink
            to="/labels/logos"
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800"
          >
            <ImageIcon :size="16" /> Brand logos
          </RouterLink>
          <button
            @click="openPrintPanel"
            :disabled="selected.size === 0"
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Printer :size="16" /> Print {{ selected.size || '' }}
          </button>
        </div>
      </header>

      <!-- Filters -->
      <div class="mb-4 flex items-center gap-3 text-xs flex-wrap">
        <label class="flex items-center gap-1.5">
          <span class="text-slate-500">Brand</span>
          <select v-model="filterBrand" class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100">
            <option value="">all</option>
            <option v-for="b in brands" :key="b" :value="b">{{ b }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1.5">
          <span class="text-slate-500">AMS</span>
          <select v-model="filterAms" class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100">
            <option value="">all</option>
            <option value="yes">compatible</option>
            <option value="no">not compatible</option>
          </select>
        </label>
        <button
          @click="allVisibleSelected ? clearSelection() : selectAll()"
          class="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-200 hover:bg-slate-800"
        >
          <CheckSquare v-if="allVisibleSelected" :size="14" />
          <Square v-else :size="14" />
          {{ allVisibleSelected ? 'Clear selection' : 'Select all visible' }}
        </button>
      </div>

      <!-- Print panel (preset + position picker + custom dims + print button) -->
      <div
        v-if="showPrintPanel"
        class="mb-4 border border-sky-800/60 bg-sky-900/20 rounded-lg p-4 flex flex-col gap-3"
      >
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-sky-100">Print {{ selectedFilaments.length }} label{{ selectedFilaments.length === 1 ? '' : 's' }}</h3>
          <button @click="showPrintPanel = false" class="text-slate-400 hover:text-slate-100">
            <X :size="16" />
          </button>
        </div>

        <!-- Preset selector -->
        <div class="flex items-center gap-3 text-xs text-slate-300 flex-wrap">
          <label class="flex items-center gap-1.5">
            <span class="text-slate-400">Sheet format</span>
            <select
              :value="labelFormat.presetId"
              @change="labelFormat.setPreset(($event.target as HTMLSelectElement).value)"
              class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
            >
              <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <span v-if="labelFormat.isCustom" class="text-amber-300 italic">customised</span>
          <button
            type="button"
            @click="showCustomDims = !showCustomDims"
            class="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            :title="showCustomDims ? 'Hide custom dimensions' : 'Show custom dimensions'"
          >
            <Settings2 :size="14" />
            {{ showCustomDims ? 'Hide dimensions' : 'Adjust dimensions' }}
          </button>
          <button
            v-if="labelFormat.isCustom"
            type="button"
            @click="labelFormat.resetOverrides()"
            class="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RotateCcw :size="14" /> Reset to preset
          </button>
        </div>

        <!-- Custom dimension grid -->
        <div
          v-if="showCustomDims"
          class="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 text-xs text-slate-300 p-3 border border-slate-700 rounded bg-slate-950/40"
        >
          <label v-for="f in customDimFields" :key="f.key" class="flex flex-col gap-1">
            <span class="text-slate-400">{{ f.label }} <span class="text-slate-600">(mm)</span></span>
            <input
              type="number"
              :step="f.step"
              min="0"
              :max="f.max"
              :value="fieldValue(f.key)"
              :placeholder="fieldPlaceholder(f.key)"
              @input="onFieldInput(f.key, $event)"
              class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
            />
          </label>
        </div>

        <!-- Position picker -->
        <SheetPositionPicker
          v-model="clampedStartPosition"
          :cols="format.cols"
          :rows="format.rows"
        />

        <div class="flex items-center gap-3 text-xs text-slate-300">
          <span>Will use {{ sheetCount }} sheet<template v-if="sheetCount !== 1">s</template> · {{ format.labelW }}×{{ format.labelH }}mm, {{ format.cols }}×{{ format.rows }}.</span>
          <span class="text-slate-500">Download PDF is the reliable path — it bypasses the browser print dialog.</span>
        </div>
        <div v-if="downloadError" class="text-xs text-red-400">{{ downloadError }}</div>
        <div class="flex gap-2">
          <button
            @click="downloadPdf"
            :disabled="downloading"
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
          >
            <FileDown :size="16" />
            {{ downloading ? 'Rendering PDF…' : 'Download PDF' }}
          </button>
          <button
            @click="doPrint"
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800"
            title="Browser print — only works if you set dialog Margins to None"
          >
            <Printer :size="16" /> Browser print
          </button>
        </div>
      </div>

      <!-- Filament list (compact rows with checkboxes) -->
      <ul class="grid gap-1.5">
        <li
          v-for="f in visible"
          :key="f.id"
          class="border border-slate-800 rounded-lg px-3 py-2 bg-slate-900/40 flex items-center gap-3"
        >
          <input
            type="checkbox"
            :checked="selected.has(f.id)"
            @change="toggle(f.id)"
            class="accent-sky-500 w-4 h-4"
          />
          <div
            class="w-9 h-9 rounded-md ring-1 ring-slate-700 flex-none"
            :style="{ background: f.swatch.stops.length > 1 ? `linear-gradient(135deg, ${f.swatch.stops.join(', ')})` : (f.swatch.hex || '#888') }"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 truncate">
              <span class="text-xs text-slate-400">{{ f.brand }}</span>
              <span class="font-medium truncate">{{ f.name }}</span>
              <span v-if="f.variant" class="text-xs text-slate-500 truncate">{{ f.variant }}</span>
            </div>
            <div class="text-xs text-slate-500 flex items-center gap-3">
              <span>{{ f.ai?.type ?? 'unknown' }}</span>
              <span
                :class="amsCompat(f).compatible ? 'text-emerald-400' : 'text-red-400'"
              >AMS {{ amsCompat(f).compatible ? '✓' : '✗' }}</span>
              <span v-if="f.sku" class="font-mono truncate">{{ f.sku }}</span>
            </div>
          </div>
          <button
            @click="preview(f)"
            class="p-1.5 text-slate-400 hover:text-sky-400"
            title="Preview label"
          ><Eye :size="16" /></button>
        </li>
      </ul>

      <div v-if="visible.length === 0" class="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-800 rounded-lg">
        No filaments match the current filters.
      </div>

      <!-- Preview modal -->
      <div
        v-if="previewing"
        class="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-6"
        @click.self="closePreview"
      >
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-[calc(105mm+4rem)]">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-medium text-slate-100">Label preview · actual size</h3>
            <button @click="closePreview" class="text-slate-400 hover:text-slate-100"><X :size="16" /></button>
          </div>
          <div class="bg-white shadow-lg" :style="{ width: `${format.labelW}mm`, height: `${format.labelH}mm` }">
            <FilamentLabel :filament="previewing" />
          </div>
          <p class="text-xs text-slate-500 mt-3">
            {{ labelFormat.preset.name }} · printed at 100%. AMS rule:
            <span class="text-slate-300">{{ amsCompat(previewing).reason }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- PRINTABLE ROOT — hidden on screen via off-screen positioning,
         repositioned to flow at the page origin in @media print. -->
    <div class="print-root">
      <LabelSheet
        :filaments="selectedFilaments"
        :format="format"
        :start-position="clampedStartPosition"
      />
    </div>
  </section>
</template>

<style scoped>
/* On screen, hide the print-root since we render the preview inside the modal.
   In print mode, the global stylesheet flips visibility so only .print-root shows. */
.print-root {
  position: absolute;
  left: -10000px;
  top: 0;
}
@media print {
  .print-root {
    position: static;
    left: auto;
  }
}
</style>
