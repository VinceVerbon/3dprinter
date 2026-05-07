<script setup lang="ts">
import { computed } from 'vue'
import type { Filament } from '../types'
import SwatchPreview from './SwatchPreview.vue'
import RatingStars from './RatingStars.vue'
import { useFilamentLookup } from '../composables/useFilamentLookup'
import { ref } from 'vue'
import { X, ExternalLink, Pencil, Sparkles } from 'lucide-vue-next'

const props = defineProps<{ filament: Filament }>()
const emit = defineEmits<{ close: []; edit: [string] }>()

const { lookup, loading, error } = useFilamentLookup()
const ai = ref<Filament['ai'] | null>(props.filament.ai ?? null)

async function refreshAi() {
  const r = await lookup(props.filament.brand, props.filament.name, true)
  if (r) ai.value = r
}

const totalSpools = computed(() =>
  props.filament.inventory.sealed + props.filament.inventory.open + props.filament.inventory.in_use,
)

const tempRange = (r: [number, number] | null | undefined) =>
  r ? `${r[0]}–${r[1]} °C` : '—'
</script>

<template>
  <div
    class="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-12 px-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[85vh]">
      <header class="px-4 py-3 border-b border-slate-800 flex items-start gap-3">
        <SwatchPreview :swatch="filament.swatch" :size="56" />
        <div class="flex-1 min-w-0">
          <h3 class="font-semibold truncate">{{ filament.brand }} &middot; {{ filament.name }}</h3>
          <p v-if="filament.variant" class="text-sm text-slate-400 mt-0.5">{{ filament.variant }}</p>
          <div class="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-slate-400">
            <RatingStars :model-value="filament.rating" readonly :size="14" />
            <span v-if="filament.swatch.effects.length">{{ filament.swatch.effects.join(', ') }}</span>
            <span v-if="ai?.type" class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 uppercase tracking-wide text-[10px]">{{ ai.type }}</span>
            <span v-if="ai?.abrasive" class="text-amber-400">⚠ abrasive</span>
          </div>
        </div>
        <div class="flex gap-1">
          <button
            @click="emit('edit', filament.id); emit('close')"
            class="p-1.5 text-slate-400 hover:text-sky-400"
            title="Edit"
          ><Pencil :size="16" /></button>
          <button
            @click="emit('close')"
            class="p-1.5 text-slate-400 hover:text-slate-100"
            title="Close"
          ><X :size="18" /></button>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto px-4 py-4 grid gap-5 text-sm">
        <!-- Inventory -->
        <section>
          <h4 class="text-xs uppercase tracking-wide text-slate-500 mb-2">Inventory</h4>
          <div class="grid grid-cols-4 gap-2">
            <div class="bg-slate-800/50 rounded px-3 py-2">
              <div class="text-2xl font-semibold">{{ totalSpools }}</div>
              <div class="text-xs text-slate-400">total spools</div>
            </div>
            <div class="bg-slate-800/50 rounded px-3 py-2">
              <div class="text-2xl font-semibold">{{ filament.inventory.sealed }}</div>
              <div class="text-xs text-slate-400">sealed</div>
            </div>
            <div class="bg-slate-800/50 rounded px-3 py-2">
              <div class="text-2xl font-semibold">{{ filament.inventory.open }}</div>
              <div class="text-xs text-slate-400">open</div>
            </div>
            <div class="bg-slate-800/50 rounded px-3 py-2">
              <div class="text-2xl font-semibold">{{ filament.inventory.in_use }}</div>
              <div class="text-xs text-slate-400">in use</div>
            </div>
          </div>
          <p v-if="filament.spool_grams_total" class="text-xs text-slate-500 mt-2">
            {{ filament.spool_grams_total }} g per spool
          </p>
        </section>

        <!-- Identifiers -->
        <section v-if="filament.sku || filament.product_url || filament.color_code || filament.ean || filament.rfid_uid">
          <h4 class="text-xs uppercase tracking-wide text-slate-500 mb-2">Identifiers</h4>
          <dl class="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-1 text-xs">
            <template v-if="filament.sku">
              <dt class="text-slate-500">SKU</dt>
              <dd class="text-slate-200 font-mono">{{ filament.sku }}</dd>
            </template>
            <template v-if="filament.color_code">
              <dt class="text-slate-500">Color code</dt>
              <dd class="text-slate-200 font-mono">{{ filament.color_code }}</dd>
            </template>
            <template v-if="filament.ean">
              <dt class="text-slate-500">EAN</dt>
              <dd class="text-slate-200 font-mono">{{ filament.ean }}</dd>
            </template>
            <template v-if="filament.rfid_uid">
              <dt class="text-slate-500">RFID UID</dt>
              <dd class="text-slate-200 font-mono">{{ filament.rfid_uid }}</dd>
            </template>
            <template v-if="filament.product_url">
              <dt class="text-slate-500">Product</dt>
              <dd class="truncate">
                <a :href="filament.product_url" target="_blank" rel="noopener" class="text-sky-400 hover:underline inline-flex items-center gap-1">
                  {{ filament.product_url }} <ExternalLink :size="12" />
                </a>
              </dd>
            </template>
          </dl>
        </section>

        <!-- Purchase metadata -->
        <section v-if="filament.purchased && (filament.purchased.date || filament.purchased.price_eur || filament.purchased.source)">
          <h4 class="text-xs uppercase tracking-wide text-slate-500 mb-2">Purchase</h4>
          <dl class="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-1 text-xs">
            <template v-if="filament.purchased.date">
              <dt class="text-slate-500">Date</dt>
              <dd class="text-slate-200">{{ filament.purchased.date }}</dd>
            </template>
            <template v-if="filament.purchased.price_eur != null">
              <dt class="text-slate-500">Price</dt>
              <dd class="text-slate-200">€{{ filament.purchased.price_eur.toFixed(2) }}</dd>
            </template>
            <template v-if="filament.purchased.source">
              <dt class="text-slate-500">Source</dt>
              <dd class="text-slate-200">{{ filament.purchased.source }}</dd>
            </template>
            <template v-if="filament.purchased.order_ref">
              <dt class="text-slate-500">Order ref</dt>
              <dd class="text-slate-200 font-mono">{{ filament.purchased.order_ref }}</dd>
            </template>
          </dl>
        </section>

        <!-- AI usage info -->
        <section>
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-xs uppercase tracking-wide text-slate-500">P2S usage info</h4>
            <button
              @click="refreshAi"
              :disabled="loading"
              class="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded bg-violet-700/40 border border-violet-600/60 text-violet-100 hover:bg-violet-700/60 disabled:opacity-40"
            >
              <Sparkles :size="12" /> {{ loading ? 'Looking up…' : (ai ? 'Re-lookup' : 'Lookup AI') }}
            </button>
          </div>
          <p v-if="error" class="text-xs text-red-400 mb-2">{{ error }}</p>
          <div v-if="ai" class="grid gap-2 text-xs">
            <div class="grid grid-cols-2 gap-2">
              <div class="bg-slate-800/50 rounded px-3 py-2">
                <div class="text-slate-500 text-[10px] uppercase">Print temp</div>
                <div class="text-slate-100 font-medium">{{ tempRange(ai.print_temp_c) }}</div>
              </div>
              <div class="bg-slate-800/50 rounded px-3 py-2">
                <div class="text-slate-500 text-[10px] uppercase">Bed temp</div>
                <div class="text-slate-100 font-medium">{{ tempRange(ai.bed_temp_c) }}</div>
              </div>
            </div>
            <div class="bg-slate-800/50 rounded px-3 py-2">
              <div class="text-slate-500 text-[10px] uppercase mb-1">P2S + AMS 2 Pro</div>
              <div class="text-slate-100">
                {{ ai.p2s_compatibility.ams2pro ? '✓ Compatible with AMS 2 Pro' : '✗ Not recommended for AMS 2 Pro' }}
                <template v-if="ai.p2s_compatibility.hardened_nozzle_required"> · hardened nozzle required</template>
              </div>
              <p v-if="ai.p2s_compatibility.notes" class="text-slate-400 mt-1">{{ ai.p2s_compatibility.notes }}</p>
            </div>
            <div v-if="ai.drying.temp_c != null || ai.drying.hours != null" class="bg-slate-800/50 rounded px-3 py-2">
              <div class="text-slate-500 text-[10px] uppercase mb-1">Drying</div>
              <div class="text-slate-100">
                <template v-if="ai.drying.temp_c != null">{{ ai.drying.temp_c }} °C</template>
                <template v-if="ai.drying.temp_c != null && ai.drying.hours != null"> · </template>
                <template v-if="ai.drying.hours != null">{{ ai.drying.hours }} h</template>
                <template v-if="ai.drying.desiccant_recommended"> · desiccant recommended</template>
              </div>
            </div>
            <div v-if="ai.annealable != null" class="bg-slate-800/50 rounded px-3 py-2">
              <div class="text-slate-500 text-[10px] uppercase mb-1">Annealable</div>
              <div class="text-slate-100">{{ ai.annealable ? 'Yes' : 'No' }}</div>
            </div>
            <p v-if="ai.usage_notes" class="text-slate-300 leading-relaxed">{{ ai.usage_notes }}</p>
          </div>
          <p v-else class="text-xs text-slate-500">
            No AI info yet. Click <em>Lookup AI</em> to fetch P2S compatibility, drying spec, and usage notes.
          </p>
        </section>

        <!-- Notes -->
        <section v-if="filament.notes">
          <h4 class="text-xs uppercase tracking-wide text-slate-500 mb-2">Notes</h4>
          <p class="text-slate-200 whitespace-pre-wrap">{{ filament.notes }}</p>
        </section>

        <!-- Added -->
        <p class="text-[10px] text-slate-600 text-right">
          Added {{ filament.added_at?.slice(0, 10) }}
        </p>
      </div>
    </div>
  </div>
</template>
