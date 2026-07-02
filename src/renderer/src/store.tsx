import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { emptyYearFile, makeId } from '@shared/defaults'
import { assignMissingRefNos, migrateExistingImportHashes, nextRefNo, nextSeq } from '@shared/ledger'
import type { AppSettings, Booking, Category, KontoId, YearFile } from '@shared/types'

/**
 * Die App führt zwei strikt getrennte Bücher: das Hauptkonto und ein
 * optionales Zweitkonto (eigene Dateien, eigene Kategorien, eigenes
 * Kassenjahr). Es gibt bewusst keine Stelle, an der die Summen
 * beider Konten verrechnet werden.
 */
interface Store {
  loading: boolean
  /** Aktives Buch */
  konto: KontoId
  /** Jahre des aktiven Buchs */
  years: number[]
  /** Gibt es bereits ein Zweitkonto? */
  zweitExists: boolean
  /** Anzeigename des Zweitkontos (z. B. "Karnevalskonto") */
  zweitName: string
  file: YearFile | null
  settings: AppSettings
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  /** Buch wechseln */
  selectKonto(konto: KontoId): Promise<void>
  /** Jahr im aktiven Buch wechseln */
  selectYear(year: number): Promise<void>
  /** Neues Jahr im aktiven Buch anlegen (Jahresabschluss / Erststart) */
  createYear(year: number, openingBalance: number, clubName: string, treasurerName: string): Promise<void>
  /** Zweitkonto mit erstem Kassenjahr anlegen */
  createZweitkonto(name: string, fiscalStartMonth: number, year: number, openingBalance: number): Promise<void>
  /** Jahr im aktiven Buch löschen (Datei wandert in den Backup-Ordner) */
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

async function loadMigratedYear(konto: KontoId, year: number): Promise<YearFile | null> {
  const data = (await api.loadYear(konto, year)) as YearFile | null
  if (!data) return null
  const hashes = migrateExistingImportHashes(data.bookings)
  const withHashes = { ...data, bookings: hashes.bookings }
  // Beleg-Nummern von Altdaten einmalig festschreiben – danach sind sie fix
  const refs = assignMissingRefNos(withHashes)
  if (hashes.migratedCount === 0 && refs.migratedCount === 0) return data
  const next = { ...withHashes, bookings: refs.bookings }
  await api.saveYear(konto, year, next)
  return next
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [konto, setKonto] = useState<KontoId>('haupt')
  const [yearsByKonto, setYearsByKonto] = useState<Record<KontoId, number[]>>({ haupt: [], zweit: [] })
  const [zweitName, setZweitName] = useState('Zweitkonto')
  const [file, setFile] = useState<YearFile | null>(null)
  const [settings, setSettings] = useState<AppSettings>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    ;(async () => {
      const [haupt, zweit, loadedSettings] = await Promise.all([
        api.listYears('haupt'),
        api.listYears('zweit'),
        api.loadSettings(),
      ])
      setYearsByKonto({ haupt, zweit })
      setSettings((loadedSettings as AppSettings) ?? {})
      const [hauptFiles, zweitFiles] = await Promise.all([
        Promise.all(haupt.map((year) => loadMigratedYear('haupt', year))),
        Promise.all(zweit.map((year) => loadMigratedYear('zweit', year))),
      ])
      const latestZweit = zweitFiles[0]
      if (latestZweit?.kontoName) setZweitName(latestZweit.kontoName)
      if (hauptFiles[0]) setFile(hauptFiles[0])
      setLoading(false)
    })()
  }, [])

  const update = useCallback((mutate: (f: YearFile) => YearFile) => {
    setFile((current) => {
      if (!current) return current
      const next = mutate(current)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void api.saveYear(next.konto ?? 'haupt', next.year, next)
      }, 250)
      return next
    })
  }, [])

  /** Ausstehende Speicherung sofort ausführen, bevor das aktive Buch wechselt. */
  const flushPendingSave = useCallback((current: YearFile | null) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
      if (current) void api.saveYear(current.konto ?? 'haupt', current.year, current)
    }
  }, [])

  const years = yearsByKonto[konto]

  const store: Store = useMemo(
    () => ({
      loading,
      konto,
      years,
      zweitExists: yearsByKonto.zweit.length > 0,
      zweitName,
      file,
      settings,
      async updateSettings(patch) {
        const next = { ...settings, ...patch }
        setSettings(next)
        await api.saveSettings(next)
      },
      async selectKonto(target) {
        if (target === konto) return
        flushPendingSave(file)
        setKonto(target)
        const list = yearsByKonto[target]
        if (list.length > 0) {
          const data = await loadMigratedYear(target, list[0])
          setFile(data ?? null)
        } else {
          setFile(null)
        }
      },
      async selectYear(year) {
        flushPendingSave(file)
        const data = await loadMigratedYear(konto, year)
        if (data) setFile(data)
      },
      async createYear(year, openingBalance, clubName, treasurerName) {
        const existing = await loadMigratedYear(konto, year)
        const base = existing ?? {
          ...emptyYearFile(year),
          // Kategorien und Konto-Eigenschaften des aktuellen Jahres übernehmen
          categories: file ? file.categories.map((c) => ({ ...c })) : emptyYearFile(year).categories,
          konto,
          kontoName: file?.kontoName,
          fiscalStartMonth: file?.fiscalStartMonth,
        }
        const next: YearFile = { ...base, openingBalance, clubName, treasurerName }
        await api.saveYear(konto, year, next)
        setYearsByKonto((y) => ({ ...y, [konto]: [...new Set([year, ...y[konto]])].sort((a, b) => b - a) }))
        setFile(next)
      },
      async createZweitkonto(name, fiscalStartMonth, year, openingBalance) {
        flushPendingSave(file)
        const next: YearFile = {
          ...emptyYearFile(year),
          konto: 'zweit',
          kontoName: name,
          fiscalStartMonth,
          openingBalance,
          clubName: file?.clubName ?? '',
          treasurerName: file?.treasurerName ?? '',
        }
        await api.saveYear('zweit', year, next)
        setYearsByKonto((y) => ({ ...y, zweit: [...new Set([year, ...y.zweit])].sort((a, b) => b - a) }))
        setZweitName(name)
        setKonto('zweit')
        setFile(next)
      },
      async deleteYear(year) {
        const remaining = years.filter((y) => y !== year)
        // Das letzte Jahr des Hauptkontos kann nicht gelöscht werden;
        // beim Zweitkonto verschwindet mit dem letzten Jahr das ganze Konto.
        if (konto === 'haupt' && remaining.length === 0) return
        if (file?.year === year && saveTimer.current) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
        }
        await api.deleteYear(konto, year)
        setYearsByKonto((y) => ({ ...y, [konto]: remaining }))
        if (konto === 'zweit' && remaining.length === 0) {
          setKonto('haupt')
          const data = await loadMigratedYear('haupt', yearsByKonto.haupt[0])
          setFile(data ?? null)
          return
        }
        if (file?.year === year) {
          const data = await loadMigratedYear(konto, remaining[0])
          if (data) setFile(data)
        }
      },
      update,
      addBooking(data) {
        update((f) => ({
          ...f,
          bookings: [
            ...f.bookings,
            // Beleg-Nummer wird hier einmalig fest vergeben (Maximum + 1)
            { ...data, id: makeId(), seq: nextSeq(f), refNo: nextRefNo(f, data.categoryId) },
          ],
        }))
      },
      addBookings(rows) {
        update((f) => {
          let seq = nextSeq(f)
          // Nummern-Zähler je Kategorie, damit ein Stapel fortlaufend nummeriert
          const counters = new Map<string, number>()
          const takeRefNo = (categoryId: string) => {
            const n = counters.get(categoryId) ?? nextRefNo(f, categoryId)
            counters.set(categoryId, n + 1)
            return n
          }
          const added = rows.map((r) => ({ ...r, id: makeId(), seq: seq++, refNo: takeRefNo(r.categoryId) }))
          return { ...f, bookings: [...f.bookings, ...added] }
        })
      },
      updateBooking(id, data) {
        update((f) => {
          const current = f.bookings.find((b) => b.id === id)
          // Kategoriewechsel: Buchung bekommt eine neue Nummer in der Ziel-Kategorie;
          // die alte Nummer bleibt dauerhaft unbenutzt.
          const patch =
            current && data.categoryId && data.categoryId !== current.categoryId
              ? { ...data, refNo: nextRefNo(f, data.categoryId) }
              : data
          return {
            ...f,
            bookings: f.bookings.map((b) => (b.id === id ? { ...b, ...patch } : b)),
          }
        })
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
    [loading, konto, years, yearsByKonto, zweitName, file, settings, update, flushPendingSave],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore außerhalb des StoreProviders verwendet')
  return ctx
}
