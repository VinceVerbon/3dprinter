<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useFilamentsStore } from '../stores/filaments'
import { useFilamentLookup } from '../composables/useFilamentLookup'
import { useSwatchLookup } from '../composables/useSwatchLookup'
import FilamentCard from '../components/FilamentCard.vue'
import FilamentForm from '../components/FilamentForm.vue'
import FilamentDetail from '../components/FilamentDetail.vue'
import OrderDropZone, { type ImportResult } from '../components/OrderDropZone.vue'
import OrderImportReview from '../components/OrderImportReview.vue'
import type { Filament, Effect, FilamentType } from '../types'
import { Plus, FileUp, X, Sparkles, Palette } from 'lucide-vue-next'

const store = useFilamentsStore()
const { lookup } = useFilamentLookup()
const { lookup: swatchLookup } = useSwatchLookup()
const showForm = ref(false)
const editing = ref<Filament | undefined>(undefined)
const detailing = ref<Filament | undefined>(undefined)
const saving = ref(false)
const message = ref<string | null>(null)
const showDropZone = ref(false)
const importResult = ref<ImportResult | null>(null)

// Batch AI lookup
const batchRunning = ref(false)
const batchProgress = ref<{ done: number; total: number; failed: number } | null>(null)
const missingAi = computed(() => store.items.filter(f => !f.ai))

