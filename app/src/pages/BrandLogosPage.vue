<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useFilamentsStore } from '../stores/filaments'
import { useBrandLogosStore, brandSlug, type BrandLogoEntry } from '../stores/brandLogos'
import { RouterLink } from 'vue-router'
import { ArrowLeft, Download, Type, Upload, RotateCcw, Image as ImageIcon, Loader2 } from 'lucide-vue-next'

const filaments = useFilamentsStore()
const logos = useBrandLogosStore()

const message = ref<string | null>(null)
const fetching = ref<Set<string>>(new Set())

onMounted(async () => {
  await Promise.all([filaments.load(), logos.load()])
})

/** Unique brand list derived from filaments inventory + brand-logos manual entries. */
const brands = computed<string[]>(() => {
  const set = new Set<string>()
  for (const f of filaments.items) if (f.brand) set.add(f.brand)
  // Include any brand that has a stored entry but no current filaments (don't drop history).
  for (const slug of Object.keys(logos.file.brands)) {
    // We can't reverse a slug back to display name reliably, so only add if missing.
    const known = Array.from(set).some(b => brandSlug(b) === slug)
    if (!known) set.add(slug.replace(/-/g, ' '))
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
})

function entryFor(brand: string): BrandLogoEntry | undefined {
  return logos.get(brand)
}

function productUrlForBrand(brand: string): string | undefined {
  const f = filaments.items.find(x => x.brand === brand && !!x.product_url)
  return f?.product_url
}

async function persist(action: string) {
  const r = await logos.save()
  message.value = r.ok
    ? `${action}.`
    : (r.offlineFallback ? 'Helper offline — change saved to localStorage.' : 'Save failed.')
  setTimeout(() => (message.value = null), 4000)
}

/**
 * Fetch one brand's logo and write the result into the store (in memory only —
 * the caller persists). Returns the outcome so bulk + single callers can report.
 */
async function fetchLogoInto(brand: string): Promise<'fetched' | 'missing' | 'error'> {
  try {
    const r = await fetch('/api/fetch-logo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand, product_url: productUrlForBrand(brand) }),
    })
    const body = await r.json()
    if (body.ok && body.value) {
      logos.set(brand, { kind: 'data-uri', value: body.value, domain: body.domain, source: body.source })
      return 'fetched'
    }
    // Endpoint reached, no logo found — record 'missing' so the UI shows it was tried.
    logos.set(brand, { kind: 'missing' })
    return 'missing'
  } catch {
    return 'error'
  }
}

async function autoFetch(brand: string) {
  if (fetching.value.has(brand)) return
  fetching.value.add(brand)
  message.value = `Fetching logo for ${brand}…`
  try {
    const outcome = await fetchLogoInto(brand)
    if (outcome === 'error') {
      message.value = `Fetch failed for ${brand}.`
      setTimeout(() => (message.value = null), 4000)
      return
    }
    await persist(outcome === 'fetched' ? `Logo fetched for ${brand}` : `No logo found for ${brand}`)
  } finally {
    fetching.value.delete(brand)
  }
}

// --- Bulk: fetch every brand that has no available logo ---------------------
// Targets brands with no entry or a prior 'missing' result (text-only is a
// deliberate user choice, so it's left alone). Runs with limited concurrency,
// reuses the per-row spinner, and persists once at the end (one atomic write,
// no save races).
const bulkFetching = ref(false)
const bulkDone = ref(0)
const bulkTotal = ref(0)

const needLogoBrands = computed(() =>
  brands.value.filter((b) => {
    const e = entryFor(b)
    return !e || e.kind === 'missing'
  }),
)

async function fetchAllMissing() {
  if (bulkFetching.value) return
  const targets = needLogoBrands.value.slice()
  if (targets.length === 0) {
    message.value = 'Every brand already has a logo (or is set to text-only).'
    setTimeout(() => (message.value = null), 4000)
    return
  }
  bulkFetching.value = true
  bulkTotal.value = targets.length
  bulkDone.value = 0
  let fetched = 0, stillMissing = 0, failed = 0
  let cursor = 0
  const CONCURRENCY = 4
  const worker = async () => {
    while (cursor < targets.length) {
      const brand = targets[cursor++]
      fetching.value.add(brand)
      const outcome = await fetchLogoInto(brand)
      fetching.value.delete(brand)
      if (outcome === 'fetched') fetched++
      else if (outcome === 'missing') stillMissing++
      else failed++
      bulkDone.value++
      message.value = `Fetching logos… ${bulkDone.value}/${bulkTotal.value} (${fetched} found)`
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
    const saveRes = await logos.save()
    const note = saveRes.ok ? '' : (saveRes.offlineFallback ? ' (saved locally — helper offline)' : ' (save failed!)')
    message.value = `Done — ${fetched} fetched, ${stillMissing} not found${failed ? `, ${failed} failed` : ''}.${note}`
    setTimeout(() => (message.value = null), 8000)
  } finally {
    bulkFetching.value = false
  }
}

function setTextOnly(brand: string) {
  logos.set(brand, { kind: 'text-only' })
  void persist(`${brand} set to text-only`)
}

function clearLogo(brand: string) {
  logos.remove(brand)
  void persist(`${brand} cleared`)
}

async function onFile(brand: string, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 1024 * 1024) {
    message.value = 'File too large (max 1 MB). Use a smaller PNG/SVG.'
    setTimeout(() => (message.value = null), 4000)
    return
  }
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUri = reader.result as string
    logos.set(brand, { kind: 'data-uri', value: dataUri, source: 'manual-upload' })
    await persist(`Logo uploaded for ${brand}`)
  }
  reader.readAsDataURL(file)
  // Reset so re-selecting the same file fires change again.
  input.value = ''
}

