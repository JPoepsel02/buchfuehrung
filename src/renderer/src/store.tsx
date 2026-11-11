import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { emptyYearFile, makeId } from '@shared/defaults'
import { assignMissingRefNos, checkedRefNo, migrateExistingImportHashes, nextRefNo, nextSeq } from '@shared/ledger'
import { clearImportSelection, migrateImportDraftHashes } from '@shared/importDraft'
import { reserveImportReceiptNumbers } from '@shared/importReceipts'
import { migrateReceiptStatuses } from '@shared/receipt'
import type { AppSettings, Booking, Category, KontoId, YearFile } from '@shared/types'
import { allOrganizationBookings, applyCategoryDefaultReferences, AREA_DEFINITIONS, bookingKey, categoryAllocations, createTransfer, makeAssignment, organizationDefaults, validateOrganizationConfig } from '@shared/organization'
import type { ActivityAllocation, ActivityAreaId, BookingReference, OrganizationConfig } from '@shared/organization'
import { importDraftWithAssignments } from '@shared/importAllocations'
import { isKontoId } from '@shared/types'
import { validateAccountNumbers } from '@shared/accountDetails'
import { PersistenceQueue } from './writeQueue'
import { assertNewYear, nextKontoIdentity, usedKontoSequence } from './accountLifecycle'
import type { Backup } from '@shared/backup'
import { buildRestoreSnapshot } from '@shared/restore'

export interface KontoInfo {
  id: KontoId
  /** Anzeigename, z. B. "Karnevalskonto" */
  name: string
}

interface Store {
  allFiles: YearFile[]
  organization: OrganizationConfig
  error: string
  clearError(): void
  flush(): Promise<void>
  updateOrganization(patch: Partial<OrganizationConfig>): Promise<void>
  setAllocations(reference: BookingReference, allocations: ActivityAllocation[]): Promise<void>
  linkTransfer(from: BookingReference, to: BookingReference): Promise<void>
  unlinkTransfer(id: string): Promise<void>
  setCategoryArea(konto: string, categoryId: string, area: ActivityAreaId | undefined): Promise<void>
  applyCategoryDefaults(references: BookingReference[]): Promise<void>
  importDraft(): Promise<void>
  restoreBackup(backup: Backup): Promise<void>
  restoring: boolean
  loading: boolean
  /** Aktives Buch */
  konto: KontoId
  /** Jahre des aktiven Buchs */
  years: number[]
  /** Alle vorhandenen Bücher (Hauptkonto zuerst) */
  kontos: KontoInfo[]
  /** Läuft gerade das Anlegen eines weiteren Kontos? */
  creatingKonto: boolean
  startKontoSetup(): void
  cancelKontoSetup(): void
  file: YearFile | null
  settings: AppSettings
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  /** Buch wechseln */
  selectKonto(konto: KontoId): Promise<void>
  /** Jahr im aktiven Buch wechseln */
  selectYear(year: number): Promise<void>
  /** Konto und Kassenjahr gemeinsam öffnen (z. B. aus der globalen Suche). */
  selectKontoYear(konto: KontoId, year: number): Promise<void>
  /** Neues Jahr im aktiven Buch anlegen (Jahresabschluss / Erststart) */
  createYear(year: number, openingBalance: number, clubName: string, treasurerName: string): Promise<void>
  /** Weiteres Konto mit erstem Kassenjahr anlegen */
  createKonto(name: string, fiscalStartMonth: number, year: number, openingBalance: number): Promise<void>
  /** Jahr im aktiven Buch löschen (Datei wandert in den Backup-Ordner) */
  deleteYear(year: number): Promise<void>
  update(mutate: (file: YearFile) => YearFile): void
  updateAccount(konto: KontoId, year: number, mutate: (file: YearFile) => YearFile, bankAccountId?: string): Promise<void>
  addBooking(data: Omit<Booking, 'id' | 'seq'>, allocations?: ActivityAllocation[]): void
  addBookings(data: Omit<Booking, 'id' | 'seq'>[], allocations?: Array<ActivityAllocation[] | undefined>): void
  updateBooking(id: string, data: Partial<Booking>, allocations?: ActivityAllocation[]): void
  deleteBooking(id: string): void
  addCategory(data: Omit<Category, 'id'>, area?: ActivityAreaId): Promise<void>
  updateCategory(id: string, data: Partial<Category>): void
  deleteCategory(id: string): boolean
}

