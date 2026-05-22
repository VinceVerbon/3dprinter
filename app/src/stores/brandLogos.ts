import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loadData, saveData } from '../composables/useDataPersistence'

const FILE = 'brand-logos.json'

export type BrandLogoKind = 'data-uri' | 'url' | 'text-only' | 'missing'

export interface BrandLogoEntry {
  kind: BrandLogoKind
  /** data: URI, http(s) URL, or undefined for text-only / missing */
  value?: string
  /** Resolved supplier domain (for re-fetch + provenance). */
  domain?: string
  /** Where the asset came from: clearbit, apple-touch-icon, manual-upload, manual-url. */
  source?: string
  /** ISO timestamp. */
  fetched_at?: string
}

export interface BrandLogosFile {
  brands: Record<string, BrandLogoEntry>
}

/** Slug a brand name to a stable key. */
export function brandSlug(brand: string): string {
  return brand.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

export const useBrandLogosStore = defineStore('brandLogos', () => {
  const file = ref<BrandLogosFile>({ brands: {} })
  const loaded = ref(false)

  async function load() {
    file.value = await loadData<BrandLogosFile>(FILE, { brands: {} })
    if (!file.value.brands) file.value.brands = {}
    loaded.value = true
  }

  function get(brand: string): BrandLogoEntry | undefined {
    return file.value.brands[brandSlug(brand)]
  }

  function set(brand: string, entry: BrandLogoEntry) {
    file.value.brands[brandSlug(brand)] = { ...entry, fetched_at: new Date().toISOString() }
  }

  function remove(brand: string) {
    delete file.value.brands[brandSlug(brand)]
  }

  async function save() {
    return saveData(FILE, file.value)
  }

  const entries = computed(() => Object.entries(file.value.brands))

  return { file, loaded, entries, load, get, set, remove, save }
})