async function setUrl(brand: string, url: string) {
  if (!url.trim()) return
  if (fetching.value.has(brand)) return
  fetching.value.add(brand)
  message.value = `Fetching ${url}…`
  try {
    // Convert URL to data-URI server-side so it can't 404 at print time and
    // doesn't depend on CORS at the label-render path.
    const r = await fetch('/api/fetch-url-as-data-uri', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    })
    const body = await r.json()
    if (body.ok && body.value) {
      logos.set(brand, { kind: 'data-uri', value: body.value, source: 'manual-url' })
      await persist(`Logo set for ${brand} (fetched & embedded)`)
    } else {
      message.value = `Could not fetch ${url}: ${body.error || 'unknown error'}`
      setTimeout(() => (message.value = null), 5000)
    }
  } catch (e) {
    message.value = `Fetch failed: ${(e as Error).message}`
    setTimeout(() => (message.value = null), 5000)
  } finally {
    fetching.value.delete(brand)
  }
}
</script>

<template>
  <section class="max-w-3xl">
    <header class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <RouterLink
          to="/labels"
          class="flex items-center gap-1 text-sm text-slate-400 hover:text-sky-400"
        >
          <ArrowLeft :size="16" /> Labels
        </RouterLink>
        <h2 class="text-lg font-semibold">Brand logos</h2>
        <span class="text-slate-500 text-sm">({{ brands.length }})</span>
      </div>

      <button
        v-if="needLogoBrands.length > 0 || bulkFetching"
        @click="fetchAllMissing"
        :disabled="bulkFetching"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-60 shrink-0"
      >
        <Loader2 v-if="bulkFetching" :size="14" class="animate-spin" />
        <Download v-else :size="14" />
        {{ bulkFetching ? `Fetching ${bulkDone}/${bulkTotal}…` : `Fetch all missing (${needLogoBrands.length})` }}
      </button>
    </header>

    <p class="text-xs text-slate-400 mb-4">
      Logos are printed on each filament label. Auto-fetch tries Clearbit, then the supplier's favicon; failing that pick
      <em>Text only</em> to fall back to a styled brand wordmark, or upload your own SVG/PNG.
    </p>

    <p v-if="message" class="text-sm text-slate-400 mb-3">{{ message }}</p>

    <ul class="grid gap-2">
      <li
        v-for="brand in brands"
        :key="brand"
        class="border border-slate-800 rounded-lg p-3 bg-slate-900/40"
      >
        <div class="flex items-start gap-3">
          <!-- Preview chip -->
          <div class="w-20 h-14 border border-slate-800 rounded bg-white flex items-center justify-center overflow-hidden text-slate-700">
            <img
              v-if="entryFor(brand) && (entryFor(brand)!.kind === 'data-uri' || entryFor(brand)!.kind === 'url') && entryFor(brand)!.value"
              :src="entryFor(brand)!.value"
              :alt="brand"
              class="max-w-full max-h-full object-contain"
            />
            <span
              v-else-if="entryFor(brand)?.kind === 'text-only'"
              class="font-extrabold text-sm px-1 text-center"
              style="font-family: 'Plus Jakarta Sans', sans-serif;"
            >{{ brand }}</span>
            <ImageIcon v-else :size="20" class="text-slate-400" />
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-medium truncate">{{ brand }}</h3>
              <span
                v-if="entryFor(brand)"
                class="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400"
              >
                {{ entryFor(brand)?.kind }}
                <template v-if="entryFor(brand)?.source"> · {{ entryFor(brand)?.source }}</template>
                <template v-if="entryFor(brand)?.domain"> · {{ entryFor(brand)?.domain }}</template>
              </span>
              <span
                v-else
                class="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-500"
              >no logo set</span>
            </div>

            <div class="flex flex-wrap gap-2 mt-2">
              <button
                @click="autoFetch(brand)"
                :disabled="fetching.has(brand)"
                class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-sky-700/60 bg-sky-700/30 text-sky-100 hover:bg-sky-700/50 disabled:opacity-60"
              >
                <Download :size="12" />
                {{ fetching.has(brand) ? 'Fetching…' : 'Auto-fetch' }}
              </button>

              <label class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer">
                <Upload :size="12" /> Upload
                <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" class="hidden" @change="onFile(brand, $event)" />
              </label>

              <button
                @click="setTextOnly(brand)"
                class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-700 text-slate-200 hover:bg-slate-800"
              >
                <Type :size="12" /> Text only
              </button>

              <button
                v-if="entryFor(brand)"
                @click="clearLogo(brand)"
                class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-700 text-slate-400 hover:text-red-400"
              >
                <RotateCcw :size="12" /> Reset
              </button>
            </div>

            <details class="mt-2 text-xs">
              <summary class="cursor-pointer text-slate-500 hover:text-slate-300">Paste URL instead</summary>
              <form
                class="flex gap-2 mt-2"
                @submit.prevent="(e) => setUrl(brand, ((e.target as HTMLFormElement).elements.namedItem('url') as HTMLInputElement).value)"
              >
                <input
                  name="url"
                  type="url"
                  placeholder="https://example.com/logo.png"
                  class="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                />
                <button type="submit" class="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white">Set</button>
              </form>
            </details>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="brands.length === 0" class="text-slate-500 text-sm py-8 text-center border border-dashed border-slate-800 rounded-lg">
      No brands in inventory yet.
    </div>
  </section>
</template>
