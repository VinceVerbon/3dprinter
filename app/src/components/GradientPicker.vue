<script setup lang="ts">
import { computed } from 'vue'

const stops = defineModel<string[]>({ default: () => ['#888888'] })

function setStop(i: number, value: string) {
  const s = [...stops.value]
  s[i] = value
  stops.value = s
}
function addStop() {
  if (stops.value.length >= 5) return
  stops.value = [...stops.value, stops.value[stops.value.length - 1] || '#888888']
}
function removeStop(i: number) {
  if (stops.value.length <= 1) return
  stops.value = stops.value.filter((_, idx) => idx !== i)
}

const preview = computed(() =>
  stops.value.length === 1 ? stops.value[0] : `linear-gradient(135deg, ${stops.value.join(', ')})`
)
</script>

<template>
  <div class="space-y-2">
    <div
      class="h-12 w-full rounded-md ring-1 ring-slate-700"
      :style="{ background: preview }"
    />
    <div class="flex flex-wrap gap-2 items-center">
      <div v-for="(stop, i) in stops" :key="i" class="flex items-center gap-1">
        <input
          type="color"
          :value="stop"
          @input="(e) => setStop(i, (e.target as HTMLInputElement).value)"
          class="h-8 w-8 rounded cursor-pointer bg-transparent border border-slate-700"
        />
        <button
          v-if="stops.length > 1"
          type="button"
          @click="removeStop(i)"
          class="text-xs text-slate-500 hover:text-red-400"
          title="Remove stop"
        >×</button>
      </div>
      <button
        v-if="stops.length < 5"
        type="button"
        @click="addStop"
        class="text-xs px-2 py-1 border border-slate-700 rounded text-slate-400 hover:text-slate-200"
      >+ stop</button>
    </div>
    <p class="text-xs text-slate-500">{{ stops.length }}/5 stops &middot; for multicolor filaments, add up to 5 colors</p>
  </div>
</template>
