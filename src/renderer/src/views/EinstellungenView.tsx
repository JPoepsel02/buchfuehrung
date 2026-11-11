import { useEffect, useRef, useState } from 'react'
import { api, isElectron } from '../api'
import type { CloudSyncStatus, UpdateInfo } from '../api'
import { AmountField } from '../components/AmountInput'
import { LogoMark } from '../components/LogoMark'
import { YearEndDialog } from '../components/YearEndDialog'
import { useStore } from '../store'
import { assertNewYear } from '../accountLifecycle'
import { praesentationsModus } from '../presentation'
import { fiscalLabel } from '@shared/fiscal'
import { accountNumberFor } from '@shared/accountDetails'
import { buildBackup, validateBackup } from '@shared/backup'
import { yearTotals } from '@shared/ledger'
import { MONTH_NAMES, parseAmountToCents } from '@shared/money'
import { AREA_DEFINITIONS, suggestedArea } from '@shared/organization'
import type { ActivityAreaId } from '@shared/organization'
import type { Category, YearFile } from '@shared/types'

const LOGO_MAX_PX = 512

/** Liest ein Bild ein und verkleinert es auf maximal 512 px Kantenlänge (PNG-Data-URL). */
function readLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Das ist kein lesbares Bild (PNG oder JPEG verwenden).'))
      img.onload = () => {
        const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export function EinstellungenView({ focusYearEnd = false, yearEndDue = false }: { focusYearEnd?: boolean; yearEndDue?: boolean }) {
  const {
    file,
    allFiles,
    error,
    clearError,
    years,
    konto,
    settings,
    organization,
    updateSettings,
    update,
    createYear,
    deleteYear,
    selectYear,
    addCategory,
    setCategoryArea,
    updateCategory,
    deleteCategory,
  } = useStore()
  const [toast, setToast] = useState('')
  const [yearEndScope, setYearEndScope] = useState<string | null>(null)
  const scope = file ? `${konto}:${file.year}` : null
  const yearEndButton = useRef<HTMLButtonElement>(null)
  useEffect(() => setYearEndScope(null), [scope])
  useEffect(() => {
    if (focusYearEnd) yearEndButton.current?.focus()
  }, [focusYearEnd])
  const [newCat, setNewCat] = useState({ name: '', code: '', area: '' as '' | ActivityAreaId })
  const [addingCategory, setAddingCategory] = useState(false)
  const [balanceInput, setBalanceInput] = useState(() =>
    file ? (file.openingBalance / 100).toFixed(2).replace('.', ',') : '0,00',
  )
  const savedAccountNumber = accountNumberFor(konto, settings)
  const [accountNumberInput, setAccountNumberInput] = useState(savedAccountNumber)
  useEffect(() => setAccountNumberInput(savedAccountNumber), [konto, savedAccountNumber])

  // Anfangssaldo-Feld nachziehen, wenn Jahr oder Konto wechseln
  useEffect(() => {
    if (file) setBalanceInput((file.openingBalance / 100).toFixed(2).replace('.', ','))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.konto, file?.year])

  if (!file) return null
  const jahrWort = 'Kassenjahr'
  const totals = yearTotals(file)
  const cats = [...file.categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const nextYear = file.year + 1
  const nextYearLabel = fiscalLabel({ year: nextYear, fiscalStartMonth: file.fiscalStartMonth })

  function notify(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  function saveBalance() {
    const cents = parseAmountToCents(balanceInput)
    if (cents === null) return notify('Ungültiger Betrag.')
    update((f) => ({ ...f, openingBalance: cents }))
    notify('Anfangssaldo gespeichert.')
  }

  async function saveAccountNumber() {
    const number = accountNumberInput.trim()
    if (number === savedAccountNumber) return
    const accountNumbers = { ...settings.accountNumbers, [konto]: number }
    setAccountNumberInput(accountNumberFor(konto, { ...settings, accountNumbers }))
    await updateSettings({ accountNumbers })
  }

  async function addNewCategory() {
    if (addingCategory) return
    const name = newCat.name.trim()
    const code = newCat.code.trim().toUpperCase()
    if (!name || !code) return notify('Name und Kürzel angeben.')
    if (!newCat.area) return notify('Tätigkeitsbereich wählen.')
    if (file!.categories.some((c) => c.code === code)) return notify(`Kürzel „${code}“ ist bereits vergeben.`)
    const maxSort = Math.max(0, ...file!.categories.map((c) => c.sortOrder))
    setAddingCategory(true)
    try {
      await addCategory({ name, code, sortOrder: maxSort + 10, active: true }, newCat.area)
      setNewCat({ name: '', code: '', area: '' })
      notify('Kategorie angelegt.')
    } finally { setAddingCategory(false) }
  }

  function move(id: string, dir: -1 | 1) {
    const idx = cats.findIndex((c) => c.id === id)
    const other = cats[idx + dir]
    if (!other) return
    const current = cats[idx]
    updateCategory(current.id, { sortOrder: other.sortOrder })
    updateCategory(other.id, { sortOrder: current.sortOrder })
  }

  function run(task: () => Promise<unknown>) {
    void task().catch((error) => notify(error instanceof Error ? error.message : String(error)))
  }

  async function removeYear(year: number) {
    const label = fiscalLabel({ year, fiscalStartMonth: file!.fiscalStartMonth })
    if (
      !confirm(
        `${jahrWort} ${label} wirklich löschen?\n\nEine Sicherungskopie wird im Backup-Ordner abgelegt.`,
      )
    )
      return
    await deleteYear(year)
    notify(`${jahrWort} ${label} gelöscht.`)
  }

  function openYearEnd() {
    try {
      assertNewYear(allFiles, konto, nextYear)
      setYearEndScope(scope)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  async function startNextYear(categoryIds: readonly string[]) {
    if (error) clearError()
    await createYear(nextYear, totals.closingBalance, file!.clubName, file!.treasurerName, categoryIds)
    setYearEndScope(null)
    notify(`${jahrWort} ${nextYearLabel} angelegt.`)
  }

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Kontoeinstellungen</h1>
        </div>
      </header>

      <section className="card">
        <h2 className="card__title">
          {konto !== 'haupt' ? `${file.kontoName ?? 'Konto'} · ` : ''}
          {jahrWort} {fiscalLabel(file)}
        </h2>
        <div className="account-settings-fields">
          <div className="field">
            <label htmlFor="s-balance">Anfangssaldo (€)</label>
            <AmountField id="s-balance" value={balanceInput} onChange={setBalanceInput} onBlur={saveBalance} allowNegative />
          </div>
          <div className="field">
            <label htmlFor="s-kontoname">Konto-Name</label>
            <input
              id="s-kontoname"
              value={file.kontoName ?? ''}
              onChange={(e) => update((f) => ({ ...f, kontoName: e.target.value }))}
              placeholder="z. B. Karnevalskonto"
            />
          </div>
          <div className="field">
            <label htmlFor="s-account-number">IBAN / Kontonummer</label>
            <input id="s-account-number" value={accountNumberInput} maxLength={80} autoComplete="off" spellCheck={false}
              onChange={(event) => setAccountNumberInput(event.target.value)} onBlur={() => run(saveAccountNumber)} />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__heading account-years__heading">
          <div>
            <h2 className="card__title">{jahrWort}e{konto !== 'haupt' ? ` · ${file.kontoName ?? 'Konto'}` : ''}</h2>
            {yearEndDue && <p className="account-years__due">Jahresabschluss fällig</p>}
          </div>
          <button ref={yearEndButton} type="button" className={`btn${yearEndDue ? ' btn--primary' : ''}`} onClick={openYearEnd}>
            Jahresabschluss → {nextYearLabel}
          </button>
        </div>
        <table className="ledger">
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td style={{ fontWeight: 600 }}>
                  {fiscalLabel({ year: y, fiscalStartMonth: file.fiscalStartMonth })}
                  {y === file.year && <span className="pill pill--in" style={{ marginLeft: 8 }}>geöffnet</span>}
                </td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {y !== file.year && (
                    <button className="btn btn--ghost btn--sm" onClick={() => run(() => selectYear(y))}>
                      Öffnen
                    </button>
                  )}
                  <button
                    className="btn btn--ghost btn--sm btn--danger"
                    disabled={konto === 'haupt' && years.length < 2}
                    onClick={() => run(() => removeYear(y))}
                  >
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(file.isFirstFiscalYear || years.every((year) => year >= file.year)) && (
          <label className="checkrow">
            <input type="checkbox" checked={file.isFirstFiscalYear === true}
              onChange={(event) => {
                const checked = event.target.checked
                update((current) => ({ ...current, isFirstFiscalYear: checked || undefined }))
              }} />
            Erstes Kassenjahr des Kontos
          </label>
        )}
        <p className="hint">Gelöschte Kassenjahre bleiben im Backup-Ordner erhalten.</p>
      </section>

      <section className="card">
        <h2 className="card__title">Veranstaltungen / Kategorien</h2>
        <div className="table-scroll">
          <table className="ledger category-table" aria-label="Veranstaltungen und Kategorien" style={{ minWidth: 1040 }}>
            <colgroup>
              <col />
              <col className="category-table__code" />
              <col className="category-table__active" />
              <col className="category-table__area" style={{ width: 210 }} />
              <col className="category-table__presentation" style={{ width: '32%' }} />
              <col className="category-table__order" />
              <col className="category-table__actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kürzel</th>
                <th className="category-table__active">Aktiv</th>
                <th>Tätigkeitsbereich</th>
                <th>Präsentation</th>
                <th>Reihenfolge</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <input
                      value={c.name}
                      title={c.name}
                      onChange={(e) => updateCategory(c.id, { name: e.target.value })}
                      style={{ border: 'none', background: 'transparent', width: '100%', font: 'inherit' }}
                      aria-label="Kategoriename"
                    />
                  </td>
                  <td className="ref">{c.code}</td>
                  <td className="category-table__active">
                    <label className="category-active-toggle">
                      <input
                        type="checkbox"
                        checked={c.active}
                        onChange={(e) => updateCategory(c.id, { active: e.target.checked })}
                        aria-label="Kategorie aktiv"
                      />
                    </label>
                  </td>
                  <td>
                    <select
                      value={suggestedArea(organization, konto, c.id) ?? ''}
                      onChange={(event) => {
                        const area = event.target.value as ActivityAreaId | ''
                        run(() => setCategoryArea(konto, c.id, area || undefined))
                      }}
                      aria-label={`Tätigkeitsbereich für ${c.name}`}
                      style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}
                    >
                      <option value="">Ohne Vorgabe</option>
                      {AREA_DEFINITIONS.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="category-presentation">
                      <select
                        value={praesentationsModus(c)}
                        onChange={(e) =>
                          updateCategory(c.id, {
                            praesentation: e.target.value as Category['praesentation'],
                          })
                        }
                        aria-label="Darstellung in der Jahres-Präsentation"
                      >
                        <option value="monat">Im Jahresverlauf</option>
                        <option value="sammel">Sammel-Folie</option>
                        <option value="aus">Nicht in Präsentation</option>
                      </select>
                      {praesentationsModus(c) === 'monat' && (
                        <select
                          value={c.praesentationMonat ?? 0}
                          onChange={(e) =>
                            updateCategory(c.id, {
                              praesentationMonat: Number(e.target.value) || undefined,
                            })
                          }
                          aria-label="Monat im Jahresverlauf"
                        >
                          <option value={0}>Erste Buchung</option>
                          {MONTH_NAMES.map((m, idx) => (
                            <option key={m} value={idx + 1}>
                              {m}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="category-order-actions">
                      <button className="btn btn--ghost btn--sm" disabled={i === 0} onClick={() => move(c.id, -1)} aria-label="Nach oben">
                        ↑
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        disabled={i === cats.length - 1}
                        onClick={() => move(c.id, 1)}
                        aria-label="Nach unten"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td className="num">
                    <button
                      className="btn btn--ghost btn--sm btn--danger"
                      onClick={() => {
                        if (!deleteCategory(c.id))
                          notify('Kategorie hat Buchungen und kann nicht gelöscht werden. Stattdessen deaktivieren.')
                      }}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="toolbar category-create" style={{ marginTop: 'var(--space-4)' }} onSubmit={(event) => { event.preventDefault(); run(addNewCategory) }}>
          <div className="field category-create__name">
            <input
              value={newCat.name}
              onChange={(e) => setNewCat((s) => ({ ...s, name: e.target.value }))}
              placeholder="Neue Veranstaltung / Kategorie"
              aria-label="Name der neuen Kategorie"
              required
              disabled={addingCategory}
            />
          </div>
          <div className="field category-create__code">
            <input
              value={newCat.code}
              onChange={(e) => setNewCat((s) => ({ ...s, code: e.target.value }))}
              placeholder="Kürzel"
              aria-label="Kürzel der neuen Kategorie"
              required
              disabled={addingCategory}
            />
          </div>
          <div className="field" style={{ flex: '1 1 240px', minWidth: 0 }}>
            <select
              value={newCat.area}
              onChange={(event) => setNewCat((current) => ({ ...current, area: event.target.value as ActivityAreaId | '' }))}
              aria-label="Tätigkeitsbereich der neuen Kategorie"
              required
              disabled={addingCategory}
            >
              <option value="">Bereich wählen</option>
              {AREA_DEFINITIONS.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </div>
          <button className="btn" type="submit" disabled={addingCategory}>
            Hinzufügen
          </button>
        </form>

      </section>
      {yearEndScope !== null && yearEndScope === scope && <YearEndDialog
        key={scope}
        yearLabel={nextYearLabel}
        openingBalance={totals.closingBalance}
        categories={cats}
        onCancel={() => setYearEndScope(null)}
        onConfirm={startNextYear}
      />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/** Lokale Speicherung plus optionale Spiegelung in einen Cloud-synchronisierten Ordner. */
export function DataStorageCard({ notify }: { notify: (msg: string) => void }) {
  const { settings, updateSettings, allFiles, flush, restoreBackup } = useStore()
  const snapshot = useRef({ settings, allFiles })
  snapshot.current = { settings, allFiles }
  const backupPending = useRef(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const cloudEnabled = settings.cloudBackupEnabled === true
  const cloudDir = settings.cloudBackupDir?.trim() ?? ''
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    void refreshCloudStatus()
  }, [cloudEnabled, cloudDir])

  async function refreshCloudStatus() {
    try {
      setCloudStatus(await api.cloudSyncStatus())
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  /** Alle Jahre sämtlicher Konten plus Einstellungen als eine Sicherungsdatei exportieren. */
  async function exportBackup() {
    await flush()
    const { allFiles: files, settings: latestSettings } = snapshot.current
    if (files.length === 0) return notify('Keine Daten zum Exportieren gefunden.')
    const backup = buildBackup(files, latestSettings, new Date().toISOString())
    const name = `Buchfuehrung-Sicherung-${new Date().toISOString().slice(0, 10)}.json`
    const result = await api.saveTextFile(name, JSON.stringify(backup, null, 2))
    if (result.ok) notify(result.path ? `Sicherung gespeichert: ${result.path}` : 'Sicherung exportiert.')
  }

  /** Sicherungsdatei einlesen, streng validieren und nach Bestätigung übernehmen. */
  async function importBackup() {
    await flush()
    const file = await api.openTextFile()
    if (!file) return
    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      return alert(`„${file.name}“ ist keine lesbare JSON-Datei.`)
    }
    const result = validateBackup(parsed)
    if (!result.ok) {
      return alert(
        `Die Datei wurde NICHT importiert – sie ist keine gültige Sicherung:\n\n• ${result.errors.join('\n• ')}`,
      )
    }
    const kontoLabel = (y: YearFile) =>
      (y.konto ?? 'haupt') !== 'haupt' ? `${y.kontoName ?? 'Weiteres Konto'} ` : ''
    const summary = result.backup.years
      .map((y) => `• ${kontoLabel(y)}${y.year}: ${y.bookings.length} Buchungen, ${y.categories.length} Kategorien`)
      .join('\n')
    const existing: Record<string, number[]> = {}
    for (const y of result.backup.years) {
      const konto = y.konto ?? 'haupt'
      existing[konto] ??= await api.listYears(konto)
    }
    const replaces = result.backup.years
      .filter((y) => existing[y.konto ?? 'haupt'].includes(y.year))
      .map((y) => `${kontoLabel(y)}${y.year}`)
    const notes = [
      'Nicht enthaltene Kassenjahre und deren Zuordnungen bleiben erhalten. Die Cloud-Sicherung wird deaktiviert.',
      ...(!result.backup.settings?.organization ? ['Die Sicherung enthält keine Bereichszuordnungen. Zuordnungen und Umbuchungen der importierten Kassenjahre werden zurückgesetzt.'] : []),
      ...(result.backup.settings?.bankAccounts?.length ? ['Für importierte Bankverbindungen muss die PIN erneut eingegeben werden.'] : []),
    ].join('\n')
    if (
      !confirm(
        `Sicherung „${file.name}“ importieren?\n\n${summary}\n\n${
          replaces.length > 0
            ? `Achtung: Die vorhandenen Kassenjahre ${replaces.join(', ')} werden ersetzt (Sicherungskopien landen im Backup-Ordner).`
            : 'Es werden keine vorhandenen Jahre überschrieben.'
        }\n\n${notes}`,
      )
    )
      return
    await flush()
    const before = buildBackup(snapshot.current.allFiles, snapshot.current.settings, new Date().toISOString())
    const saved = await api.saveTextFile(
      `Buchfuehrung-vor-Wiederherstellung-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      JSON.stringify(before, null, 2),
    )
    if (!saved.ok) return notify('Wiederherstellung abgebrochen.')
    await flush()
    await restoreBackup(result.backup)
    window.location.reload()
  }

  async function chooseCloudFolder() {
    const dir = await api.selectCloudFolder()
    if (!dir) return
    await updateSettings({ cloudBackupDir: dir, cloudBackupEnabled: true })
    await refreshCloudStatus()
    notify('Cloud-Sicherung gespeichert.')
  }

  async function toggleCloudBackup(enabled: boolean) {
    if (enabled && !cloudDir) {
      await chooseCloudFolder()
      return
    }
    await updateSettings({ cloudBackupEnabled: enabled })
    await refreshCloudStatus()
    notify(enabled ? 'Cloud-Sicherung aktiviert.' : 'Cloud-Sicherung deaktiviert.')
  }

  async function clearCloudFolder() {
    await updateSettings({ cloudBackupDir: null, cloudBackupEnabled: false })
    await refreshCloudStatus()
    notify('Cloud-Sicherung entfernt.')
  }

  async function syncNow() {
    setSyncing(true)
    try {
      const status = await api.syncCloudNow()
      setCloudStatus(status)
      if (status.lastError) notify(`Cloud-Synchronisierung fehlgeschlagen: ${status.lastError}`)
      else notify('Cloud-Sicherung ist aktuell.')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncing(false)
    }
  }

  function run(task: () => Promise<unknown>) {
    void task().catch((error) => notify(error instanceof Error ? error.message : String(error)))
  }

  function runBackup(task: () => Promise<unknown>) {
    if (backupPending.current) return
    backupPending.current = true
    setBackupBusy(true)
    void task().catch((error) => notify(error instanceof Error ? error.message : String(error)))
      .finally(() => { backupPending.current = false; setBackupBusy(false) })
  }

  return (
    <section className="card">
      <h2 className="card__title">Datenspeicherung</h2>
      <div className="toolbar">
        <span>
          Lokale Speicherung mit automatischen Backups
          {isElectron && (
            <button className="btn btn--ghost btn--sm" style={{ marginLeft: 8 }} onClick={() => run(() => api.openDataFolder())}>
              Datenordner öffnen
            </button>
          )}
        </span>
      </div>
      <div className="storage-cloud">
        <label className="storage-cloud__toggle">
          <input
            type="checkbox"
            checked={cloudEnabled}
            disabled={!isElectron || backupBusy}
            onChange={(e) => { const enabled = e.target.checked; run(() => toggleCloudBackup(enabled)) }}
          />
          Zusätzlicher Sicherungsordner
        </label>
        <div className="toolbar">
          <code className="storage-cloud__path">{cloudDir || 'Kein Cloud-Ordner ausgewählt'}</code>
          <div className="toolbar__spacer" />
          {cloudDir && (
            <button className="btn btn--ghost btn--sm" onClick={() => run(() => api.openCloudFolder())}>
              Ordner öffnen
            </button>
          )}
          {cloudDir && (
            <button className="btn btn--ghost btn--sm btn--danger" disabled={backupBusy} onClick={() => run(clearCloudFolder)}>
              Entfernen
            </button>
          )}
          <button className="btn btn--sm" disabled={!isElectron || backupBusy} onClick={() => run(chooseCloudFolder)}>
            {cloudDir ? 'Ordner ändern …' : 'Cloud-Ordner wählen …'}
          </button>
        </div>
        {cloudEnabled && (
          <div className={`cloud-sync-state${cloudStatus?.lastError ? ' is-error' : ''}`}>
            <span>
              {syncing
                ? 'Synchronisiere lokale Daten …'
                : cloudStatus?.lastError
                  ? `Letzte Synchronisierung fehlgeschlagen: ${cloudStatus.lastError}`
                  : cloudStatus?.lastSuccessAt
                    ? `Zuletzt synchronisiert: ${formatCloudSyncDate(cloudStatus.lastSuccessAt)}${cloudStatus.fileCount ? ` · ${cloudStatus.fileCount} Dateien` : ''}`
                    : 'Noch nicht synchronisiert'}
            </span>
            <button className="btn btn--ghost btn--sm" disabled={!isElectron || syncing || backupBusy} onClick={() => run(syncNow)}>
              Jetzt synchronisieren
            </button>
          </div>
        )}

      </div>
      <div className="storage-cloud">
        <span className="storage-cloud__toggle">Vollständige Sicherung</span>
        <div className="toolbar">
          <button className="btn btn--sm" disabled={backupBusy} onClick={() => runBackup(exportBackup)}>
            Daten exportieren …
          </button>
          <button className="btn btn--sm" disabled={backupBusy} onClick={() => runBackup(importBackup)}>
            Sicherung importieren …
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>Vor einer Wiederherstellung wird eine vollständige Sicherung gespeichert.</p>
      </div>
    </section>
  )
}

function formatCloudSyncDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

/** Eigenes Vereinslogo hochladen – erscheint in Seitenleiste, Prüfbericht und Dock. */
export function LogoCard({ notify }: { notify: (msg: string) => void }) {
  const { settings, updateSettings } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const dataUrl = await readLogoFile(file)
      await updateSettings({ logoDataUrl: dataUrl })
      notify('Logo gespeichert.')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">Vereinslogo</h2>
      <div className="toolbar">
        <span className="logo-preview">
          <LogoMark logo={settings.logoDataUrl} size={64} />
        </span>
        <div className="toolbar__spacer" />
        {settings.logoDataUrl && (
          <button
            className="btn btn--ghost btn--danger"
            onClick={() => {
              void updateSettings({ logoDataUrl: null }).then(() => notify('Logo entfernt.')).catch((error) => notify(error instanceof Error ? error.message : String(error)))
            }}
          >
            Logo entfernen
          </button>
        )}
        <button className="btn" onClick={() => inputRef.current?.click()}>
          {settings.logoDataUrl ? 'Logo ändern …' : 'Logo hochladen …'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => void onPick(e)}
          aria-label="Logo-Datei wählen"
        />
      </div>

    </section>
  )
}

/** Update-Bereich: Version anzeigen, Release prüfen, herunterladen und installieren. */
export function UpdateCard() {
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<number | null>(null)

  useEffect(() => {
    void api.getVersion().then(setVersion).catch((err) => setError(err instanceof Error ? err.message : String(err)))
    return api.onUpdateProgress((p) => {
      setProgress(p.total > 0 ? Math.round((p.received / p.total) * 100) : -1)
    })
  }, [])

  async function check() {
    setChecking(true)
    setError('')
    setInfo(null)
    try {
      setInfo(await api.checkForUpdate())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  async function install() {
    if (!info) return
    setError('')
    setProgress(0)
    try {
      const result = await api.installUpdate(info)
      if (!result.ok) {
        setProgress(null)
        setError(result.error ?? 'Installation fehlgeschlagen.')
      }
    } catch (err) {
      setProgress(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">Updates</h2>
      <div className="toolbar">
        <span>
          Installierte Version: <strong>{version || '…'}</strong>
          {info && !info.hasUpdate && <span className="pill pill--in" style={{ marginLeft: 8 }}>aktuell</span>}
        </span>
        <div className="toolbar__spacer" />
        {info?.hasUpdate && progress === null && (
          <button className="btn btn--primary" onClick={() => void install()}>
            Version {info.latest} installieren
          </button>
        )}
        <button className="btn" disabled={checking || progress !== null} onClick={() => void check()}>
          {checking ? 'Prüfe …' : 'Nach Updates suchen'}
        </button>
      </div>
      {progress !== null && (
        <p className="hint" style={{ marginBottom: 0 }}>
          {progress < 0 ? 'Lade herunter …' : `Lade herunter … ${progress} %`} Die App startet nach
          der Installation automatisch neu.
        </p>
      )}
      {info?.hasUpdate && progress === null && (
        <p className="hint" style={{ marginBottom: 0 }}>
          Neue Version {info.latest} verfügbar (installiert: {info.current}). Die Daten bleiben bei
          der Aktualisierung erhalten.
        </p>
      )}
      {error && (
        <p className="hint" style={{ marginBottom: 0, color: 'var(--color-expense)' }}>
          {error}
        </p>
      )}
    </section>
  )
}