// Backfill grey swatches — selection criteria from docs/chunk-e-swatch-resolver.md.
const greySwatchTargets = computed(() => store.items.filter(f =>
  f.swatch.hex === '#888888'
  && f.swatch.stops.length === 1
  && f.swatch.stops[0] === '#888888'
  && f.swatch.source === 'manual',
))
const swatchBatchRunning = ref(false)
const swatchBatchProgress = ref<{ done: number; total: number; failed: number } | null>(null)
async function refreshGreySwatches() {
  if (swatchBatchRunning.value) return
  const targets = greySwatchTargets.value.slice()
  if (targets.length === 0) return
  swatchBatchRunning.value = true
  swatchBatchProgress.value = { done: 0, total: targets.length, failed: 0 }
  for (const f of targets) {
    const r = await swatchLookup({
      brand: f.brand,
      name: f.name,
      variant: f.variant,
      sku: f.sku,
      product_url: f.product_url,
    })
    if (r && r.hex) {
      store.update(f.id, {
        swatch: {
          hex: r.hex,
          stops: r.stops.length > 0 ? r.stops : [r.hex],
          effects: r.effects,
          source: 'ai',
        },
      } as Partial<Filament>)
    } else {
      swatchBatchProgress.value.failed += 1
    }
    swatchBatchProgress.value.done += 1
  }
  const res = await store.save()
  swatchBatchRunning.value = false
  const failed = swatchBatchProgress.value.failed
  message.value = res.ok
    ? `Swatches resolved — ${swatchBatchProgress.value.done - failed} filled${failed ? `, ${failed} failed` : ''}.`
    : (res.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
  setTimeout(() => { message.value = null; swatchBatchProgress.value = null }, 5000)
}
async function lookupAllMissing() {
  if (batchRunning.value) return
  const targets = missingAi.value.slice()
  if (targets.length === 0) return
  batchRunning.value = true
  batchProgress.value = { done: 0, total: targets.length, failed: 0 }
  for (const f of targets) {
    const r = await lookup(f.brand, f.name, false)
    if (r) {
      store.update(f.id, { ai: r })
    } else {
      batchProgress.value.failed += 1
    }
    batchProgress.value.done += 1
  }
  const res = await store.save()
  batchRunning.value = false
  const failed = batchProgress.value.failed
  message.value = res.ok
    ? `AI lookup done — ${batchProgress.value.done - failed} filled${failed ? `, ${failed} failed` : ''}.`
    : (res.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
  setTimeout(() => { message.value = null; batchProgress.value = null }, 5000)
}

// Filters
const filterType = ref<FilamentType | ''>('')
const filterEffect = ref<Effect | ''>('')
const filterColor = ref<string>('')   // color family key, see COLOR_FAMILIES below

onMounted(() => store.load())

// --- Color families: map a hex to one of these buckets via HSL ---
type ColorFamily = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink' | 'black' | 'white' | 'gray' | 'brown' | 'multicolor'
const COLOR_FAMILIES: { key: ColorFamily; label: string; sample: string }[] = [
  { key: 'red',    label: 'Red',    sample: '#dc2626' },
  { key: 'orange', label: 'Orange', sample: '#ea580c' },
  { key: 'yellow', label: 'Yellow', sample: '#eab308' },
  { key: 'green',  label: 'Green',  sample: '#16a34a' },
  { key: 'cyan',   label: 'Cyan',   sample: '#0891b2' },
  { key: 'blue',   label: 'Blue',   sample: '#2563eb' },
  { key: 'purple', label: 'Purple', sample: '#7c3aed' },
  { key: 'pink',   label: 'Pink',   sample: '#db2777' },
  { key: 'brown',  label: 'Brown',  sample: '#78350f' },
  { key: 'black',  label: 'Black',  sample: '#0f172a' },
  { key: 'gray',   label: 'Gray',   sample: '#64748b' },
  { key: 'white',  label: 'White',  sample: '#f1f5f9' },
  { key: 'multicolor', label: 'Multicolor', sample: 'conic-gradient(#dc2626,#ea580c,#eab308,#16a34a,#0891b2,#2563eb,#7c3aed,#db2777,#dc2626)' },
]

function isMulticolor(f: Filament): boolean {
  if (f.swatch.effects.includes('multicolor')) return true
  if (f.swatch.stops.length > 1) {
    const distinct = new Set(f.swatch.stops.map(h => h.toLowerCase()))
    return distinct.size > 1
  }
  return false
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const r = parseInt(m[1].slice(0, 2), 16) / 255
  const g = parseInt(m[1].slice(2, 4), 16) / 255
  const b = parseInt(m[1].slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

function colorFamily(hex: string): ColorFamily {
  const hsl = hexToHsl(hex)
  if (!hsl) return 'gray'
  const { h, s, l } = hsl
  if (l < 12) return 'black'
  if (l > 90 && s < 15) return 'white'
  if (s < 12) return 'gray'
  // Brownish: low-medium lightness, hue red/orange/yellow with desaturation
  if (l < 45 && s < 55 && h >= 10 && h <= 50) return 'brown'
  if (h < 15 || h >= 345) return 'red'
  if (h < 40)  return 'orange'
  if (h < 65)  return 'yellow'
  if (h < 165) return 'green'
  if (h < 200) return 'cyan'
  if (h < 250) return 'blue'
  if (h < 290) return 'purple'
  return 'pink'
}

function filamentMatchesColor(f: Filament, family: string): boolean {
  if (!family) return true
  if (family === 'multicolor') return isMulticolor(f)
  return f.swatch.stops.some(h => colorFamily(h) === family) || colorFamily(f.swatch.hex) === family
}

const filtered = computed<Filament[]>(() => {
  return store.items.filter(f => {
    if (filterType.value && f.ai?.type !== filterType.value) return false
    if (filterEffect.value && !f.swatch.effects.includes(filterEffect.value)) return false
    if (!filamentMatchesColor(f, filterColor.value)) return false
    return true
  })
})

// Available facet options derived from current data so we never offer empty filters
const availableTypes = computed<FilamentType[]>(() => {
  const set = new Set<FilamentType>()
  for (const f of store.items) if (f.ai?.type) set.add(f.ai.type)
  return Array.from(set).sort()
})
const availableEffects = computed<Effect[]>(() => {
  const set = new Set<Effect>()
  for (const f of store.items) for (const e of f.swatch.effects) set.add(e)
  return Array.from(set).sort()
})
const availableColors = computed(() => {
  const set = new Set<ColorFamily>()
  let anyMulti = false
  for (const f of store.items) {
    if (isMulticolor(f)) { anyMulti = true; continue }
    set.add(colorFamily(f.swatch.hex))
    for (const h of f.swatch.stops) set.add(colorFamily(h))
  }
  if (anyMulti) set.add('multicolor')
  return COLOR_FAMILIES.filter(c => set.has(c.key))
})

const hasFilters = computed(() => filterType.value || filterEffect.value || filterColor.value)
function clearFilters() {
  filterType.value = ''
  filterEffect.value = ''
  filterColor.value = ''
}

function startAdd() { editing.value = undefined; showForm.value = true; message.value = null }
function startEdit(id: string) {
  const f = store.items.find(x => x.id === id)
  if (f) { editing.value = f; showForm.value = true; message.value = null }
}
function openDetail(id: string) {
  const f = store.items.find(x => x.id === id)
  if (f) detailing.value = f
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
      <h2 class="text-lg font-semibold">
        Filaments
        <span class="text-slate-500 font-normal">
          ({{ filtered.length }}<template v-if="filtered.length !== store.count"> of {{ store.count }}</template>)
        </span>
      </h2>
      <div class="flex gap-2">
        <button
          v-if="missingAi.length > 0 || batchRunning"
          @click="lookupAllMissing"
          :disabled="batchRunning"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-violet-600/60 bg-violet-700/30 text-violet-100 hover:bg-violet-700/50 disabled:opacity-60 disabled:cursor-not-allowed"
          :title="`Run AI lookup for ${missingAi.length} filament${missingAi.length === 1 ? '' : 's'} without P2S info`"
        >
          <Sparkles :size="16" />
          <template v-if="batchRunning && batchProgress">
            Filling AI… {{ batchProgress.done }}/{{ batchProgress.total }}
          </template>
          <template v-else>
            Fill missing AI ({{ missingAi.length }})
          </template>
        </button>
        <button
          v-if="greySwatchTargets.length > 0 || swatchBatchRunning"
          @click="refreshGreySwatches"
          :disabled="swatchBatchRunning"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-fuchsia-600/60 bg-fuchsia-700/30 text-fuchsia-100 hover:bg-fuchsia-700/50 disabled:opacity-60 disabled:cursor-not-allowed"
          :title="`Resolve real hex colours for ${greySwatchTargets.length} filament${greySwatchTargets.length === 1 ? '' : 's'} currently stuck on the grey placeholder`"
        >
          <Palette :size="16" />
          <template v-if="swatchBatchRunning && swatchBatchProgress">
            Resolving swatches… {{ swatchBatchProgress.done }}/{{ swatchBatchProgress.total }}
          </template>
          <template v-else>
            Refresh swatches ({{ greySwatchTargets.length }})
          </template>
        </button>
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

    <!-- Filters -->
    <div
      v-if="store.count > 0"
      class="mb-4 grid gap-2 text-xs"
    >
      <div class="flex items-center gap-2 flex-wrap">
        <label class="flex items-center gap-1.5">
          <span class="text-slate-500">Type</span>
          <select
            v-model="filterType"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            <option value="">all</option>
            <option v-for="t in availableTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1.5">
          <span class="text-slate-500">Effect</span>
          <select
            v-model="filterEffect"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            <option value="">all</option>
            <option v-for="e in availableEffects" :key="e" :value="e">{{ e }}</option>
          </select>
        </label>
        <button
          v-if="hasFilters"
          @click="clearFilters"
          class="flex items-center gap-1 text-slate-400 hover:text-slate-100 px-2 py-1 rounded border border-transparent hover:border-slate-700"
        >
          <X :size="12" /> clear
        </button>
      </div>
      <div v-if="availableColors.length > 0" class="flex items-center gap-2 flex-wrap">
        <span class="text-slate-500">Color</span>
        <button
          @click="filterColor = ''"
          class="text-xs px-2 py-0.5 rounded border"
          :class="filterColor === '' ? 'border-sky-500 text-sky-300' : 'border-slate-700 text-slate-400 hover:text-slate-100'"
        >all</button>
        <button
          v-for="c in availableColors"
          :key="c.key"
          @click="filterColor = filterColor === c.key ? '' : c.key"
          class="flex items-center gap-1.5 px-2 py-0.5 rounded border"
          :class="filterColor === c.key ? 'border-sky-500 text-sky-300' : 'border-slate-700 text-slate-400 hover:text-slate-100'"
          :title="c.label"
        >
          <span
            class="inline-block w-3.5 h-3.5 rounded-full border border-slate-700"
            :style="c.key === 'multicolor' ? { background: c.sample } : { backgroundColor: c.sample }"
          ></span>
          {{ c.label }}
        </button>
      </div>
    </div>

    <p v-if="message" class="text-sm text-slate-400 mb-3">{{ message }}</p>
    <p v-if="saving" class="text-xs text-slate-500 mb-3">Saving…</p>

    <div v-if="showForm" class="mb-6">
      <FilamentForm
        :initial="editing"
        @submit="onSubmit"
        @cancel="showForm = false"
      />
    </div>

    <div v-if="store.items.length === 0" class="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-800 rounded-lg">
      No filaments yet. Click <em>Add filament</em> to add one manually, or <em>Import order</em> to drop a PDF receipt.
    </div>
    <div v-else-if="filtered.length === 0" class="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-800 rounded-lg">
      No filaments match the current filters.
      <button @click="clearFilters" class="text-sky-400 hover:underline ml-1">Clear filters</button>
    </div>
    <ul v-else class="grid gap-2">
      <li v-for="f in filtered" :key="f.id">
        <div
          @click="(e) => { if (!(e.target as HTMLElement).closest('button')) openDetail(f.id) }"
          class="cursor-pointer rounded-lg hover:ring-1 hover:ring-sky-500/40 transition-shadow"
        >
          <FilamentCard :filament="f" @edit="startEdit" @remove="onRemove" />
        </div>
      </li>
    </ul>

    <FilamentDetail
      v-if="detailing"
      :filament="detailing"
      @close="detailing = undefined"
      @edit="startEdit"
    />

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
