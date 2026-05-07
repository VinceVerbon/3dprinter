<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useAccessoriesStore } from '../stores/accessories'
import AccessoryCard from '../components/AccessoryCard.vue'
import AccessoryForm from '../components/AccessoryForm.vue'
import type { Accessory } from '../types'
import { Plus } from 'lucide-vue-next'

const store = useAccessoriesStore()
const showForm = ref(false)
const editing = ref<Accessory | undefined>(undefined)
const saving = ref(false)
const message = ref<string | null>(null)
const filterCategory = ref<string>('')

onMounted(() => store.load())

const filtered = computed(() =>
  filterCategory.value
    ? store.items.filter(a => a.category === filterCategory.value)
    : store.items,
)

function startAdd() { editing.value = undefined; showForm.value = true; message.value = null }
function startEdit(id: string) {
  const a = store.items.find(x => x.id === id)
  if (a) { editing.value = a; showForm.value = true; message.value = null }
}
async function onSubmit(a: Accessory) {
  if (editing.value) store.update(a.id, a)
  else store.add(a)
  showForm.value = false
  saving.value = true
  const r = await store.save()
  saving.value = false
  message.value = r.ok ? 'Saved.' : (r.offlineFallback ? 'Helper offline — saved to localStorage.' : 'Save failed.')
  setTimeout(() => (message.value = null), 4000)
}
async function onRemove(id: string) {
  store.remove(id)
  saving.value = true
  await store.save()
  saving.value = false
}
</script>

<template>
  <section class="max-w-3xl">
    <header class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">Accessories <span class="text-slate-500 font-normal">({{ store.count }})</span></h2>
      <div class="flex items-center gap-2">
        <select
          v-model="filterCategory"
          class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
        >
          <option value="">All categories</option>
          <option v-for="c in Object.keys(store.byCategory)" :key="c" :value="c">
            {{ c.replace('_', ' ') }} ({{ store.byCategory[c].length }})
          </option>
        </select>
        <button
          @click="startAdd"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500"
        >
          <Plus :size="16" /> Add accessory
        </button>
      </div>
    </header>

    <p v-if="message" class="text-sm text-slate-400 mb-3">{{ message }}</p>
    <p v-if="saving" class="text-xs text-slate-500 mb-3">Saving…</p>

    <div v-if="showForm" class="mb-6">
      <AccessoryForm
        :initial="editing"
        @submit="onSubmit"
        @cancel="showForm = false"
      />
    </div>

    <div v-if="filtered.length === 0" class="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-800 rounded-lg">
      <template v-if="filterCategory">No accessories in <em>{{ filterCategory }}</em>.</template>
      <template v-else>No accessories yet. Click <em>Add accessory</em> to start.</template>
    </div>
    <ul v-else class="grid gap-2">
      <li v-for="a in filtered" :key="a.id">
        <AccessoryCard :accessory="a" @edit="startEdit" @remove="onRemove" />
      </li>
    </ul>
  </section>
</template>
