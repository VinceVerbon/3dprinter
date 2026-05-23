<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Filament } from '../../types'
import { amsCompat } from '../../lib/labels/amsCompat'
import { useBrandLogosStore, brandSlug } from '../../stores/brandLogos'
import { cleanFilamentName } from '../../lib/filamentName'
import { Check, X } from 'lucide-vue-next'

const props = defineProps<{ filament: Filament }>()

const logos = useBrandLogosStore()
const ams = computed(() => amsCompat(props.filament))

const swatchBg = computed(() => {
  const stops = props.filament.swatch.stops
  if (!stops || stops.length === 0) return '#888'
  if (stops.length === 1) return stops[0]
  if (stops.length === 2) return `linear-gradient(135deg, ${stops.join(', ')})`
  return `conic-gradient(${stops.join(', ')}, ${stops[0]})`
})

function fmtRange(r: [number, number] | null | undefined): string {
  if (!r) return '—'
  return r[0] === r[1] ? `${r[0]}°C` : `${r[0]}–${r[1]}°C`
}

const articleNumber = computed(() => {
  return props.filament.sku || props.filament.color_code || ''
})

const variantLabel = computed(() => props.filament.variant || '')

/** Title is just the clean product name. Stored names are normalised at import
 *  time and by the data migration, so this is normally a pass-through; we still
 *  run the cleaner defensively in case an un-migrated record slips through.
 *  Packaging (refill vs on-spool) is tracked in inventory, NOT in the title. */
const displayTitle = computed(() => cleanFilamentName(props.filament.name))

/** Pick a font-size tier based on title length so very long titles still fit. */
const titleSizePt = computed(() => {
  const t = displayTitle.value
  if (t.length <= 14) return 22
  if (t.length <= 20) return 19
  if (t.length <= 28) return 16
  return 13
})

const logoEntry = computed(() => logos.get(props.filament.brand))
const logoFailed = ref(false)
const showLogoImage = computed(() => {
  const e = logoEntry.value
  return !!e && (e.kind === 'data-uri' || e.kind === 'url') && !!e.value && !logoFailed.value
})
const wordmarkText = computed(() => props.filament.brand)
function onLogoError() { logoFailed.value = true }

// Used in print to ensure a stable id for css targeting / debugging.
const labelId = computed(() => `lbl-${brandSlug(props.filament.brand)}-${props.filament.id.slice(0, 8)}`)
</script>

