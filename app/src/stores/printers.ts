import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Printer } from '../types'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'printers.json'

function newId() {
  return (globalThis.crypto?.randomUUID?.() ?? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
}

export const usePrintersStore = defineStore('printers', () => {
  const printers = ref<Printer[]>([])
  const loaded = ref(false)

  async function load() {
    const data = await loadData<Printer[]>(FILE, [])
    printers.value = Array.isArray(data) ? data : []
    loaded.value = true
  }
  async function save() {
    return saveData(FILE, printers.value)
  }

  /** No printers configured — drives the first-run "add a printer?" prompt. */
  const hasNone = computed(() => printers.value.length === 0)
  /** The active printer (explicit flag, else the first one). */
  const active = computed<Printer | null>(
    () => printers.value.find((p) => p.is_active) ?? printers.value[0] ?? null,
  )
  /** Any configured printer has an AMS / multi-material unit — gates AMS UI. */
  const hasAmsAnywhere = computed(() =>
    printers.value.some(
      (p) => p.spec?.ams && p.spec.ams.type && p.spec.ams.type.toLowerCase() !== 'none',
    ),
  )

  async function add(input: Omit<Printer, 'id' | 'added_at'> & Partial<Pick<Printer, 'id' | 'added_at'>>) {
    const printer: Printer = {
      ...input,
      id: input.id ?? newId(),
      added_at: input.added_at ?? new Date().toISOString(),
    }
    // First printer added becomes the active one by default.
    if (printers.value.length === 0) printer.is_active = true
    printers.value.push(printer)
    await save()
    return printer
  }

  async function update(id: string, patch: Partial<Printer>) {
    const i = printers.value.findIndex((p) => p.id === id)
    if (i === -1) return
    const prev = printers.value[i]
    printers.value[i] = { ...prev, ...patch, id: prev.id, added_at: prev.added_at }
    await save()
  }

  async function remove(id: string) {
    printers.value = printers.value.filter((p) => p.id !== id)
    // Keep exactly one active printer if any remain.
    if (printers.value.length && !printers.value.some((p) => p.is_active)) {
      printers.value[0].is_active = true
    }
    await save()
  }

  async function setActive(id: string) {
    printers.value.forEach((p) => { p.is_active = p.id === id })
    await save()
  }

  return { printers, loaded, hasNone, active, hasAmsAnywhere, load, save, add, update, remove, setActive }
})
