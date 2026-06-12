import { useEffect, useRef, useState } from 'react'
import { api, isElectron } from '../api'
import type { UpdateInfo } from '../api'
import { AmountField } from '../components/AmountInput'
import { LogoMark } from '../components/LogoMark'
import { useStore } from '../store'
import { praesentationsModus } from '../presentation'
import { fiscalLabel } from '@shared/fiscal'
import { buildBackup, validateBackup } from '@shared/backup'
import { yearTotals } from '@shared/ledger'
import { MONTH_NAMES, formatEur, parseAmountToCents } from '@shared/money'
import type { Category, ThemeSetting, YearFile } from '@shared/types'

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

export function EinstellungenView() {
  const {
    file,
    years,
    konto,
    zweitExists,
    zweitName,
    selectKonto,
    update,
    createYear,
    deleteYear,
    selectYear,
    addCategory,
    updateCategory,
    deleteCategory,
  } = useStore()
  const [toast, setToast] = useState('')
  const [newCat, setNewCat] = useState({ name: '', code: '' })
  const [balanceInput, setBalanceInput] = useState(() =>
    file ? (file.openingBalance / 100).toFixed(2).replace('.', ',') : '0,00',
  )

  // Anfangssaldo-Feld nachziehen, wenn Jahr oder Konto wechseln
  useEffect(() => {
    if (file) setBalanceInput((file.openingBalance / 100).toFixed(2).replace('.', ','))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.konto, file?.year])

  if (!file) return null
  const jahrWort = 'Kassenjahr'
  const totals = yearTotals(file)
  const cats = [...file.categories].sort((a, b) => a.sortOrder - b.sortOrder)

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

  function addNewCategory(e: React.FormEvent) {
    e.preventDefault()
    const name = newCat.name.trim()
    const code = newCat.code.trim().toUpperCase()
    if (!name || !code) return notify('Name und Kürzel angeben.')
    if (file!.categories.some((c) => c.code === code)) return notify(`Kürzel „${code}“ ist bereits vergeben.`)
    const maxSort = Math.max(0, ...file!.categories.map((c) => c.sortOrder))
    addCategory({ name, code, sortOrder: maxSort + 10, active: true })
    setNewCat({ name: '', code: '' })
  }

  function move(id: string, dir: -1 | 1) {
    const idx = cats.findIndex((c) => c.id === id)
    const other = cats[idx + dir]
    if (!other) return
    const current = cats[idx]
    updateCategory(current.id, { sortOrder: other.sortOrder })
    updateCategory(other.id, { sortOrder: current.sortOrder })
  }

  async function removeYear(year: number) {
    const label = fiscalLabel({ year, fiscalStartMonth: file!.fiscalStartMonth })
    if (
      !confirm(
        `${jahrWort} ${label} wirklich löschen?\n\nEine Sicherungskopie wird im Backup-Ordner abgelegt (Einstellungen → „Datenordner öffnen“ → backups).`,
      )
    )
      return
    await deleteYear(year)
    notify(`${jahrWort} ${label} gelöscht.`)
  }

  async function startNextYear() {
    const nextYear = file!.year + 1
    const label = fiscalLabel({ year: nextYear, fiscalStartMonth: file!.fiscalStartMonth })
    if (
      !confirm(
        `Jahresabschluss: ${jahrWort} ${label} anlegen?\n\nDer Abschlusssaldo ${formatEur(totals.closingBalance)} wird als Anfangssaldo übernommen, die Kategorien werden kopiert.`,
      )
    )
      return
    await createYear(nextYear, totals.closingBalance, file!.clubName, file!.treasurerName)
    notify(`${jahrWort} ${label} angelegt.`)
  }

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Einstellungen</h1>
        </div>
      </header>

      <section className="card">
        <h2 className="card__title">
          {konto === 'zweit' ? `${file.kontoName ?? 'Zweitkonto'} · ` : ''}
          {jahrWort} {fiscalLabel(file)}
        </h2>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: 'span 4' }}>
            <label htmlFor="s-club">Verein / Ortsgruppe</label>
            <input
              id="s-club"
              value={file.clubName}
              onChange={(e) => update((f) => ({ ...f, clubName: e.target.value }))}
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 4' }}>
            <label htmlFor="s-treasurer">Kassenwart:in</label>
            <input
              id="s-treasurer"
              value={file.treasurerName}
              onChange={(e) => update((f) => ({ ...f, treasurerName: e.target.value }))}
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="s-balance">Anfangssaldo (€)</label>
            <AmountField id="s-balance" value={balanceInput} onChange={setBalanceInput} onBlur={saveBalance} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <button className="btn" onClick={() => void startNextYear()}>
              Jahresabschluss → {fiscalLabel({ year: file.year + 1, fiscalStartMonth: file.fiscalStartMonth })}
            </button>
          </div>
          {konto === 'zweit' && (
            <div className="field" style={{ gridColumn: 'span 4' }}>
              <label htmlFor="s-kontoname">Konto-Name</label>
              <input
                id="s-kontoname"
                value={file.kontoName ?? ''}
                onChange={(e) => update((f) => ({ ...f, kontoName: e.target.value }))}
                placeholder="z. B. Karnevalskonto"
              />
            </div>
          )}
        </div>
      </section>

      <AppearanceCard />

      <DataStorageCard notify={notify} />

      <LogoCard notify={notify} />

      {isElectron && <UpdateCard />}

      <section className="card">
        <h2 className="card__title">Konten</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Hauptkonto und Zweitkonto werden vollständig getrennt geführt – eigene Kategorien,
          eigene Beleg-Nummern, eigenes Kassenjahr. Summen werden nie verrechnet.
        </p>
        {zweitExists ? (
          <p className="hint">
            Zweitkonto „{zweitName}“ ist angelegt – Wechsel über die Konto-Auswahl in der Seitenleiste.
          </p>
        ) : (
          <button className="btn" onClick={() => void selectKonto('zweit')}>
            Zweites Konto anlegen …
          </button>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">{jahrWort}e{konto === 'zweit' ? ` · ${file.kontoName ?? 'Zweitkonto'}` : ''}</h2>
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
                    <button className="btn btn--ghost btn--sm" onClick={() => void selectYear(y)}>
                      Öffnen
                    </button>
                  )}
                  <button
                    className="btn btn--ghost btn--sm btn--danger"
                    disabled={konto === 'haupt' && years.length < 2}
                    onClick={() => void removeYear(y)}
                  >
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Gelöschte Jahre wandern als Sicherungskopie in den Backup-Ordner – z. B. falls ein
          Jahresabschluss versehentlich ausgelöst wurde. Das letzte Jahr des Hauptkontos kann nicht
          gelöscht werden; wird das letzte Jahr des Zweitkontos gelöscht, verschwindet das Zweitkonto.
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Veranstaltungen / Kategorien</h2>
        <table className="ledger">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kürzel</th>
              <th>Aktiv</th>
              <th>Präsentation</th>
              <th>Reihenfolge</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={c.id}>
                <td>
                  <input
                    value={c.name}
                    onChange={(e) => updateCategory(c.id, { name: e.target.value })}
                    style={{ border: 'none', background: 'transparent', width: '100%', font: 'inherit' }}
                    aria-label="Kategoriename"
                  />
                </td>
                <td className="ref">{c.code}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={c.active}
                    onChange={(e) => updateCategory(c.id, { active: e.target.checked })}
                    aria-label="Kategorie aktiv"
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <select
                    value={c.praesentation ?? ''}
                    onChange={(e) =>
                      updateCategory(c.id, {
                        praesentation: (e.target.value || undefined) as Category['praesentation'],
                      })
                    }
                    aria-label="Darstellung in der Jahres-Präsentation"
                  >
                    <option value="">Automatisch ({praesentationsModus(c) === 'sammel' ? 'Sammel-Folie' : 'Jahresverlauf'})</option>
                    <option value="monat">Im Jahresverlauf</option>
                    <option value="sammel">Sammel-Folie</option>
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
                      style={{ marginLeft: 6 }}
                    >
                      <option value={0}>Erste Buchung</option>
                      {MONTH_NAMES.map((m, idx) => (
                        <option key={m} value={idx + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
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
        <form className="toolbar" style={{ marginTop: 'var(--space-4)' }} onSubmit={addNewCategory}>
          <div className="field">
            <input
              value={newCat.name}
              onChange={(e) => setNewCat((s) => ({ ...s, name: e.target.value }))}
              placeholder="Neue Veranstaltung / Kategorie"
              aria-label="Name der neuen Kategorie"
            />
          </div>
          <div className="field" style={{ width: 90 }}>
            <input
              value={newCat.code}
              onChange={(e) => setNewCat((s) => ({ ...s, code: e.target.value }))}
              placeholder="Kürzel"
              aria-label="Kürzel der neuen Kategorie"
            />
          </div>
          <button className="btn" type="submit">
            Hinzufügen
          </button>
        </form>
        <p className="hint">
          Das Kürzel bestimmt die Beleg-Nummern (z. B. „M“ → M1, M2 …). Die Reihenfolge steuert die
          Sortierung im Veranstaltungs-Blatt und im Prüfbericht. „Präsentation“ legt fest, ob eine
          Kategorie im Jahresverlauf der Präsentation erscheint (einmalig, im Monat der ersten
          Buchung oder im gewählten Monat) oder auf der Sammel-Folie nach den Monaten.
        </p>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/** Farbschema: hell, dunkel oder dem System folgen. */
function AppearanceCard() {
  const { settings, updateSettings } = useStore()
  return (
    <section className="card">
      <h2 className="card__title">Darstellung</h2>
      <div className="field" style={{ maxWidth: 280 }}>
        <label htmlFor="s-theme">Farbschema</label>
        <select
          id="s-theme"
          value={settings.theme ?? 'system'}
          onChange={(e) => void updateSettings({ theme: e.target.value as ThemeSetting })}
        >
          <option value="system">Wie das System</option>
          <option value="hell">Hell</option>
          <option value="dunkel">Dunkel</option>
        </select>
      </div>
    </section>
  )
}

/** Lokale Speicherung plus optionale Spiegelung in einen Cloud-synchronisierten Ordner. */
function DataStorageCard({ notify }: { notify: (msg: string) => void }) {
  const { settings, updateSettings } = useStore()
  const cloudEnabled = settings.cloudBackupEnabled === true
  const cloudDir = settings.cloudBackupDir?.trim() ?? ''

  /** Alle Jahre beider Konten plus Einstellungen als eine Sicherungsdatei exportieren. */
  async function exportBackup() {
    const files: YearFile[] = []
    for (const konto of ['haupt', 'zweit'] as const) {
      const list = await api.listYears(konto)
      for (const y of list) {
        const data = (await api.loadYear(konto, y)) as YearFile | null
        if (data) files.push({ ...data, konto })
      }
    }
    if (files.length === 0) return notify('Keine Daten zum Exportieren gefunden.')
    const backup = buildBackup(files, settings, new Date().toISOString())
    const name = `Buchfuehrung-Sicherung-${new Date().toISOString().slice(0, 10)}.json`
    const result = await api.saveTextFile(name, JSON.stringify(backup, null, 2))
    if (result.ok) notify(result.path ? `Sicherung gespeichert: ${result.path}` : 'Sicherung exportiert.')
  }

  /** Sicherungsdatei einlesen, streng validieren und nach Bestätigung übernehmen. */
  async function importBackup() {
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
    const summary = result.backup.years
      .map(
        (y) =>
          `• ${y.konto === 'zweit' ? `${y.kontoName ?? 'Zweitkonto'} ` : ''}${y.year}: ${y.bookings.length} Buchungen, ${y.categories.length} Kategorien`,
      )
      .join('\n')
    const existing = { haupt: await api.listYears('haupt'), zweit: await api.listYears('zweit') }
    const replaces = result.backup.years
      .filter((y) => existing[y.konto ?? 'haupt'].includes(y.year))
      .map((y) => `${y.konto === 'zweit' ? 'Zweitkonto ' : ''}${y.year}`)
    if (
      !confirm(
        `Sicherung „${file.name}“ importieren?\n\n${summary}\n\n${
          replaces.length > 0
            ? `Achtung: Die vorhandenen Kassenjahre ${replaces.join(', ')} werden ersetzt (Sicherungskopien landen im Backup-Ordner).`
            : 'Es werden keine vorhandenen Jahre überschrieben.'
        }`,
      )
    )
      return
    for (const y of result.backup.years) await api.saveYear(y.konto ?? 'haupt', y.year, y)
    if (result.backup.settings) await api.saveSettings(result.backup.settings)
    window.location.reload()
  }

  async function chooseCloudFolder() {
    const dir = await api.selectCloudFolder()
    if (!dir) return
    await updateSettings({ cloudBackupDir: dir, cloudBackupEnabled: true })
    notify('Cloud-Sicherung gespeichert.')
  }

  async function toggleCloudBackup(enabled: boolean) {
    if (enabled && !cloudDir) {
      await chooseCloudFolder()
      return
    }
    await updateSettings({ cloudBackupEnabled: enabled })
    notify(enabled ? 'Cloud-Sicherung aktiviert.' : 'Cloud-Sicherung deaktiviert.')
  }

  async function clearCloudFolder() {
    await updateSettings({ cloudBackupDir: null, cloudBackupEnabled: false })
    notify('Cloud-Sicherung entfernt.')
  }

  return (
    <section className="card">
      <h2 className="card__title">Datenspeicherung</h2>
      <div className="toolbar">
        <span>
          Lokale Speicherung mit automatischen Backups
          {isElectron && (
            <button className="btn btn--ghost btn--sm" style={{ marginLeft: 8 }} onClick={() => void api.openDataFolder()}>
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
            disabled={!isElectron}
            onChange={(e) => void toggleCloudBackup(e.target.checked)}
          />
          Zusätzliche Sicherung in iCloud, OneDrive oder einem anderen Cloud-Ordner
        </label>
        <div className="toolbar">
          <code className="storage-cloud__path">{cloudDir || 'Kein Cloud-Ordner ausgewählt'}</code>
          <div className="toolbar__spacer" />
          {cloudDir && (
            <button className="btn btn--ghost btn--sm" onClick={() => void api.openCloudFolder()}>
              Ordner öffnen
            </button>
          )}
          {cloudDir && (
            <button className="btn btn--ghost btn--sm btn--danger" onClick={() => void clearCloudFolder()}>
              Entfernen
            </button>
          )}
          <button className="btn btn--sm" disabled={!isElectron} onClick={() => void chooseCloudFolder()}>
            {cloudDir ? 'Ordner ändern …' : 'Cloud-Ordner wählen …'}
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Die App speichert weiterhin lokal. Wenn die Cloud-Sicherung aktiv ist, werden Jahresdateien
          und Einstellungen zusätzlich in den gewählten Ordner kopiert.
        </p>
      </div>
      <div className="storage-cloud">
        <span className="storage-cloud__toggle">Sicherungsdatei (alle Kassenjahre + Einstellungen)</span>
        <div className="toolbar">
          <button className="btn btn--sm" onClick={() => void exportBackup()}>
            Daten exportieren …
          </button>
          <button className="btn btn--sm" onClick={() => void importBackup()}>
            Sicherung importieren …
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Der Export erzeugt eine JSON-Datei mit allen Kassenjahren und Einstellungen. Beim Import
          wird die Datei vollständig geprüft (Format, Beträge, Daten, Kategorie-Verweise) – ungültige
          Dateien werden abgelehnt. Ersetzte Jahre wandern vorher als Sicherungskopie in den
          Backup-Ordner.
        </p>
      </div>
    </section>
  )
}

/** Eigenes Vereinslogo hochladen – erscheint in Seitenleiste, Prüfbericht und Dock. */
function LogoCard({ notify }: { notify: (msg: string) => void }) {
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
              void updateSettings({ logoDataUrl: null })
              notify('Logo entfernt.')
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
      <p className="hint" style={{ marginBottom: 0 }}>
        Das Logo erscheint in der Seitenleiste, im Kopf des Prüfberichts und als Dock-Symbol.
        Ohne eigenes Logo zeigt die App eine neutrale Wortmarke. Nach dem Entfernen erscheint das
        Standard-Dock-Symbol erst nach einem Neustart wieder.
      </p>
    </section>
  )
}

/** Update-Bereich: Version anzeigen, Release prüfen, herunterladen und installieren. */
function UpdateCard() {
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<number | null>(null)

  useEffect(() => {
    void api.getVersion().then(setVersion)
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
    const result = await api.installUpdate(info)
    // Bei Erfolg startet die App neu – diesen Zweig sieht man nur im Fehlerfall
    if (!result.ok) {
      setProgress(null)
      setError(result.error ?? 'Installation fehlgeschlagen.')
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
