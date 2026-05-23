<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import type { Filament, Effect } from '../types'
import GradientPicker from './GradientPicker.vue'
import EffectsPicker from './EffectsPicker.vue'
import RatingStars from './RatingStars.vue'
import { useFilamentLookup } from '../composables/useFilamentLookup'
import { useAiSettings } from '../composables/useAiSettings'
import { Sparkles } from 'lucide-vue-next'

const { aiEnabled } = useAiSettings()

const props = defineProps<{ initial?: Filament }>()
const emit = defineEmits<{ submit: [Filament]; cancel: [] }>()

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'f_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// JSON roundtrip rather than structuredClone: structuredClone() rejects Vue's
// reactive Proxy with DataCloneError. Filament data is pure JSON, so a stringify
// roundtrip both unwraps the proxy and yields the plain object the parent expects.
function cloneJson<T>(v: T): T { return JSON.parse(JSON.stringify(v)) }

const form = reactive<Filament>(
  props.initial
    ? cloneJson(props.initial)
    : {
        id: uuid(),
        brand: 'Bambu Lab',
        name: '',
        variant: '',
        swatch: { hex: '#888888', stops: ['#888888'], effects: [], source: 'manual' },
        rating: undefined,
        notes: '',
        inventory: { sealed: 1, open: 0, in_use: 0, on_spool: 1, refill: 0 },
        spool_grams_total: 1000,
        added_at: new Date().toISOString(),
      },
)

// Legacy records (pre-packaging-split) lack on_spool/refill — seed them so the
// balance check starts satisfied (everything counted as on-spool by default).
if (form.inventory.on_spool == null)
  form.inventory.on_spool = (form.inventory.sealed || 0) + (form.inventory.open || 0) + (form.inventory.in_use || 0)
if (form.inventory.refill == null) form.inventory.refill = 0

// The packaging split (on_spool + refill) must equal the state split
// (sealed + open + in_use). Both partition the same physical stock.
const stateTotal = computed(() =>
  (form.inventory.sealed || 0) + (form.inventory.open || 0) + (form.inventory.in_use || 0))
const packagingTotal = computed(() => (form.inventory.on_spool || 0) + (form.inventory.refill || 0))
const inventoryBalanced = computed(() => stateTotal.value === packagingTotal.value)

const { lookup, loading, error } = useFilamentLookup()
const lookupResult = ref<Filament['ai'] | null>(form.ai ?? null)

async function runLookup(force = false) {
  if (!form.brand || !form.name) return
  const r = await lookup(form.brand, form.name, force)
  if (r) {
    lookupResult.value = r
    form.ai = r
  }
}

function syncStops() {
  form.swatch.hex = form.swatch.stops[0] ?? '#888888'
  if (form.swatch.stops.length > 1 && !form.swatch.effects.includes('multicolor')) {
    form.swatch.effects = [...form.swatch.effects, 'multicolor' as Effect]
  }
}

