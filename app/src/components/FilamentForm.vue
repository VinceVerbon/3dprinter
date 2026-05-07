<script setup lang="ts">
import { reactive } from 'vue'
import type { Filament, Effect } from '../types'
import GradientPicker from './GradientPicker.vue'
import EffectsPicker from './EffectsPicker.vue'
import RatingStars from './RatingStars.vue'

const props = defineProps<{ initial?: Filament }>()
const emit = defineEmits<{ submit: [Filament]; cancel: [] }>()

function uuid(): string {
  // crypto.randomUUID is available in modern browsers; fallback if not.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'f_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const form = reactive<Filament>(
  props.initial
    ? structuredClone(props.initial)
    : {
        id: uuid(),
        brand: 'Bambu Lab',
        name: '',
        variant: '',
        swatch: { hex: '#888888', stops: ['#888888'], effects: [], source: 'manual' },
        rating: undefined,
        notes: '',
        spool_state: 'sealed',
        added_at: new Date().toISOString(),
      },
)

function syncStops() {
  form.swatch.hex = form.swatch.stops[0] ?? '#888888'
  if (form.swatch.stops.length > 1 && !form.swatch.effects.includes('multicolor')) {
    form.swatch.effects = [...form.swatch.effects, 'multicolor' as Effect]
  }
}

function onSubmit() {
  syncStops()
  emit('submit', structuredClone(form))
}
</script>

<template>
  <form
    class="grid gap-4 max-w-xl border border-slate-800 rounded-lg p-4 bg-slate-900/50"
    @submit.prevent="onSubmit"
  >
    <div class="grid grid-cols-2 gap-3">
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">Brand</span>
        <input
          v-model="form.brand"
          required
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          placeholder="Bambu Lab"
        />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">Product name</span>
        <input
          v-model="form.name"
          required
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          placeholder="PLA Basic"
        />
      </label>
      <label class="grid gap-1 text-sm col-span-2">
        <span class="text-slate-400">Variant / color name (optional)</span>
        <input
          v-model="form.variant"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          placeholder="Sunset Orange"
        />
      </label>
    </div>

    <div class="grid gap-2">
      <span class="text-sm text-slate-400">Swatch (1–5 stops)</span>
      <GradientPicker v-model="form.swatch.stops" />
    </div>

    <div class="grid gap-2">
      <span class="text-sm text-slate-400">Effects</span>
      <EffectsPicker v-model="form.swatch.effects" />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">Spool state</span>
        <select
          v-model="form.spool_state"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
        >
          <option value="sealed">sealed</option>
          <option value="open">open</option>
          <option value="in-use">in use</option>
          <option value="empty">empty</option>
        </select>
      </label>
      <div class="grid gap-1 text-sm">
        <span class="text-slate-400">Rating</span>
        <RatingStars v-model="form.rating" />
      </div>
    </div>

    <label class="grid gap-1 text-sm">
      <span class="text-slate-400">Notes</span>
      <textarea
        v-model="form.notes"
        rows="2"
        class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 resize-y"
      ></textarea>
    </label>

    <div class="flex gap-2 justify-end">
      <button
        type="button"
        @click="emit('cancel')"
        class="px-3 py-1.5 text-sm border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
      >Cancel</button>
      <button
        type="submit"
        class="px-3 py-1.5 text-sm rounded bg-sky-600 text-white hover:bg-sky-500"
      >Save filament</button>
    </div>
  </form>
</template>
