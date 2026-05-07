<script setup lang="ts">
import { ref } from 'vue'
import { Upload, FileText, Loader2, X } from 'lucide-vue-next'

export type ImportedItem = {
  kind: 'filament' | 'accessory' | 'consumable' | 'unknown'
  brand: string
  name: string
  variant?: string
  sku?: string
  ean?: string
  quantity: number
  unit_price_eur?: number
  total_eur?: number
}
export type ImportResult = {
  ok: boolean
  vendor_guess?: string
  order_ref?: string
  order_date?: string
  items: ImportedItem[]
  total_eur?: number
  raw_text_preview?: string
}

const emit = defineEmits<{ result: [ImportResult]; close: [] }>()

const dragActive = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

function onDragEnter(e: DragEvent) { e.preventDefault(); dragActive.value = true }
function onDragOver(e: DragEvent) { e.preventDefault(); dragActive.value = true }
function onDragLeave() { dragActive.value = false }

async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragActive.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) await upload(file)
}

function onPick() {
  fileInputRef.value?.click()
}

async function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) await upload(file)
}

async function upload(file: File) {
  error.value = null
  if (!/\.pdf$/i.test(file.name)) {
    error.value = 'Only .pdf files are accepted.'
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    error.value = 'File too large (10 MB max).'
    return
  }
  loading.value = true
  try {
    const fd = new FormData()
    fd.append('pdf', file)
    fd.append('filename', file.name)
    const r = await fetch('/api/import-order', { method: 'POST', body: fd })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new Error(`HTTP ${r.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    const json = (await r.json()) as ImportResult
    emit('result', json)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-16 px-4">
    <div class="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
      <header class="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h3 class="font-semibold flex items-center gap-2"><FileText :size="16" /> Import order from PDF</h3>
        <button @click="emit('close')" class="p-1 text-slate-400 hover:text-slate-100" aria-label="Close">
          <X :size="18" />
        </button>
      </header>

      <div class="p-4">
        <div
          @dragenter="onDragEnter"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
          @click="onPick"
          :class="[
            'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition',
            dragActive ? 'border-sky-500 bg-sky-500/10' : 'border-slate-700 hover:border-slate-500',
          ]"
        >
          <Upload v-if="!loading" :size="32" class="mx-auto text-slate-500 mb-2" />
          <Loader2 v-else :size="32" class="mx-auto text-sky-400 mb-2 animate-spin" />
          <p v-if="loading" class="text-sm text-slate-300">Extracting…</p>
          <p v-else class="text-sm text-slate-300">
            Drop a <strong>.pdf</strong> order receipt here, or click to pick a file.
          </p>
          <p class="text-xs text-slate-500 mt-1">Bambu Lab EU, 123-3d.nl, Amazon NL, RealFilament, etc. (max 10 MB)</p>
        </div>

        <input
          ref="fileInputRef"
          type="file"
          accept="application/pdf,.pdf"
          class="hidden"
          @change="onFileChange"
        />

        <p v-if="error" class="text-xs text-red-400 mt-3">{{ error }}</p>
        <p class="text-xs text-slate-500 mt-3">
          The file is sent to your local helper at <code>/api/import-order</code>, which forwards it to your Claude CLI for extraction. No API key. No data leaves your machine except the PDF body that goes to Claude.
        </p>
      </div>
    </div>
  </div>
</template>