function onSubmit() {
  if (!inventoryBalanced.value) return   // guard; Save button is also disabled
  syncStops()
  emit('submit', cloneJson(form))
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

    <div class="grid gap-2">
      <span class="text-sm text-slate-400">Inventory (spools by state)</span>
      <div class="grid grid-cols-3 gap-3">
        <label class="grid gap-1 text-xs">
          <span class="text-slate-500">Sealed</span>
          <input
            v-model.number="form.inventory.sealed"
            type="number"
            min="0"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
        </label>
        <label class="grid gap-1 text-xs">
          <span class="text-slate-500">Open</span>
          <input
            v-model.number="form.inventory.open"
            type="number"
            min="0"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
        </label>
        <label class="grid gap-1 text-xs">
          <span class="text-slate-500">In use</span>
          <input
            v-model.number="form.inventory.in_use"
            type="number"
            min="0"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
        </label>
      </div>
    </div>

    <div class="grid gap-2">
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-400">Packaging (on spool vs refill)</span>
        <span
          class="text-xs font-medium tabular-nums"
          :class="inventoryBalanced ? 'text-emerald-400' : 'text-amber-400'"
        >{{ packagingTotal }} / {{ stateTotal }} in stock</span>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="grid gap-1 text-xs">
          <span class="text-slate-500">On spool</span>
          <input
            v-model.number="form.inventory.on_spool"
            type="number"
            min="0"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
        </label>
        <label class="grid gap-1 text-xs">
          <span class="text-slate-500">Refill (no spool)</span>
          <input
            v-model.number="form.inventory.refill"
            type="number"
            min="0"
            class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
        </label>
      </div>
      <p v-if="!inventoryBalanced" class="text-xs text-amber-400">
        On spool + refill ({{ packagingTotal }}) must equal sealed + open + in use ({{ stateTotal }}). Adjust the amounts before saving.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="grid gap-1 text-sm">
        <span class="text-slate-400">Spool weight (g)</span>
        <input
          v-model.number="form.spool_grams_total"
          type="number"
          min="0"
          step="50"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          placeholder="1000"
        />
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

    <div class="border-t border-slate-800 pt-3 grid gap-2">
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-400">AI usage info</span>
        <button
          v-if="aiEnabled"
          type="button"
          @click="runLookup(false)"
          :disabled="!form.brand || !form.name || loading"
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-violet-700/40 border border-violet-600/60 text-violet-100 hover:bg-violet-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles :size="14" /> {{ loading ? 'Looking up…' : (lookupResult ? 'Re-lookup' : 'Lookup AI') }}
        </button>
        <span v-else class="text-xs text-slate-500">AI disabled in settings</span>
      </div>
      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
      <div v-if="lookupResult" class="text-xs grid gap-1 text-slate-300">
        <div><span class="text-slate-500">Type:</span> {{ lookupResult.type }}<span v-if="lookupResult.abrasive" class="ml-2 text-amber-400">⚠ abrasive</span></div>
        <div>
          <span class="text-slate-500">P2S+AMS 2 Pro:</span>
          {{ lookupResult.p2s_compatibility.ams2pro ? '✓' : '✗' }}<template v-if="lookupResult.p2s_compatibility.hardened_nozzle_required">, hardened nozzle required</template>
          <template v-if="lookupResult.p2s_compatibility.notes"> — {{ lookupResult.p2s_compatibility.notes }}</template>
        </div>
        <div v-if="lookupResult.drying.temp_c != null">
          <span class="text-slate-500">Drying:</span> {{ lookupResult.drying.temp_c }}°C / {{ lookupResult.drying.hours }}h<template v-if="lookupResult.drying.desiccant_recommended">, desiccant recommended</template>
        </div>
        <div v-if="lookupResult.print_temp_c">
          <span class="text-slate-500">Print:</span> {{ lookupResult.print_temp_c[0] }}–{{ lookupResult.print_temp_c[1] }}°C
        </div>
        <div v-if="lookupResult.bed_temp_c">
          <span class="text-slate-500">Bed:</span> {{ lookupResult.bed_temp_c[0] }}–{{ lookupResult.bed_temp_c[1] }}°C
        </div>
        <p v-if="lookupResult.usage_notes" class="text-slate-400">{{ lookupResult.usage_notes }}</p>
      </div>
      <p v-else-if="!error" class="text-xs text-slate-500">Click <em>Lookup AI</em> after entering brand + name to fetch P2S compatibility, drying spec, and usage notes.</p>
    </div>

    <div class="flex gap-2 justify-end">
      <button
        type="button"
        @click="emit('cancel')"
        class="px-3 py-1.5 text-sm border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
      >Cancel</button>
      <button
        type="submit"
        :disabled="!inventoryBalanced"
        :title="inventoryBalanced ? '' : 'On spool + refill must equal the total in stock'"
        class="px-3 py-1.5 text-sm rounded bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >Save filament</button>
    </div>
  </form>
</template>
