<script setup lang="ts">
import type { Accessory } from '../types'
import RatingStars from './RatingStars.vue'
import { Trash2, Pencil, Package } from 'lucide-vue-next'

defineProps<{ accessory: Accessory }>()
defineEmits<{ edit: [string]; remove: [string] }>()
</script>

<template>
  <article class="border border-slate-800 rounded-lg p-3 flex gap-3 items-start bg-slate-900/40">
    <div class="w-12 h-12 rounded-md ring-1 ring-slate-700 flex items-center justify-center bg-slate-800 text-slate-400">
      <Package :size="24" />
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <h3 class="font-medium truncate">{{ accessory.brand }} &middot; {{ accessory.name }}</h3>
        <span v-if="accessory.sub_category" class="text-xs text-slate-400 truncate">{{ accessory.sub_category }}</span>
      </div>
      <div class="flex items-center gap-3 text-xs text-slate-400 mt-1">
        <span class="uppercase tracking-wide">{{ accessory.category.replace('_', ' ') }}</span>
        <span v-if="accessory.in_stock != null">{{ accessory.in_stock }} in stock</span>
        <span v-if="accessory.sku">SKU {{ accessory.sku }}</span>
        <RatingStars :model-value="accessory.rating" readonly :size="14" />
      </div>
      <p v-if="accessory.notes" class="text-sm text-slate-300 mt-1 line-clamp-2">{{ accessory.notes }}</p>
    </div>
    <div class="flex flex-col gap-1">
      <button
        @click="$emit('edit', accessory.id)"
        class="p-1.5 text-slate-400 hover:text-sky-400"
        title="Edit"
      ><Pencil :size="16" /></button>
      <button
        @click="$emit('remove', accessory.id)"
        class="p-1.5 text-slate-400 hover:text-red-400"
        title="Remove"
      ><Trash2 :size="16" /></button>
    </div>
  </article>
</template>
