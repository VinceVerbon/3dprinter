<script setup lang="ts">
import { ref } from 'vue'
import { Star } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ readonly?: boolean; size?: number }>(), {
  readonly: false,
  size: 18,
})
const model = defineModel<number | undefined>()
const hover = ref<number | null>(null)

function set(n: number) {
  if (props.readonly) return
  model.value = model.value === n ? undefined : (n as 1 | 2 | 3 | 4 | 5)
}
function enter(n: number) { if (!props.readonly) hover.value = n }
function leave() { hover.value = null }

function active(n: number): boolean {
  const ref = hover.value ?? model.value ?? 0
  return n <= ref
}
</script>

<template>
  <div class="flex items-center gap-1" role="radiogroup" aria-label="rating" @mouseleave="leave">
    <button
      v-for="n in 5"
      :key="n"
      type="button"
      @click="set(n)"
      @mouseenter="enter(n)"
      :disabled="readonly"
      class="p-0.5 disabled:cursor-default"
      :class="readonly ? '' : 'cursor-pointer hover:scale-110 transition-transform'"
      :aria-label="`${n} star${n > 1 ? 's' : ''}`"
    >
      <Star
        :size="size"
        :class="active(n)
          ? 'fill-amber-400 stroke-amber-400'
          : (readonly ? 'stroke-slate-600' : 'stroke-slate-400')"
      />
    </button>
    <button
      v-if="!readonly && model"
      type="button"
      @click="model = undefined"
      class="ml-2 text-xs text-slate-500 hover:text-slate-300 underline"
    >clear</button>
  </div>
</template>
