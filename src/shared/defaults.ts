import type { Category, YearFile } from './types'

export function makeId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  )
}

/** Kategorien aus dem bisherigen Kassenbericht als Startwerte. */
export const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Rechnungsabgrenzungsposten', code: 'R', sortOrder: 10, active: true },
  { name: 'Generalversammlung', code: 'GV', sortOrder: 20, active: true },
  { name: 'Beiträge', code: 'B', sortOrder: 30, active: true },
  { name: 'Sonstiges', code: 'S', sortOrder: 40, active: true },
]

export function emptyYearFile(year: number): YearFile {
  return {
    schemaVersion: 1,
    year,
    openingBalance: 0,
    clubName: '',
    treasurerName: '',
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, id: makeId() + c.code })),
    bookings: [],
  }
}