<template>
  <div
    :id="labelId"
    class="filament-label"
  >
    <!-- Header band: brand + title + AMS (left) | swatch + variant (right) -->
    <div class="label-header">
      <div class="label-title-block">
        <div class="label-brand">{{ filament.brand }}</div>
        <div
          class="label-title"
          :style="{ fontSize: `${titleSizePt}pt` }"
        >{{ displayTitle }}</div>
        <div class="label-variant" v-if="variantLabel">{{ variantLabel }}</div>
      </div>
      <div class="label-swatch-block">
        <div class="label-swatch" :style="{ background: swatchBg }" />
        <div
          class="ams-chip"
          :class="ams.compatible ? 'ams-yes' : 'ams-no'"
          :title="ams.reason"
        >
          <span class="ams-label">AMS</span>
          <Check v-if="ams.compatible" :size="10" class="ams-icon" />
          <X v-else :size="10" class="ams-icon" />
        </div>
      </div>
    </div>

    <!-- Spec table -->
    <div class="label-specs">
      <div class="spec-col">
        <div class="spec-row">
          <span class="spec-key">Material</span>
          <span class="spec-val">{{ filament.ai?.type ?? '—' }}</span>
        </div>
        <div class="spec-row">
          <span class="spec-key">Print</span>
          <span class="spec-val">{{ fmtRange(filament.ai?.print_temp_c) }}</span>
        </div>
        <div class="spec-row">
          <span class="spec-key">Bed</span>
          <span class="spec-val">{{ fmtRange(filament.ai?.bed_temp_c) }}</span>
        </div>
      </div>
      <div class="spec-col">
        <div class="spec-row">
          <span class="spec-key">Diameter</span>
          <span class="spec-val">1.75 mm</span>
        </div>
        <div class="spec-row" v-if="filament.spool_grams_total">
          <span class="spec-key">Net weight</span>
          <span class="spec-val">{{ filament.spool_grams_total }} g</span>
        </div>
        <div class="spec-row" v-if="filament.ai?.drying?.temp_c">
          <span class="spec-key">Dry</span>
          <span class="spec-val">
            {{ filament.ai.drying.temp_c }}°C<template v-if="filament.ai.drying.hours"> / {{ filament.ai.drying.hours }}h</template>
          </span>
        </div>
      </div>
    </div>

    <!-- Footer band: producer logo (left) | article number (right) -->
    <div class="label-footer">
      <div class="label-logo-block">
        <img
          v-if="showLogoImage"
          :src="logoEntry!.value"
          :alt="filament.brand"
          class="label-logo-img"
          @error="onLogoError"
        />
        <div v-else class="label-logo-wordmark">{{ wordmarkText }}</div>
      </div>
      <div class="label-sku-block" v-if="articleNumber">
        <span class="label-sku-key">Art.</span>
        <span class="label-sku-val">{{ articleNumber }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* All measurements in mm. The label is exactly 105×70mm so it lines up with
   the Decadry sheet cells. Layout is three vertical bands using
   `justify-content: space-between` to consume the full 70mm cleanly. */
.filament-label {
  width: 105mm;
  height: 70mm;
  padding: 3mm 4mm;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-family: 'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif;
  color: #111;
  background: #fff;
  position: relative;
  overflow: hidden;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ---------- Header band: title block + swatch + AMS chip ---------- */
.label-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 3mm;
  flex: 0 0 auto;
}
.label-title-block {
  flex: 1 1 auto;
  min-width: 0;
  padding-top: 0.5mm;
}
.label-brand {
  font-size: 7.5pt;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
  line-height: 1.1;
}
.label-title {
  font-weight: 800;
  line-height: 1.02;
  letter-spacing: -0.015em;
  margin-top: 0.8mm;
  word-break: break-word;
  /* Hard cap at 2 lines so a runaway title can't push the spec table down. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.label-variant {
  font-size: 9pt;
  font-weight: 600;
  color: #334155;
  margin-top: 1mm;
}

.label-swatch-block {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5mm;
}
.label-swatch {
  width: 22mm;
  height: 22mm;
  border-radius: 50%;
  box-shadow: inset 0 0 0 0.3mm rgba(0,0,0,0.15);
}

.ams-chip {
  display: inline-flex;
  align-items: center;
  gap: 1mm;
  padding: 0.5mm 2mm;
  border-radius: 999px;
  border: 0.3mm solid;
  font-size: 7.5pt;
  font-weight: 800;
  letter-spacing: 0.05em;
  line-height: 1;
}
.ams-yes {
  background: #ecfdf5;
  border-color: #059669;
  color: #047857;
}
.ams-no {
  background: #fef2f2;
  border-color: #dc2626;
  color: #b91c1c;
}
.ams-no .ams-label {
  text-decoration: line-through;
  text-decoration-thickness: 0.4mm;
}
.ams-icon { flex: none; }

/* ---------- Spec band: two columns side-by-side ---------- */
.label-specs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 6mm;
  font-size: 8.5pt;
  flex: 0 0 auto;
  margin: 1mm 0;
}
.spec-col {
  display: flex;
  flex-direction: column;
  gap: 0.6mm;
}
.spec-row {
  display: flex;
  justify-content: space-between;
  gap: 2mm;
  border-bottom: 0.15mm dotted #cbd5e1;
  padding-bottom: 0.4mm;
  line-height: 1.15;
}
.spec-key { color: #64748b; font-weight: 600; font-size: 7.5pt; }
.spec-val { font-weight: 700; color: #111; }

/* ---------- Footer band: producer logo + article number ---------- */
.label-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 3mm;
  flex: 0 0 auto;
}
/* When no article number is rendered, center the logo so the footer band
   doesn't look lopsided. The :has() selector pinch-hits this without an
   extra wrapper class. */
.label-footer:not(:has(.label-sku-block)) {
  justify-content: center;
}
.label-footer:not(:has(.label-sku-block)) .label-logo-block {
  max-width: 90mm;
  align-items: flex-end;
}
.label-footer:not(:has(.label-sku-block)) .label-logo-img {
  max-width: 80mm;
  max-height: 13mm;
  object-position: center bottom;
}
.label-logo-block {
  display: flex;
  align-items: flex-end;
  min-width: 0;
  max-width: 55mm;
  height: 11mm;
}
.label-logo-img {
  max-height: 11mm;
  max-width: 55mm;
  object-fit: contain;
  object-position: left bottom;
}
.label-logo-wordmark {
  font-size: 12pt;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #111;
  line-height: 1;
}

.label-sku-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
  line-height: 1.1;
  max-width: 45mm;
}
.label-sku-key {
  color: #64748b;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 6pt;
  margin-bottom: 0.3mm;
}
.label-sku-val {
  font-weight: 700;
  color: #111;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 7.5pt;
  word-break: break-all;
}
</style>
