<script setup lang="ts">
import { ref } from 'vue'
import { useFilamentHistoryStore } from '../stores/filamentHistory'
import type { ArchivedFilament } from '../types'
import SwatchPreview from './SwatchPreview.vue'
import { X, RotateCcw, Trash2 } from 'lucide-vue-next'

const history = useFilamentHistoryStore()
const emit = defineEmits<{ close: []; restore: [ArchivedFilament] }>()

// Inline two-step confirm so a hard delete is never one accidental click.
const confirming = ref<ArchivedFilament | null>(null)
const confirmingClear = ref(false)
const busy = ref(false)

function total(f: ArchivedFilament): number {
  const i = f.inventory
  return (i?.sealed || 0) + (i?.open || 0) + (i?.in_use || 0)
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

async function forget(entry: ArchivedFilament) {
  busy.value = true
  history.forget(entry)
  await history.save()
  confirming.value = null
  busy.value = false
}

async function clearAll() {
  busy.value = true
  history.clear()
  await history.save()
  confirmingClear.value = false
  busy.value = false
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-12 px-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[85vh]">
      <header class="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h3 class="font-semibold">Filament history</h3>
          <p class="text-xs text-slate-400 mt-0.5">
            Removed filaments are kept here — restore one to bring it back to inventory, or delete it permanently.
          </p>
        </div>
        <button @click="emit('close')" class="p-1 text-slate-400 hover:text-slate-100" aria-label="Close">
          <X :size="18" />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto">
        <div v-if="history.items.length === 0" class="text-slate-500 text-sm py-10 text-center">
          No removed filaments yet.
        </div>
        <ul v-else class="divide-y divide-slate-800">
          <li
            v-for="entry in history.items"
            :key="entry.id + entry.removed_at"
            class="flex items-start gap-3 px-4 py-3"
          >
            <SwatchPreview :swatch="entry.swatch" :size="40" />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium truncate">{{ entry.brand }} &middot; {{ entry.name }}</span>
                <span v-if="entry.variant" class="text-xs text-slate-400 truncate">{{ entry.variant }}</span>
              </div>
              <div class="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span v-if="entry.ai?.type" class="uppercase tracking-wide">{{ entry.ai.type }}</span>
                <span>{{ total(entry) }} spool<template v-if="total(entry) !== 1">s</template> when removed</span>
                <span>removed {{ fmtDate(entry.removed_at) }}</span>
              </div>
            </div>
            <div class="flex items-center gap-1 flex-none">
              <button
                @click="emit('restore', entry)"
                :disabled="busy"
                class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-sky-600/60 bg-sky-700/30 text-sky-100 hover:bg-sky-700/50 disabled:opacity-50"
                title="Restore to inventory"
              ><RotateCcw :size="14" /> Restore</button>

              <template v-if="confirming === entry">
                <button
                  @click="forget(entry)"
                  :disabled="busy"
                  class="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                  title="Confirm permanent delete"
                >Delete?</button>
                <button
                  @click="confirming = null"
                  class="px-2 py-1 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                >Cancel</button>
              </template>
              <button
                v-else
                @click="confirming = entry"
                :disabled="busy"
                class="p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-50"
                title="Delete permanently"
              ><Trash2 :size="15" /></button>
            </div>
          </li>
        </ul>
      </div>

      <footer class="px-4 py-3 border-t border-slate-800 flex items-center justify-between">
        <div>
          <template v-if="history.items.length > 0">
            <button
              v-if="!confirmingClear"
              @click="confirmingClear = true"
              class="text-xs text-slate-400 hover:text-red-400"
            >Clear all history</button>
            <span v-else class="flex items-center gap-2 text-xs">
              <span class="text-slate-400">Delete all {{ history.items.length }} permanently?</span>
              <button @click="clearAll" :disabled="busy" class="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50">Yes, delete all</button>
              <button @click="confirmingClear = false" class="px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            </span>
          </template>
        </div>
        <button
          @click="emit('close')"
          class="px-3 py-1.5 text-sm border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
        >Close</button>
      </footer>
    </div>
  </div>
</template>
