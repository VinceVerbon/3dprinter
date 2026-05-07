<script setup lang="ts">
import { Star } from 'lucide-vue-next'

const model = defineModel<number | undefined>()

function set(n: number) {
  model.value = model.value === n ? undefined : (n as 1 | 2 | 3 | 4 | 5)
}
</script>

<template>
  <div class="flex gap-1" role="radiogroup" aria-label="rating">
    <button
      v-for="n in 5"
      :key="n"
      type="button"
      @click="set(n)"
      class="p-0.5"
      :aria-label="`${n} stars`"
    >
      <Star
        :size="18"
        :class="model && n <= model ? 'fill-amber-400 stroke-amber-400' : 'stroke-slate-500'"
      />
    </button>
  </div>
</template>
