<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: number
  cols: number
  rows: number
}>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()

const slots = computed(() => props.cols * props.rows)
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.cols}, 56px)`,
  gridTemplateRows: `repeat(${props.rows}, 38px)`,
}))

function pick(n: number) {
  emit('update:modelValue', n)
}
</script>

<template>
  <div class="flex flex-col items-start gap-2">
    <p class="text-xs text-slate-400">
      Pick the first unused label position on your partially-used sheet.
      The first selected filament will print there; subsequent ones fill left-to-right, top-to-bottom.
    </p>
    <div class="sheet-grid" :style="gridStyle">
      <button
        v-for="n in slots"
        :key="n"
        type="button"
        @click="pick(n)"
        :class="[
          'slot-btn',
          n === props.modelValue ? 'slot-btn-active' : 'slot-btn-idle',
          n < props.modelValue ? 'slot-btn-skipped' : '',
        ]"
        :title="n < props.modelValue ? `Skipped (already used)` : `Start at position ${n}`"
      >
        {{ n }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sheet-grid {
  display: grid;
  gap: 4px;
  padding: 6px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 8px;
}
.slot-btn {
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid;
  transition: background 120ms ease;
}
.slot-btn-idle {
  background: #1e293b;
  border-color: #334155;
  color: #cbd5e1;
}
.slot-btn-idle:hover {
  background: #334155;
}
.slot-btn-active {
  background: #0284c7;
  border-color: #0ea5e9;
  color: #fff;
}
.slot-btn-skipped {
  background: transparent;
  border-style: dashed;
  color: #64748b;
}
.slot-btn-skipped:hover {
  background: #0f172a;
}
</style>
