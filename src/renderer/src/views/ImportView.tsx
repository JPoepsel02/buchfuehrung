import { useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { parseBankCsv } from '@shared/csv'
import { makeId } from '@shared/defaults'
import { nextSeq } from '@shared/ledger'
import { formatDate } from '@shared/money'
import type { ImportDraftRow } from '@shared/types'

/**
 * Kontoauszug-Import: Der eingelesene Auszug wird als Entwurf in der
 * Jahresdatei gespeichert (überlebt Tab-Wechsel und Neustart). Der
 * Bank-Verwendungszweck wird nur angezeigt – übernommen wird ein eigener,
 * kurzer Verwendungszweck je Umsatz; der Original-Text landet in der Notiz.
 */
export function ImportView() {
  const { file, update } = useStore()
  const [toast, setToast] = useState('')

  const activeCats = useMemo(
    () => (file ? file.categories.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [file],
  )
  const existingHashes = useMemo(
    () => new Set(file?.bookings.map((b) => b.importHash).filter(Boolean) ?? []),
    [file?.bookings],
  )

  if (!file) return null
  const draft = file.importDraft ?? null
  const defaultCat = activeCats[activeCats.length - 1]?.id ?? ''

  async function openFile() {
    const result = await api.openCsv()
    if (!result) return
    const parsed = parseBankCsv(result.content)
    const rows: ImportDraftRow[] = parsed.rows.map((r) => ({
      date: r.date,
      bankText: r.description,
      amount: r.amount,
      hash: r.hash,
      description: '',
      selected: !existingHashes.has(r.hash) && r.date.startsWith(String(file!.year)),
      categoryId: defaultCat,
      isUmsatz: false,
    }))
    update((f) => ({
      ...f,
      importDraft: { fileName: result.name, skipped: parsed.skipped, rows },
    }))
  }

  function setRow(index: number, patch: Partial<ImportDraftRow>) {
    update((f) =>
      f.importDraft
        ? {
            ...f,
            importDraft: {
              ...f.importDraft,
              rows: f.importDraft.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
            },
          }
        : f,
    )
  }

  function setAllSelected(selected: boolean) {
    update((f) =>
      f.importDraft
        ? {
            ...f,
            importDraft: {
              ...f.importDraft,
              rows: f.importDraft.rows.map((r) =>
                existingHashes.has(r.hash) || !r.date.startsWith(String(f.year)) ? r : { ...r, selected },
              ),
            },
          }
        : f,
    )
  }

  function discardDraft() {
    if (!confirm('Gespeicherten Import-Entwurf wirklich verwerfen?')) return
    update((f) => ({ ...f, importDraft: null }))
  }

  /** Übernimmt alle ausgewählten Zeilen als Buchungen und entfernt sie aus dem Entwurf. */
  function doImport() {
    const selectedIdx = new Set(
      draft!.rows
        .map((r, i) => (r.selected && r.description.trim() && !existingHashes.has(r.hash) ? i : -1))
        .filter((i) => i >= 0),
    )
    if (selectedIdx.size === 0) return
    let importedCount = 0
    update((f) => {
      if (!f.importDraft) return f
      let seq = nextSeq(f)
      const added = f.importDraft.rows
        .filter((_, i) => selectedIdx.has(i))
        .map((r) => ({
          id: makeId(),
          seq: seq++,
          date: r.date,
          categoryId: r.categoryId,
          description: r.description.trim(),
          type: r.amount < 0 ? ('ausgabe' as const) : ('einnahme' as const),
          amount: Math.abs(r.amount),
          isUmsatz: r.isUmsatz,
          nonUmsatzAmount: 0,
          note: r.bankText,
          source: 'import' as const,
          importHash: r.hash,
        }))
      importedCount = added.length
      const remaining = f.importDraft.rows.filter((_, i) => !selectedIdx.has(i))
      return {
        ...f,
        bookings: [...f.bookings, ...added],
        importDraft: remaining.length > 0 ? { ...f.importDraft, rows: remaining } : null,
      }
    })
    setToast(`${importedCount} Buchungen importiert.`)
    setTimeout(() => setToast(''), 4000)
  }

  const selected = draft ? draft.rows.filter((r) => r.selected && !existingHashes.has(r.hash)) : []
  const missingText = selected.filter((r) => !r.description.trim()).length
  const readyCount = selected.length - missingText

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

      {!draft ? (
        <section className="card">
          <div className="empty">
            <h3>Kontoauszug auswählen</h3>
            <p>
              Exportiere im Online-Banking deine Umsätze als CSV-Datei und wähle sie hier aus.
              <br />
              Der Auszug bleibt als Entwurf gespeichert – du kannst die Umsätze auch später
              übernehmen. Für jede Buchung vergibst du einen eigenen, kurzen Verwendungszweck.
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
              {draft.fileName} · {draft.rows.length} offene Umsätze
            </h2>
            <div className="toolbar__spacer" />
            <button className="btn btn--sm" onClick={() => setAllSelected(true)}>
              Alle auswählen
            </button>
            <button className="btn btn--sm" onClick={() => setAllSelected(false)}>
              Keine
            </button>
            <button className="btn btn--ghost btn--sm" onClick={discardDraft}>
              Entwurf verwerfen
            </button>
          </div>
          {draft.skipped > 0 && (
            <p className="hint" style={{ marginTop: 0 }}>
              {draft.skipped} Zeilen konnten nicht gelesen werden (z. B. Kopf- oder Saldozeilen).
            </p>
          )}
          <table className="ledger">
            <thead>
              <tr>
                <th></th>
                <th>Datum</th>
                <th>Kontoauszug (Original)</th>
                <th>Eigener Verwendungszweck</th>
                <th className="num">Betrag</th>
                <th>Kategorie</th>
                <th>Umsatz</th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((r, i) => {
                const isDuplicate = existingHashes.has(r.hash)
                const inYear = r.date.startsWith(String(file.year))
                return (
                  <tr key={`${r.hash}-${i}`} style={isDuplicate || !inYear ? { opacity: 0.5 } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.selected && !isDuplicate}
                        disabled={isDuplicate}
                        onChange={(e) => setRow(i, { selected: e.target.checked })}
                        aria-label="Umsatz importieren"
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(r.date)}
                      {isDuplicate && <div><span className="pill pill--out">importiert</span></div>}
                      {!inYear && !isDuplicate && (
                        <div><span className="pill">anderes Jahr</span></div>
                      )}
                    </td>
                    <td className="cell-bank">
                      <span className="bank-clamp" title={r.bankText}>
                        {r.bankText}
                      </span>
                    </td>
                    <td>
                      <input
                        value={r.description}
                        onChange={(e) => setRow(i, { description: e.target.value })}
                        placeholder="z. B. Erstattung Pizza"
                        disabled={!r.selected || isDuplicate}
                        aria-label="Eigener Verwendungszweck"
                        aria-invalid={r.selected && !isDuplicate && !r.description.trim()}
                        style={{ minWidth: 140, width: '100%' }}
                      />
                    </td>
                    <td className="num">
                      <Amount cents={r.amount} withSign />
                    </td>
                    <td>
                      <select
                        value={r.categoryId}
                        onChange={(e) => setRow(i, { categoryId: e.target.value })}
                        disabled={!r.selected || isDuplicate}
                        aria-label="Kategorie"
                        style={{ maxWidth: 160 }}
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
                        disabled={!r.selected || isDuplicate}
                        onChange={(e) => setRow(i, { isUmsatz: e.target.checked })}
                        aria-label="Zählt als Umsatz"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 'var(--space-4)' }}>
            {missingText > 0 && (
              <p className="hint" style={{ margin: 0 }}>
                {missingText} ausgewählte Umsätze haben noch keinen eigenen Verwendungszweck.
              </p>
            )}
            <div className="toolbar__spacer" />
            <button className="btn btn--primary" disabled={readyCount === 0} onClick={doImport}>
              {readyCount} Buchungen übernehmen
            </button>
          </div>
        </section>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
