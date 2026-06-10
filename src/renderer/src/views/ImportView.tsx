import { useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { parseBankCsv } from '@shared/csv'
import type { StatementRow } from '@shared/csv'
import { formatDate } from '@shared/money'

interface PendingRow extends StatementRow {
  selected: boolean
  categoryId: string
  isUmsatz: boolean
  isDuplicate: boolean
  inYear: boolean
}

export function ImportView() {
  const { file, addBookings } = useStore()
  const [fileName, setFileName] = useState('')
  const [pending, setPending] = useState<PendingRow[]>([])
  const [skipped, setSkipped] = useState(0)
  const [toast, setToast] = useState('')

  const activeCats = useMemo(
    () => (file ? file.categories.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [file],
  )

  if (!file) return null
  const existingHashes = new Set(file.bookings.map((b) => b.importHash).filter(Boolean))
  const defaultCat = activeCats[activeCats.length - 1]?.id ?? ''

  async function openFile() {
    const result = await api.openCsv()
    if (!result) return
    const parsed = parseBankCsv(result.content)
    setFileName(result.name)
    setSkipped(parsed.skipped)
    setPending(
      parsed.rows.map((r) => {
        const isDuplicate = existingHashes.has(r.hash)
        const inYear = r.date.startsWith(String(file!.year))
        return {
          ...r,
          selected: !isDuplicate && inYear,
          categoryId: defaultCat,
          isUmsatz: false,
          isDuplicate,
          inYear,
        }
      }),
    )
  }

  function setRow(index: number, patch: Partial<PendingRow>) {
    setPending((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function setAll(patch: Partial<PendingRow>) {
    setPending((rows) => rows.map((r) => (r.isDuplicate || !r.inYear ? r : { ...r, ...patch })))
  }

  function doImport() {
    const toImport = pending.filter((r) => r.selected)
    addBookings(
      toImport.map((r) => ({
        date: r.date,
        categoryId: r.categoryId,
        description: r.description || 'Kontoumsatz',
        type: r.amount < 0 ? ('ausgabe' as const) : ('einnahme' as const),
        amount: Math.abs(r.amount),
        isUmsatz: r.isUmsatz,
        nonUmsatzAmount: 0,
        note: `Import aus ${fileName}`,
        source: 'import' as const,
        importHash: r.hash,
      })),
    )
    setPending([])
    setFileName('')
    setToast(`${toImport.length} Buchungen importiert.`)
    setTimeout(() => setToast(''), 4000)
  }

  const selectedCount = pending.filter((r) => r.selected).length

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Kontoauszug-Import</h1>
          <p className="view__subtitle">
            CSV-Exporte aus dem Online-Banking (Sparkasse, Volksbank, ING, DKB u. a.) einlesen.
          </p>
        </div>
      </header>

      {pending.length === 0 ? (
        <section className="card">
          <div className="empty">
            <h3>Kontoauszug auswählen</h3>
            <p>
              Exportiere im Online-Banking deine Umsätze als CSV-Datei und wähle sie hier aus.
              <br />
              Datum, Verwendungszweck und Betrag werden automatisch erkannt – bereits importierte
              Umsätze werden als Duplikate markiert.
            </p>
            <button className="btn btn--primary" onClick={() => void openFile()}>
              CSV-Datei öffnen …
            </button>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="toolbar" style={{ marginBottom: 'var(--space-4)' }}>
            <h2 className="card__title" style={{ marginBottom: 0 }}>
              {fileName} · {pending.length} Umsätze
            </h2>
            <div className="toolbar__spacer" />
            <button className="btn btn--sm" onClick={() => setAll({ selected: true })}>
              Alle auswählen
            </button>
            <button className="btn btn--sm" onClick={() => setAll({ selected: false })}>
              Keine
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setPending([])}>
              Verwerfen
            </button>
          </div>
          {skipped > 0 && (
            <p className="hint" style={{ marginTop: 0 }}>
              {skipped} Zeilen konnten nicht gelesen werden (z. B. Kopf- oder Saldozeilen).
            </p>
          )}
          <table className="ledger">
            <thead>
              <tr>
                <th></th>
                <th>Datum</th>
                <th>Verwendungszweck</th>
                <th className="num">Betrag</th>
                <th>Kategorie</th>
                <th>Umsatz</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r, i) => (
                <tr key={i} style={r.isDuplicate || !r.inYear ? { opacity: 0.5 } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.selected}
                      disabled={r.isDuplicate}
                      onChange={(e) => setRow(i, { selected: e.target.checked })}
                      aria-label="Umsatz importieren"
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatDate(r.date)}
                    {r.isDuplicate && <span className="pill pill--out" style={{ marginLeft: 6 }}>Duplikat</span>}
                    {!r.inYear && !r.isDuplicate && (
                      <span className="pill" style={{ marginLeft: 6 }}>anderes Jahr</span>
                    )}
                  </td>
                  <td style={{ maxWidth: 420 }}>{r.description}</td>
                  <td className="num">
                    <Amount cents={r.amount} withSign />
                  </td>
                  <td>
                    <select
                      value={r.categoryId}
                      onChange={(e) => setRow(i, { categoryId: e.target.value })}
                      disabled={!r.selected}
                      aria-label="Kategorie"
                      style={{ maxWidth: 180 }}
                    >
                      {activeCats.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.isUmsatz}
                      disabled={!r.selected}
                      onChange={(e) => setRow(i, { isUmsatz: e.target.checked })}
                      aria-label="Zählt als Umsatz"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 'var(--space-4)' }}>
            <div className="toolbar__spacer" />
            <button className="btn btn--primary" disabled={selectedCount === 0} onClick={doImport}>
              {selectedCount} Buchungen übernehmen
            </button>
          </div>
        </section>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
