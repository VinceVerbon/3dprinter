<script setup lang="ts">
import { onMounted } from 'vue'
import { useEmptySpoolsStore } from '../stores/emptySpools'
import { Minus, Plus } from 'lucide-vue-next'

const store = useEmptySpoolsStore()
onMounted(() => store.load())

async function inc() { store.increment(); await store.save() }
async function dec() { store.decrement(); await store.save() }
</script>

<template>
  <section class="max-w-md">
    <h2 class="text-lg font-semibold mb-2">Empty spools</h2>
    <p class="text-sm text-slate-400 mb-4">How many empty spools are sitting on the shelf, ready for re-use.</p>

    <div class="flex items-center gap-4 border border-slate-800 rounded-lg p-4 bg-slate-900/40">
      <button
        @click="dec"
        :disabled="store.state.count === 0"
        class="p-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40"
        aria-label="decrement"
      ><Minus :size="18" /></button>
      <div class="text-4xl font-semibold tabular-nums w-16 text-center">{{ store.state.count }}</div>
      <button
        @click="inc"
        class="p-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
        aria-label="increment"
      ><Plus :size="18" /></button>
      <span class="text-sm text-slate-400">free</span>
    </div>
  </section>
</template>
