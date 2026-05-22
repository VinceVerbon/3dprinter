// Label sheet format presets. The renderer + position picker derive every
// dimension from a LabelFormat — no hardcoded geometry lives outside this file.

export interface LabelFormat {
  id: string
  name: string
  /** Paper size in mm. A4 = 210 × 297. */
  paperW: number
  paperH: number
  /** Grid layout. */
  cols: number
  rows: number
  /** Label cell size in mm. */
  labelW: number
  labelH: number
  /** Margins in mm. marginBottom + marginRight are informational only —
   *  layout uses marginTop / marginLeft + gaps + cell sizes. */
  marginTop: number
  marginLeft: number
  marginBottom: number
  marginRight: number
  /** Gutters between columns / rows in mm. */
  gapH: number
  gapV: number
  /** Optional rounded corners on the visual cut-guide (screen only) in mm. */
  cornerRadius: number
}

export const PRESETS: LabelFormat[] = [
  {
    id: 'decadry-105x70-8up',
    name: 'Decadry 105×70 mm (8-up)',
    paperW: 210, paperH: 297, cols: 2, rows: 4,
    labelW: 105, labelH: 70,
    marginTop: 8.5, marginBottom: 8.5, marginLeft: 0, marginRight: 0,
    gapH: 0, gapV: 0, cornerRadius: 0,
  },
  {
    id: 'avery-6138-105x74-8up',
    name: 'Avery Zweckform 6138 (105×74 mm, borderless)',
    paperW: 210, paperH: 297, cols: 2, rows: 4,
    labelW: 105, labelH: 74,
    marginTop: 0.5, marginBottom: 0.5, marginLeft: 0, marginRight: 0,
    gapH: 0, gapV: 0, cornerRadius: 0,
  },
]

export const DEFAULT_PRESET_ID = 'decadry-105x70-8up'

export function getPreset(id: string): LabelFormat {
  return PRESETS.find(p => p.id === id) ?? PRESETS[0]
}

export function slotsPerSheet(fmt: LabelFormat): number {
  return fmt.cols * fmt.rows
}

/** Numeric fields that the user is allowed to override on top of a preset. */
export const OVERRIDABLE_FIELDS = [
  'paperW', 'paperH',
  'cols', 'rows',
  'labelW', 'labelH',
  'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'gapH', 'gapV',
  'cornerRadius',
] as const

export type OverridableField = typeof OVERRIDABLE_FIELDS[number]
