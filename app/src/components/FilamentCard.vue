<script setup lang="ts">
import type { Filament } from '../types'
import SwatchPreview from './SwatchPreview.vue'
import RatingStars from './RatingStars.vue'
import { Trash2, Pencil } from 'lucide-vue-next'

defineProps<{ filament: Filament }>()
defineEmits<{ edit: [string]; remove: [string] }>()
</script>

<template>
  <article class="border border-slate-800 rounded-lg p-3 flex gap-3 items-start bg-slate-900/40">
    <SwatchPreview :swatch="filament.swatch" :size="48" />
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <h3 class="font-medium truncate">{{ filament.brand }} &middot; {{ filament.name }}</h3>
        <span v-if="filament.variant" class="text-xs text-slate-400 truncate">{{ filament.variant }}</span>
      </div>
      <div class="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
        <span>
          <span class="text-slate-200 font-medium">{{ filament.inventory.sealed + filament.inventory.open + filament.inventory.in_use }}</span> spool<template v-if="(filament.inventory.sealed + filament.inventory.open + filament.inventory.in_use) !== 1">s</template>
          <span class="text-slate-500">
            (<template v-if="filament.inventory.sealed">{{ filament.inventory.sealed }} sealed</template><template v-if="filament.inventory.sealed && (filament.inventory.open || filament.inventory.in_use)">, </template><template v-if="filament.inventory.open">{{ filament.inventory.open }} open</template><template v-if="filament.inventory.open && filament.inventory.in_use">, </template><template v-if="filament.inventory.in_use">{{ filament.inventory.in_use }} in use</template>)
          </span>
        </span>
        <span v-if="filament.swatch.effects.length">{{ filament.swatch.effects.join(', ') }}</span>
        <RatingStars :model-value="filament.rating" @update:model-value="() => {}" />
      </div>
      <p v-if="filament.notes" class="text-sm text-slate-300 mt-1 line-clamp-2">{{ filament.notes }}</p>
    </div>
    <div class="flex flex-col gap-1">
      <button
        @click="$emit('edit', filament.id)"
        class="p-1.5 text-slate-400 hover:text-sky-400"
        title="Edit"
      ><Pencil :size="16" /></button>
      <button
        @click="$emit('remove', filament.id)"
        class="p-1.5 text-slate-400 hover:text-red-400"
        title="Remove"
      ><Trash2 :size="16" /></button>
    </div>
  </article>
</template>
