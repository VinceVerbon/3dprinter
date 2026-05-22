import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
  OVERRIDABLE_FIELDS,
  type LabelFormat,
  type OverridableField,
} from '../lib/labels/presets'

const STORAGE_KEY = 'label.format.v1'
const LEGACY_TOP_MARGIN_KEY = 'label.topMarginMm'

interface PersistedState {
  presetId: string
  overrides: Partial<Record<OverridableField, number>>
}

function loadPersisted(): PersistedState {
  // Migrate the old `label.topMarginMm` key into a marginTop override on the
  // default (Decadry) preset, then drop the legacy key.
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState
      if (typeof parsed.presetId === 'string' && PRESETS.some(p => p.id === parsed.presetId)) {
        return {
          presetId: parsed.presetId,
          overrides: sanitiseOverrides(parsed.overrides ?? {}),
        }
      }
    }
    const legacy = localStorage.getItem(LEGACY_TOP_MARGIN_KEY)
    if (legacy != null) {
      const n = Number(legacy)
      const overrides: PersistedState['overrides'] = Number.isFinite(n) && n >= 0 && n <= 50
        ? { marginTop: n }
        : {}
      localStorage.removeItem(LEGACY_TOP_MARGIN_KEY)
      return { presetId: DEFAULT_PRESET_ID, overrides }
    }
  } catch {
    /* ignore — fall through to default */
  }
  return { presetId: DEFAULT_PRESET_ID, overrides: {} }
}

function sanitiseOverrides(o: Partial<Record<OverridableField, number>>): Partial<Record<OverridableField, number>> {
  const out: Partial<Record<OverridableField, number>> = {}
  for (const key of OVERRIDABLE_FIELDS) {
    const v = o[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000) {
      out[key] = v
    }
  }
  return out
}

export const useLabelFormatStore = defineStore('labelFormat', () => {
  const initial = loadPersisted()
  const presetId = ref<string>(initial.presetId)
  const overrides = ref<Partial<Record<OverridableField, number>>>({ ...initial.overrides })

  const preset = computed<LabelFormat>(() => getPreset(presetId.value))

  const format = computed<LabelFormat>(() => {
    const base = preset.value
    const o = overrides.value
    return {
      ...base,
      paperW: o.paperW ?? base.paperW,
      paperH: o.paperH ?? base.paperH,
      cols: o.cols ?? base.cols,
      rows: o.rows ?? base.rows,
      labelW: o.labelW ?? base.labelW,
      labelH: o.labelH ?? base.labelH,
      marginTop: o.marginTop ?? base.marginTop,
      marginBottom: o.marginBottom ?? base.marginBottom,
      marginLeft: o.marginLeft ?? base.marginLeft,
      marginRight: o.marginRight ?? base.marginRight,
      gapH: o.gapH ?? base.gapH,
      gapV: o.gapV ?? base.gapV,
      cornerRadius: o.cornerRadius ?? base.cornerRadius,
    }
  })

  const isCustom = computed(() => Object.keys(overrides.value).length > 0)

  function setPreset(id: string) {
    if (!PRESETS.some(p => p.id === id)) return
    presetId.value = id
    overrides.value = {}
  }

  function setOverride(key: OverridableField, value: number | null) {
    const next = { ...overrides.value }
    if (value == null || !Number.isFinite(value)) {
      delete next[key]
    } else {
      next[key] = value
    }
    overrides.value = next
  }

  function resetOverrides() {
    overrides.value = {}
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        presetId: presetId.value,
        overrides: overrides.value,
      } satisfies PersistedState))
    } catch { /* ignore quota / private mode */ }
  }

  watch([presetId, overrides], persist, { deep: true })

  return { presetId, overrides, preset, format, isCustom, setPreset, setOverride, resetOverrides }
})
