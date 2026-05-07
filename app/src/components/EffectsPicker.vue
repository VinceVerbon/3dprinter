<script setup lang="ts">
import type { Effect } from '../types'

const ALL: Effect[] = ['matte', 'silk', 'sparkle', 'marble', 'metallic', 'glow', 'multicolor', 'translucent']

const model = defineModel<Effect[]>({ default: () => [] })

function toggle(e: Effect) {
  if (model.value.includes(e)) model.value = model.value.filter(x => x !== e)
  else model.value = [...model.value, e]
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="e in ALL"
      :key="e"
      type="button"
      @click="toggle(e)"
      :class="[
        'px-2 py-1 text-xs rounded border transition',
        model.includes(e)
          ? 'bg-sky-500/20 border-sky-500 text-sky-200'
          : 'border-slate-700 text-slate-400 hover:border-slate-500'
      ]"
    >{{ e }}</button>
  </div>
</template>
