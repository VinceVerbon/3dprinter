<script setup lang="ts">
import { reactive } from 'vue'
import type { Accessory, AccessoryCategory } from '../types'
import RatingStars from './RatingStars.vue'

const props = defineProps<{ initial?: Accessory }>()
const emit = defineEmits<{ submit: [Accessory]; cancel: [] }>()

const CATEGORIES: AccessoryCategory[] = [
  'nozzle', 'hotend', 'build_plate', 'ams', 'fan', 'belt',
  'lubricant', 'glue', 'desiccant', 'tool', 'cleaning', 'other',
]

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'a_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const form = reactive<Accessory>(
  props.initial
    ? structuredClone(props.initial)
    : {
        id: uuid(),
        brand: '',
        name: '',
        category: 'other',
        sub_category: '',
        sku: '',
        rating: undefined,
        notes: '',
        in_stock: 1,
        added_at: new Date().toISOString(),
      },
)

function onSubmit() {
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
          placeholder="Hardened Steel Nozzle 0.4 mm"
        />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">Category</span>
        <select
          v-model="form.category"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
        >
          <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c.replace('_', ' ') }}</option>
        </select>
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">Sub-category (optional)</span>
        <input
          v-model="form.sub_category"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          placeholder="0.4 mm"
        />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">SKU (optional)</span>
        <input
          v-model="form.sku"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
        />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">In stock</span>
        <input
          v-model.number="form.in_stock"
          type="number"
          min="0"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
        />
      </label>
    </div>

    <div class="grid grid-cols-2 gap-3 items-end">
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
      >Save accessory</button>
    </div>
  </form>
</template>
