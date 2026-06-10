import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { emptyYearFile, makeId } from '@shared/defaults'
import { nextSeq } from '@shared/ledger'
import type { AppSettings, Booking, Category, YearFile } from '@shared/types'

interface Store {
  loading: boolean
  years: number[]
  file: YearFile | null
  settings: AppSettings
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  /** Jahr wechseln */
  selectYear(year: number): Promise<void>
  /** Neues Jahr anlegen (optional mit Anfangssaldo) */
  createYear(year: number, openingBalance: number, clubName: string, treasurerName: string): Promise<void>
  /** Jahr löschen (Datei wandert in den Backup-Ordner). Nicht für das letzte Jahr. */
  deleteYear(year: number): Promise<void>
  update(mutate: (file: YearFile) => YearFile): void
  addBooking(data: Omit<Booking, 'id' | 'seq'>): void
  addBookings(data: Omit<Booking, 'id' | 'seq'>[]): void
  updateBooking(id: string, data: Partial<Booking>): void
  deleteBooking(id: string): void
  addCategory(data: Omit<Category, 'id'>): void
  updateCategory(id: string, data: Partial<Category>): void
  deleteCategory(id: string): boolean
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [years, setYears] = useState<number[]>([])
  const [file, setFile] = useState<YearFile | null>(null)
  const [settings, setSettings] = useState<AppSettings>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    ;(async () => {
      const [list, loadedSettings] = await Promise.all([api.listYears(), api.loadSettings()])
      setYears(list)
      setSettings((loadedSettings as AppSettings) ?? {})
      if (list.length > 0) {
        const data = (await api.loadYear(list[0])) as YearFile | null
        if (data) setFile(data)
      }
      setLoading(false)
    })()
  }, [])

  const update = useCallback(
    (mutate: (f: YearFile) => YearFile) => {
      setFile((current) => {
        if (!current) return current
        const next = mutate(current)
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          void api.saveYear(next.year, next)
        }, 250)
        return next
      })
    },
    [],
  )

  const store: Store = useMemo(
    () => ({
      loading,
      years,
      file,
      settings,
      async updateSettings(patch) {
        const next = { ...settings, ...patch }
        setSettings(next)
        await api.saveSettings(next)
      },
      async selectYear(year) {
        const data = (await api.loadYear(year)) as YearFile | null
        if (data) setFile(data)
      },
      async createYear(year, openingBalance, clubName, treasurerName) {
        const existing = (await api.loadYear(year)) as YearFile | null
        const base = existing ?? {
          ...emptyYearFile(year),
          // Kategorien des aktuell geladenen Jahres übernehmen
          categories: file ? file.categories.map((c) => ({ ...c })) : emptyYearFile(year).categories,
        }
        const next: YearFile = { ...base, openingBalance, clubName, treasurerName }
        await api.saveYear(year, next)
        setYears((y) => [...new Set([year, ...y])].sort((a, b) => b - a))
        setFile(next)
      },
      async deleteYear(year) {
        const remaining = years.filter((y) => y !== year)
        if (remaining.length === 0) return
        if (file?.year === year && saveTimer.current) {
          // Ausstehende Speicherung verwerfen, sonst wird das Jahr gleich neu angelegt
          clearTimeout(saveTimer.current)
          saveTimer.current = null
        }
        await api.deleteYear(year)
        setYears(remaining)
        if (file?.year === year) {
          const data = (await api.loadYear(remaining[0])) as YearFile | null
          if (data) setFile(data)
        }
      },
      update,
      addBooking(data) {
        update((f) => ({
          ...f,
          bookings: [...f.bookings, { ...data, id: makeId(), seq: nextSeq(f) }],
        }))
      },
      addBookings(rows) {
        update((f) => {
          let seq = nextSeq(f)
          const added = rows.map((r) => ({ ...r, id: makeId(), seq: seq++ }))
          return { ...f, bookings: [...f.bookings, ...added] }
        })
      },
      updateBooking(id, data) {
        update((f) => ({
          ...f,
          bookings: f.bookings.map((b) => (b.id === id ? { ...b, ...data } : b)),
        }))
      },
      deleteBooking(id) {
        update((f) => ({ ...f, bookings: f.bookings.filter((b) => b.id !== id) }))
      },
      addCategory(data) {
        update((f) => ({ ...f, categories: [...f.categories, { ...data, id: makeId() }] }))
      },
      updateCategory(id, data) {
        update((f) => ({
          ...f,
          categories: f.categories.map((c) => (c.id === id ? { ...c, ...data } : c)),
        }))
      },
      deleteCategory(id) {
        if (!file) return false
        if (file.bookings.some((b) => b.categoryId === id)) return false
        update((f) => ({ ...f, categories: f.categories.filter((c) => c.id !== id) }))
        return true
      },
    }),
    [loading, years, file, settings, update],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore außerhalb des StoreProviders verwendet')
  return ctx
}
