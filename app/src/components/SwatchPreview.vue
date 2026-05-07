<script setup lang="ts">
import type { Swatch } from '../types'

const props = defineProps<{ swatch: Swatch; size?: number }>()
const size = props.size ?? 32

function gradient(stops: string[]) {
  if (stops.length === 0) return '#888'
  if (stops.length === 1) return stops[0]
  return `linear-gradient(135deg, ${stops.join(', ')})`
}
</script>

<template>
  <div
    class="rounded-md ring-1 ring-slate-700"
    :style="{ width: `${size}px`, height: `${size}px`, background: gradient(swatch.stops) }"
    :title="swatch.effects.length ? swatch.effects.join(', ') : ''"
  />
</template>
