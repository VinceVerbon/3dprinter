import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Filament } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'
import { cleanFilamentName } from '../lib/filamentName'

const FILE = 'filaments.json'

/** Bring records up to the current schema on load: clean any leftover retailer
 *  cruft from names (idempotent) and backfill the on_spool/refill packaging
 *  split for records created before it existed (everything counts as on-spool
 *  by default, so the on_spool+refill == total invariant starts satisfied). */
function normalize(list: Filament[]): Filament[] {
  for (const f of list) {
    if (f?.name) f.name = cleanFilamentName(f.name)
    const inv = (f.inventory ??= { sealed: 0, open: 0, in_use: 0, on_spool: 0, refill: 0 })
    if (inv.on_spool == null && inv.refill == null) {
      inv.on_spool = (inv.sealed || 0) + (inv.open || 0) + (inv.in_use || 0)
      inv.refill = 0
    } else {
      inv.on_spool = inv.on_spool || 0
      inv.refill = inv.refill || 0
    }
  }
  return list
}

export const useFilamentsStore = defineStore('filaments', () => {
  const items = ref<Filament[]>([])
  const loaded = ref(false)
  const dirty = ref(false)

  async function load() {
    items.value = normalize(await loadData<Filament[]>(FILE, []))
    loaded.value = true
    dirty.value = false
  }

  function add(f: Filament) {
    items.value.push(f)
    dirty.value = true
  }
  function update(id: string, patch: Partial<Filament>) {
    const i = items.value.findIndex(x => x.id === id)
    if (i >= 0) {
      items.value[i] = { ...items.value[i], ...patch }
      dirty.value = true
    }
  }
  function remove(id: string) {
    items.value = items.value.filter(x => x.id !== id)
    dirty.value = true
  }

  async function save() {
    const r = await saveData(FILE, items.value)
    if (r.ok) dirty.value = false
    return r
  }

  const count = computed(() => items.value.length)

  return { items, loaded, dirty, count, load, add, update, remove, save }
})
