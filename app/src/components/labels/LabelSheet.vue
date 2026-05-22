<script setup lang="ts">
import { computed } from 'vue'
import type { Filament } from '../../types'
import FilamentLabel from './FilamentLabel.vue'
import type { LabelFormat } from '../../lib/labels/presets'
import { slotsPerSheet } from '../../lib/labels/presets'

const props = defineProps<{
  filaments: Filament[]
  /** Full label-sheet geometry. Drives slot count, slot position, paper size. */
  format: LabelFormat
  /** 1-based position on the first sheet where the first label should land (1..slotsPerSheet). */
  startPosition?: number
}>()

const slots = computed(() => slotsPerSheet(props.format))

/** Build an array per sheet where index 0..slots-1 maps to a sheet slot,
 *  with blanks before startPosition on the first sheet. */
const sheets = computed<(Filament | null)[][]>(() => {
  const total = slots.value
  const start = Math.min(Math.max(props.startPosition ?? 1, 1), total) - 1
  const out: (Filament | null)[][] = []
  let current: (Filament | null)[] = new Array(start).fill(null)
  for (const f of props.filaments) {
    if (current.length >= total) {
      out.push(current)
      current = []
    }
    current.push(f)
  }
  if (current.length > 0) {
    while (current.length < total) current.push(null)
    out.push(current)
  }
  return out
})

function slotStyle(idx: number) {
  const { cols, marginTop, marginLeft, labelW, labelH, gapH, gapV, cornerRadius } = props.format
  const col = idx % cols
  const row = Math.floor(idx / cols)
  return {
    left: `${marginLeft + col * (labelW + gapH)}mm`,
    top: `${marginTop + row * (labelH + gapV)}mm`,
    width: `${labelW}mm`,
    height: `${labelH}mm`,
    borderRadius: cornerRadius > 0 ? `${cornerRadius}mm` : undefined,
  }
}

const sheetStyle = computed(() => ({
  width: `${props.format.paperW}mm`,
  height: `${props.format.paperH}mm`,
}))
</script>

<template>
  <div class="label-sheet-wrap">
    <div
      v-for="(sheet, sIdx) in sheets"
      :key="sIdx"
      class="label-sheet"
      :style="sheetStyle"
    >
      <div
        v-for="(slot, idx) in sheet"
        :key="idx"
        class="label-slot"
        :style="slotStyle(idx)"
      >
        <FilamentLabel v-if="slot" :filament="slot" />
        <div v-else class="label-slot-empty" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Container holds N sheets at the configured paper size. Slots use absolute
   positioning so the print engine cannot compress rows — each slot gets a
   literal {top,left,width,height} in mm. CSS grid with `repeat(N, 70mm)` looks
   correct on screen but Chrome's print engine silently shrinks fixed-mm tracks
   when the printable area is smaller than the @page (e.g. when the user
   forgets to set browser margins to None), collapsing the labels into each
   other. Absolute positioning is immune. */
.label-sheet-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8mm;
}
.label-sheet {
  box-sizing: border-box;
  background: white;
  position: relative;
  /* Subtle border in screen preview only, suppressed in print below. */
  box-shadow: 0 0 0 0.2mm #cbd5e1;
  overflow: hidden;
}
/* Page-break ONLY between sheets — never after the last sheet, which would
   emit a phantom trailing blank page in headless print. */
.label-sheet:not(:last-child) {
  page-break-after: always;
  break-after: page;
}
.label-slot {
  position: absolute;
  overflow: hidden;
  /* Dashed cut guide visible on screen; suppressed in print. */
  outline: 0.15mm dashed #cbd5e1;
  outline-offset: -0.15mm;
}
.label-slot-empty { width: 100%; height: 100%; }

@media print {
  .label-sheet { box-shadow: none; }
  .label-slot { outline: none; }
}
</style>