const StoreContext = createContext<Store | null>(null)

async function loadMigratedYear(konto: KontoId, year: number): Promise<YearFile | null> {
  const data = (await api.loadYear(konto, year)) as YearFile | null
  if (!data) return null
  const receipts = migrateReceiptStatuses(data)
  const hashes = migrateExistingImportHashes(receipts.file.bookings)
  const withHashes = { ...receipts.file, bookings: hashes.bookings }
  const draftHashes = migrateImportDraftHashes(withHashes)
  // Beleg-Nummern von Altdaten einmalig festschreiben – danach sind sie fix
  const refs = assignMissingRefNos(draftHashes.file)
  const withRefs = { ...draftHashes.file, bookings: refs.bookings }
  const next = clearImportSelection(reserveImportReceiptNumbers(withRefs))
  if (
    receipts.migratedCount === 0 &&
    hashes.migratedCount === 0 &&
    draftHashes.migratedCount === 0 &&
    refs.migratedCount === 0 &&
    next === withRefs
  ) return { ...data, konto }
  const normalized = { ...next, konto }
  await api.saveYear(konto, year, normalized)
  return normalized
}

/** Standard-Anzeigename eines Buchs ohne gespeicherten Namen. */
function defaultKontoName(id: KontoId): string {
  if (id === 'haupt') return 'Hauptkonto'
  if (id === 'zweit') return 'Zweitkonto'
  return `Konto ${id.slice(1)}`
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const [konto, setKonto] = useState<KontoId>('haupt')
  const [kontoIds, setKontoIds] = useState<KontoId[]>(['haupt'])
  const [yearsByKonto, setYearsByKonto] = useState<Record<KontoId, number[]>>({ haupt: [] })
  const [kontoNames, setKontoNames] = useState<Record<KontoId, string>>({})
  const [creatingKonto, setCreatingKonto] = useState(false)
  const [file, setFile] = useState<YearFile | null>(null)
  const [settings, setSettings] = useState<AppSettings>({})
  const [allFiles, setAllFiles] = useState<YearFile[]>([])
  const [error, setError] = useState('')
  const filesRef = useRef<YearFile[]>([])
  const fileRef = useRef<YearFile | null>(null)
  const settingsRef = useRef<AppSettings>({})
  const writeQueue = useRef<PersistenceQueue | null>(null)
  writeQueue.current ??= new PersistenceQueue((problem) => setError(problem.message))
  const selectionVersion = useRef(0)
  const lifecycleBusy = useRef(false)
  const restoreBusy = useRef(false)
  const boot = useRef<Promise<{ ids: string[]; loaded: AppSettings; yearsEntries: readonly (readonly [string, number[]])[]; names: Record<string, string>; loadedFiles: YearFile[]; hauptFile: YearFile | null }> | null>(null)

  const remember = useCallback((next: YearFile) => {
    const same = (entry: YearFile) => (entry.konto ?? 'haupt') === (next.konto ?? 'haupt') && entry.year === next.year
    filesRef.current = filesRef.current.some(same) ? filesRef.current.map((entry) => same(entry) ? next : entry) : [...filesRef.current, next]
    setAllFiles(filesRef.current)
  }, [])
  const activateFile = useCallback((next: YearFile | null) => {
    fileRef.current = next
    setFile(next)
    if (next) remember(next)
  }, [remember])
  const enqueue = useCallback((write: () => Promise<void>) => {
    return writeQueue.current!.enqueue(write)
  }, [])
  const flush = useCallback(() => writeQueue.current!.flush(), [])
  const currentOrganization = useCallback(() => settingsRef.current.organization ?? organizationDefaults(filesRef.current), [])
  const withSequence = useCallback((next: AppSettings): AppSettings => {
    const sequence = Math.max(next.kontoSequence ?? 1, settingsRef.current.kontoSequence ?? 1)
    return sequence > (next.kontoSequence ?? 1) ? { ...next, kontoSequence: sequence } : next
  }, [])
  const changeLifecycle = useCallback(async (change: () => Promise<void>) => {
    if (restoreBusy.current) throw new Error('Die Sicherung wird noch wiederhergestellt.')
    if (lifecycleBusy.current) throw new Error('Eine Änderung an Konten oder Kassenjahren wird noch gespeichert.')
    lifecycleBusy.current = true
    try { await flush(); await change() }
    finally { lifecycleBusy.current = false }
  }, [flush])
  const saveSettingsPatch = useCallback(async (patch: Partial<AppSettings>) => {
    if (restoreBusy.current) throw new Error('Die Sicherung wird noch wiederhergestellt.')
    const next = { ...settingsRef.current, ...patch }
    if (next.accountNumbers !== undefined) {
      const errors = validateAccountNumbers(next.accountNumbers)
      if (errors.length) throw new Error(errors[0])
    }
    if (next.organization) {
      const errors = validateOrganizationConfig(next.organization)
      if (errors.length) throw new Error(errors[0])
    }
    settingsRef.current = next
    setSettings(next)
    await enqueue(() => api.saveSettings(withSequence(next)))
  }, [enqueue, withSequence])
  const updateOrganization = useCallback(async (patch: Partial<OrganizationConfig>) => {
    await saveSettingsPatch({ organization: { ...currentOrganization(), ...patch } })
  }, [saveSettingsPatch, currentOrganization])
  const setAllocations = useCallback(async (reference: BookingReference, allocations: ActivityAllocation[]) => {
    const organization = currentOrganization()
    const entry = allOrganizationBookings(filesRef.current, organization).find((item) => item.key === bookingKey(reference))
    if (!entry) throw new Error('Die Buchung ist nicht mehr vorhanden.')
    if (entry.transferId && allocations.length) throw new Error('Interne Umbuchungen erhalten keinen Tätigkeitsbereich.')
    const assignments = { ...organization.assignments }
    if (allocations.length) assignments[entry.key] = makeAssignment(entry.booking, allocations)
    else delete assignments[entry.key]
    await updateOrganization({ assignments })
  }, [currentOrganization, updateOrganization])


  useEffect(() => {
    let active = true
    boot.current ??= (async () => {
      const [ids, loadedSettings] = await Promise.all([api.listKontos(), api.loadSettings()])
      const loaded = (loadedSettings as AppSettings) ?? {}
      if (loaded.organization) {
        const errors = validateOrganizationConfig(loaded.organization)
        if (errors.length) throw new Error(errors[0])
      }
      const yearsEntries = await Promise.all(ids.map(async (id) => [id, await api.listYears(id)] as const))
      const names: Record<string, string> = {}
      let hauptFile: YearFile | null = null
      const loadedFiles: YearFile[] = []
      for (const [id, years] of yearsEntries) {
        const files = await Promise.all(years.map((year) => loadMigratedYear(id, year)))
        loadedFiles.push(...files.filter((entry): entry is YearFile => Boolean(entry)).map((entry) => ({ ...entry, konto: id })))
        const latest = files[0]
        if (latest?.kontoName) names[id] = latest.kontoName
        if (id === 'haupt') hauptFile = latest ?? null
      }
      return { ids, loaded, yearsEntries, names, loadedFiles, hauptFile }
    })()
    void boot.current.then((data) => {
      if (!active) return
      settingsRef.current = data.loaded
      filesRef.current = data.loadedFiles
      setSettings(data.loaded)
      setAllFiles(data.loadedFiles)
      setYearsByKonto(Object.fromEntries(data.yearsEntries))
      setKontoNames(data.names)
      setKontoIds(data.ids)
      if (data.hauptFile) activateFile(data.hauptFile)
      setLoading(false)
    }).catch((failure: unknown) => {
      if (!active) return
      setError(failure instanceof Error ? failure.message : 'Bücher konnten nicht geladen werden.')
      setLoading(false)
    })
    return () => { active = false }
  }, [activateFile])

  const update = useCallback((mutate: (f: YearFile) => YearFile) => {
    if (restoreBusy.current) return
    const current = fileRef.current
    if (!current) return
    const next = reserveImportReceiptNumbers(mutate(reserveImportReceiptNumbers(current)))
    if (next === current) return
    activateFile(next)
    if (next.kontoName !== current.kontoName) {
      const id = next.konto ?? 'haupt'
      setKontoNames((names) => ({ ...names, [id]: next.kontoName?.trim() || defaultKontoName(id) }))
    }
    void enqueue(() => api.saveYear(next.konto ?? 'haupt', next.year, next)).catch(() => { /* Fehler wird zentral angezeigt. */ })
  }, [activateFile, enqueue])

  const commitSnapshot = useCallback(async (next: YearFile, organization?: OrganizationConfig) => {
    if (restoreBusy.current) throw new Error('Die Sicherung wird noch wiederhergestellt.')
    const normalized = reserveImportReceiptNumbers(next)
    const nextSettings = organization ? { ...settingsRef.current, organization } : undefined
    if (organization) {
      const errors = validateOrganizationConfig(organization)
      if (errors.length) throw new Error(errors[0])
    }
    const current = fileRef.current
    activateFile(normalized)
    if (normalized.kontoName !== current?.kontoName) {
      const id = normalized.konto ?? 'haupt'
      setKontoNames((names) => ({ ...names, [id]: normalized.kontoName?.trim() || defaultKontoName(id) }))
    }
    if (nextSettings) {
      settingsRef.current = nextSettings
      setSettings(nextSettings)
    }
    await enqueue(() => api.commitSnapshot({ settings: nextSettings ? withSequence(nextSettings) : undefined,
      years: [{ konto: normalized.konto ?? 'haupt', year: normalized.year, data: normalized }] }))
  }, [activateFile, enqueue, withSequence])
  const showFailure = useCallback((failure: unknown) => {
    setError(failure instanceof Error ? failure.message : 'Speichern fehlgeschlagen.')
  }, [])

  const flushPendingSave = useCallback(async (_current: YearFile | null) => { await flush() }, [flush])

  const updateAccount = useCallback(async (target: KontoId, year: number, mutate: (file: YearFile) => YearFile, bankAccountId?: string) => {
    await enqueue(async () => {
      if (bankAccountId !== undefined && !settingsRef.current.bankAccounts?.some((account) => account.id === bankAccountId && (account.konto ?? 'haupt') === target)) return
      const current = filesRef.current.find((entry) => (entry.konto ?? 'haupt') === target && entry.year === year)
      if (!current) return
      const next = reserveImportReceiptNumbers(mutate(current))
      if (next === current) return
      if ((next.konto ?? 'haupt') !== target || next.year !== year) throw new Error('Konto oder Kassenjahr dürfen beim Bankabruf nicht geändert werden.')
      if ((fileRef.current?.konto ?? 'haupt') === target && fileRef.current?.year === year) activateFile(next)
      else remember(next)
      await api.commitSnapshot({ years: [{ konto: target, year, data: next }] })
    })
  }, [activateFile, remember, enqueue])

  const restoreBackup = useCallback(async (backup: Backup) => {
    if (restoreBusy.current || lifecycleBusy.current) throw new Error('Eine Änderung wird noch gespeichert.')
    restoreBusy.current = true
    setRestoring(true)
    const restore = async () => {
      const snapshot = buildRestoreSnapshot(backup, settingsRef.current, filesRef.current)
      const replaced = new Set(snapshot.years.map((entry) => JSON.stringify([entry.konto, entry.year])))
      const merged = [
        ...filesRef.current.filter((entry) => !replaced.has(JSON.stringify([entry.konto ?? 'haupt', entry.year]))),
        ...snapshot.years.map((entry) => ({ ...entry.data, konto: entry.konto })),
      ]
      await api.commitSnapshot(snapshot)
      const selected = fileRef.current
      const active = merged.find((entry) => (entry.konto ?? 'haupt') === (selected?.konto ?? 'haupt') && entry.year === selected?.year)
        ?? merged.filter((entry) => (entry.konto ?? 'haupt') === 'haupt').sort((left, right) => right.year - left.year)[0]
        ?? merged[0] ?? null
      const identifiers = [...new Set(merged.map((entry) => entry.konto ?? 'haupt'))]
      const number = (id: KontoId) => id === 'zweit' ? 2 : Number(id.slice(1))
      const ids = ['haupt', ...identifiers.filter((id) => id !== 'haupt').sort((left, right) => number(left) - number(right))]
      const yearLists = Object.fromEntries(ids.map((id) => [id, merged.filter((entry) => (entry.konto ?? 'haupt') === id).map((entry) => entry.year).sort((left, right) => right - left)]))
      const names = Object.fromEntries(ids.map((id) => [id, merged.filter((entry) => (entry.konto ?? 'haupt') === id)
        .sort((left, right) => right.year - left.year)[0]?.kontoName?.trim() || defaultKontoName(id)]))
      settingsRef.current = snapshot.settings ?? settingsRef.current
      filesRef.current = merged
      fileRef.current = active
      selectionVersion.current++
      setSettings(settingsRef.current)
      setAllFiles(merged)
      setFile(active)
      setKonto(active?.konto ?? 'haupt')
      setKontoIds(ids)
      setKontoNames(names)
      setYearsByKonto(yearLists)
      setCreatingKonto(false)
    }
    try { await enqueue(restore) }
    finally {
      restoreBusy.current = false
      setRestoring(false)
    }
  }, [enqueue])

  const cachedYear = useCallback((target: KontoId, year: number): YearFile => {
    const current = filesRef.current.find((entry) => (entry.konto ?? 'haupt') === target && entry.year === year)
    if (!current) throw new Error('Das Kassenjahr ist nicht mehr vorhanden. Bitte die App erneut öffnen.')
    return current
  }, [])
  const latestCachedYear = useCallback((target: KontoId): YearFile | null => {
    return filesRef.current.filter((entry) => (entry.konto ?? 'haupt') === target)
      .sort((a, b) => b.year - a.year)[0] ?? null
  }, [])

  const years = yearsByKonto[konto] ?? []

  const store: Store = useMemo(
    () => ({
      loading,
      restoring,
      allFiles,
      organization: settings.organization ?? organizationDefaults(allFiles),
      error,
      clearError() {
        if (restoreBusy.current) return
        const files = [...filesRef.current], latestSettings = settingsRef.current
        void writeQueue.current!.retry(() => api.commitSnapshot({ settings: latestSettings,
          years: files.map((snapshot) => ({ konto: snapshot.konto ?? 'haupt', year: snapshot.year, data: snapshot })) }))
          .then(() => setError('')).catch(() => { /* Fehler wird zentral angezeigt. */ })
      },
      flush,
      updateOrganization,
      setAllocations,
      async linkTransfer(from, to) {
        const current = currentOrganization()
        const transfer = createTransfer(filesRef.current, from, to)
        const used = new Set(current.transfers.flatMap((entry) => [bookingKey(entry.from), bookingKey(entry.to)]))
        if (used.has(bookingKey(transfer.from)) || used.has(bookingKey(transfer.to))) throw new Error('Eine Buchung ist bereits verknüpft.')
        const assignments = { ...current.assignments }
        delete assignments[bookingKey(transfer.from)]
        delete assignments[bookingKey(transfer.to)]
        await updateOrganization({ assignments, transfers: [...current.transfers, transfer] })
      },
      async unlinkTransfer(id) { await updateOrganization({ transfers: currentOrganization().transfers.filter((entry) => entry.id !== id) }) },
      async setCategoryArea(target, categoryId, area) {
        if (!isKontoId(target) || (area !== undefined && !filesRef.current.some((entry) => (entry.konto ?? 'haupt') === target && entry.categories.some((category) => category.id === categoryId)))) {
          throw new Error('Die Kategorie ist nicht mehr vorhanden.')
        }
        if (area !== undefined && !AREA_DEFINITIONS.some((entry) => entry.id === area)) throw new Error('Unbekannter Tätigkeitsbereich.')
        const current = currentOrganization()
        const existing = current.rules.find((entry) => entry.konto === target && entry.categoryId === categoryId)
        const rules = current.rules.filter((entry) => entry.konto !== target || entry.categoryId !== categoryId)
        await updateOrganization({ rules: area ? [...rules, { id: existing?.id ?? makeId(), konto: target, categoryId, area }] : rules })
      },
      async applyCategoryDefaults(references) {
        const current = currentOrganization()
        const next = applyCategoryDefaultReferences(filesRef.current, current, references)
        if (next !== current) await updateOrganization({ assignments: next.assignments })
      },
      async importDraft() {
        const active = fileRef.current
        if (!active) throw new Error('Kein Kassenjahr geöffnet.')
        const current = currentOrganization()
        const result = importDraftWithAssignments(active, current)
        if (!result.importedCount) throw new Error('Keine gültigen Buchungen ausgewählt. Bitte Kategorien, Beträge und Zuordnungen prüfen.')
        await commitSnapshot(result.file, result.organization === current ? undefined : result.organization)
      },
      konto,
      years,
      kontos: kontoIds.map((id) => ({
        id,
        // Der Name des aktiven Buchs kommt live aus der geladenen Datei,
        // damit Umbenennungen sofort in der Seitenleiste erscheinen.
        name:
          (id === konto && file && (file.konto ?? 'haupt') === konto ? file.kontoName : undefined) ??
          kontoNames[id] ??
          defaultKontoName(id),
      })),
      creatingKonto,
      startKontoSetup() {
        setCreatingKonto(true)
      },
      cancelKontoSetup() {
        setCreatingKonto(false)
      },
      file,
      settings,
      updateAccount,
      restoreBackup,
      async updateSettings(patch) { await saveSettingsPatch(patch) },
      async selectKonto(target) {
        const version = ++selectionVersion.current
        if (target === konto) return
        await flushPendingSave(file)
        if (version !== selectionVersion.current) return
        const data = latestCachedYear(target)
        if (!data && (yearsByKonto[target] ?? []).length) throw new Error('Das Kassenjahr ist nicht mehr vorhanden. Bitte die App erneut öffnen.')
        setKonto(target)
        activateFile(data)
      },
      async selectYear(year) {
        const version = ++selectionVersion.current
        await flushPendingSave(file)
        if (version !== selectionVersion.current) return
        activateFile(cachedYear(konto, year))
      },
      async selectKontoYear(target, year) {
        const version = ++selectionVersion.current
        if (target === konto && file?.year === year) return
        await flushPendingSave(file)
        if (version !== selectionVersion.current) return
        const data = cachedYear(target, year)
        setKonto(target)
        activateFile(data)
      },
      async createYear(year, openingBalance, clubName, treasurerName) {
        const target = konto, version = selectionVersion.current
        await changeLifecycle(async () => {
          assertNewYear(filesRef.current, target, year)
          if (!Number.isSafeInteger(openingBalance)) throw new Error('Der Anfangssaldo ist ungültig.')
          const current = filesRef.current.find((entry) => (entry.konto ?? 'haupt') === target && entry.year === file?.year)
          const common = currentOrganization()
          const next: YearFile = { ...emptyYearFile(year), konto: target,
            categories: current ? current.categories.map((category) => ({ ...category })) : emptyYearFile(year).categories,
            kontoName: current?.kontoName, fiscalStartMonth: current?.fiscalStartMonth, openingBalance,
            clubName: common.name || clubName, treasurerName: common.treasurerName || treasurerName }
          await enqueue(async () => {
            await api.saveYear(target, year, next)
            remember(next)
            setYearsByKonto((previous) => ({ ...previous, [target]: [...new Set([year, ...(previous[target] ?? [])])].sort((a, b) => b - a) }))
            if (selectionVersion.current === version) { setKonto(target); activateFile(next) }
          })
        })
      },
      async createKonto(name, fiscalStartMonth, year, openingBalance) {
        if (!name.trim()) throw new Error('Bitte einen Konto-Namen angeben.')
        if (!Number.isInteger(fiscalStartMonth) || fiscalStartMonth < 1 || fiscalStartMonth > 12) throw new Error('Der Beginn des Kassenjahres ist ungültig.')
        assertNewYear([], 'haupt', year)
        if (!Number.isSafeInteger(openingBalance)) throw new Error('Der Anfangssaldo ist ungültig.')
        await changeLifecycle(async () => {
          const { id, sequence } = nextKontoIdentity(filesRef.current.map((entry) => entry.konto ?? 'haupt'), settingsRef.current)
          await enqueue(async () => {
            const nextSettings = { ...settingsRef.current, kontoSequence: sequence }
            const next: YearFile = { ...emptyYearFile(year), konto: id, kontoName: name.trim(), fiscalStartMonth, openingBalance,
              clubName: currentOrganization().name, treasurerName: currentOrganization().treasurerName }
            await api.commitSnapshot({ settings: nextSettings, years: [{ konto: id, year, data: next }] })
            settingsRef.current = { ...settingsRef.current, kontoSequence: sequence }
            setSettings(settingsRef.current)
            setKontoIds((ids) => ids.includes(id) ? ids : [...ids, id])
            setYearsByKonto((previous) => ({ ...previous, [id]: [year] }))
            setKontoNames((names) => ({ ...names, [id]: name.trim() }))
            setCreatingKonto(false)
            setKonto(id)
            activateFile(next)
          })
        })
      },
      async deleteYear(year) {
        const target = konto, version = selectionVersion.current
        await changeLifecycle(async () => {
          const present = filesRef.current.filter((entry) => (entry.konto ?? 'haupt') === target)
          if (!present.some((entry) => entry.year === year)) return
          const remaining = present.filter((entry) => entry.year !== year).map((entry) => entry.year).sort((a, b) => b - a)
          if (target === 'haupt' && remaining.length === 0) return
          await enqueue(async () => {
            const sequence = usedKontoSequence(filesRef.current.map((entry) => entry.konto ?? 'haupt'), settingsRef.current)
            if ((settingsRef.current.kontoSequence ?? 1) < sequence) {
              await api.saveSettings({ ...settingsRef.current, kontoSequence: sequence })
              settingsRef.current = { ...settingsRef.current, kontoSequence: sequence }
              setSettings(settingsRef.current)
            }
            await api.deleteYear(target, year)
            filesRef.current = filesRef.current.filter((entry) => (entry.konto ?? 'haupt') !== target || entry.year !== year)
            setAllFiles(filesRef.current)
            setYearsByKonto((previous) => ({ ...previous, [target]: remaining }))
            if (target !== 'haupt' && remaining.length === 0) {
              setKontoIds((ids) => ids.filter((id) => id !== target))
              if ((fileRef.current?.konto ?? 'haupt') === target) { setKonto('haupt'); activateFile(latestCachedYear('haupt')) }
            } else if (selectionVersion.current === version && fileRef.current?.year === year && (fileRef.current.konto ?? 'haupt') === target) {
              activateFile(cachedYear(target, remaining[0]))
            }
          })
        })
      },
      update,
      addBooking(data, allocations) {
        const active = fileRef.current
        if (!active) return
        const current = currentOrganization()
        const booking = { ...data, id: makeId(), seq: nextSeq(active), refNo: nextRefNo(active, data.categoryId) }
        const selected = allocations ?? categoryAllocations(current, active.konto ?? 'haupt', booking.categoryId, booking.amount)
        const organization = selected.length ? { ...current, assignments: { ...current.assignments,
          [bookingKey({ konto: active.konto ?? 'haupt', year: active.year, bookingId: booking.id })]: makeAssignment(booking, selected),
        } } : undefined
        void commitSnapshot({ ...active, bookings: [...active.bookings, booking] }, organization).catch(showFailure)
      },
      addBookings(rows, allocations) {
        const active = fileRef.current
        if (!active || !rows.length) return
        const current = currentOrganization()
        let seq = nextSeq(active)
        const counters = new Map<string, number>()
        const takeRefNo = (categoryId: string) => {
          const number = checkedRefNo(counters.get(categoryId) ?? nextRefNo(active, categoryId))
          counters.set(categoryId, number + 1)
          return number
        }
        const added = rows.map((row) => ({ ...row, id: makeId(), seq: seq++, refNo: takeRefNo(row.categoryId) }))
        const assignments = Object.fromEntries(added.flatMap((booking, index) => {
          const selected = allocations?.[index] ?? categoryAllocations(current, active.konto ?? 'haupt', booking.categoryId, booking.amount)
          return selected.length ? [[bookingKey({ konto: active.konto ?? 'haupt', year: active.year, bookingId: booking.id }), makeAssignment(booking, selected)]] : []
        }))
        const organization = Object.keys(assignments).length ? { ...current, assignments: { ...current.assignments, ...assignments } } : undefined
        void commitSnapshot({ ...active, bookings: [...active.bookings, ...added] }, organization).catch(showFailure)
      },
      updateBooking(id, data, allocations) {
        const active = fileRef.current
        const original = active?.bookings.find((entry) => entry.id === id)
        if (!active || !original) return
        const current = currentOrganization()
        const reference = { konto: active.konto ?? 'haupt', year: active.year, bookingId: id }
        const key = bookingKey(reference)
        const originalEntry = allOrganizationBookings(filesRef.current, current).find((entry) => entry.key === key)
        if (originalEntry?.transferId && allocations?.length) throw new Error('Interne Umbuchungen erhalten keinen Tätigkeitsbereich.')
        const booking = { ...original, ...data,
          ...(data.categoryId && data.categoryId !== original.categoryId ? { refNo: nextRefNo(active, data.categoryId) } : {}),
        }
        let organization: OrganizationConfig | undefined
        if (allocations !== undefined) {
          const assignments = { ...current.assignments }
          if (allocations.length) assignments[key] = makeAssignment(booking, allocations)
          else delete assignments[key]
          organization = { ...current, assignments }
        }
        void commitSnapshot({ ...active, bookings: active.bookings.map((entry) => entry.id === id ? booking : entry) }, organization).catch(showFailure)
      },
      deleteBooking(id) {
        update((f) => ({ ...f, bookings: f.bookings.filter((b) => b.id !== id) }))
      },
      async addCategory(data, area) {
        const active = fileRef.current
        if (!active) throw new Error('Kein Kassenjahr geöffnet.')
        if (area !== undefined && !AREA_DEFINITIONS.some((entry) => entry.id === area)) throw new Error('Unbekannter Tätigkeitsbereich.')
        const category = { ...data, id: makeId() }
        const current = currentOrganization()
        const organization = area ? { ...current, rules: [...current.rules, { id: makeId(), konto: active.konto ?? 'haupt', categoryId: category.id, area }] } : undefined
        await commitSnapshot({ ...active, categories: [...active.categories, category] }, organization)
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
    [loading, restoring, konto, years, yearsByKonto, kontoIds, kontoNames, creatingKonto, file, settings, update, updateAccount, restoreBackup, cachedYear, latestCachedYear, flushPendingSave, allFiles, error, flush, updateOrganization, setAllocations, currentOrganization, saveSettingsPatch, activateFile, remember, enqueue, commitSnapshot, showFailure, changeLifecycle, withSequence],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore außerhalb des StoreProviders verwendet')
  return ctx
}
