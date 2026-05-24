<script setup lang="ts">
import { Printer as PrinterIcon } from 'lucide-vue-next'

defineEmits<{ add: []; later: []; never: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print-hide">
    <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-300">
          <PrinterIcon :size="22" />
        </div>
        <h2 class="text-lg font-semibold">Add your 3D printer?</h2>
      </div>
      <p class="mt-3 text-sm text-slate-300">
        Haspel works best when it knows what you print on. Add a printer to get a
        spec sheet (build volume, max temperatures, nozzle options, AMS) and so
        labels and compatibility can adapt to your machine.
      </p>
      <div class="mt-5 flex flex-col gap-2">
        <button
          class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          @click="$emit('add')"
        >
          Add a printer
        </button>
        <div class="flex gap-2">
          <button
            class="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            @click="$emit('later')"
          >
            Not now
          </button>
          <button
            class="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800"
            @click="$emit('never')"
          >
            Don't ask again
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
