import { Fragment, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { CentsAmountInput } from '../components/AmountInput'
import { parseBankCsv } from '@shared/csv'
import { inFiscalYear } from '@shared/fiscal'
import { makeId } from '@shared/defaults'
import { classifyDraftDuplicates, nextSeq, reconcileImportedBookings } from '@shared/ledger'
import { formatDate } from '@shared/money'
import type { Booking, ImportDraftRow, ImportDraftSplit } from '@shared/types'

/** Reduziert eine Entwurfszeile auf die Felder der Duplikat-Erkennung. */
const toDupInput = (r: { hash: string; date: string; amount: number }) => ({
  hash: r.hash,
  date: r.date,
  amount: r.amount,
})

function classifyRows(bookings: Booking[], rows: readonly ImportDraftRow[]) {
  return classifyDraftDuplicates(bookings, rows.map(toDupInput))
}

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
  // Duplikat-Erkennung für die offenen Entwurfszeilen: hard = bereits
  // importiert (Hash), soft = deckt sich mit einer manuellen Buchung.
  const dupes = useMemo(
    () => classifyRows(file?.bookings ?? [], file?.importDraft?.rows ?? []),
    [file?.bookings, file?.importDraft?.rows],
  )

  if (!file) return null
  const draft = file.importDraft ?? null

  async function openFile() {
    const result = await api.openCsv()
    if (!result) return
    const parsed = parseBankCsv(result.content)
    // Chronologisch aufsteigend sortieren, damit die Beleg-Nr.-Vergabe auch
    // bei gleichem Datum der echten Reihenfolge folgt. Bank-Exporte sind
    // meist "neueste zuerst" – dann spiegelt der umgekehrte Zeilenindex die
    // tatsächliche Buchungsreihenfolge innerhalb eines Tages wider.
    const newestFirst =
      parsed.rows.length > 1 && parsed.rows[0].date > parsed.rows[parsed.rows.length - 1].date
    const sorted = parsed.rows
      .map((r, idx) => ({ r, idx }))
      .sort(
        (a, b) =>
          a.r.date.localeCompare(b.r.date) || (newestFirst ? b.idx - a.idx : a.idx - b.idx),
      )
    const preview = reconcileImportedBookings(file!.bookings, parsed.rows)
    // Bereits vorhandene Zeilen (Import ODER manuell erfasst) vorab abwählen.
    const sortedDupes = classifyDraftDuplicates(
      preview.bookings,
      sorted.map(({ r }) => toDupInput(r)),
    )
    const rows: ImportDraftRow[] = sorted.map(({ r }, i) => ({
      date: r.date,
      bankText: r.description,
      amount: r.amount,
      hash: r.hash,
      name: r.name,
      description: '',
      selected: !sortedDupes.hard[i] && !sortedDupes.soft[i] && inFiscalYear(file!, r.date),
      // Bewusst leer: Die Kategorie muss je Umsatz aktiv gewählt werden
      categoryId: '',
      isUmsatz: false,
    }))
    update((f) => {
      const reconciled = reconcileImportedBookings(f.bookings, parsed.rows)
      return {
        ...f,
        bookings: reconciled.bookings,
        importDraft: { fileName: result.name, skipped: parsed.skipped, rows },
      }
    })
    const messages: string[] = []
    if (preview.migratedHashCount > 0) {
      messages.push(`${preview.migratedHashCount} bestehende Import-Zuordnungen aktualisiert`)
    }
    if (preview.updatedNameCount > 0) {
      messages.push(`${preview.updatedNameCount} fehlende Namen ergänzt`)
    }
    if (messages.length > 0) {
      setToast(`${messages.join(', ')}.`)
      setTimeout(() => setToast(''), 5000)
    }
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

  function setSplit(rowIndex: number, splitId: string, patch: Partial<ImportDraftSplit>) {
    const current = draft?.rows[rowIndex]
    if (!current?.splits) return
    setRow(rowIndex, {
      splits: current.splits.map((s) => (s.id === splitId ? { ...s, ...patch } : s)),
    })
  }

  function startSplit(index: number) {
    const row = draft?.rows[index]
    if (!row) return
    const total = Math.abs(row.amount)
    const first = Math.floor(total / 2)
    const second = total - first
    setRow(index, {
      splits: [
        {
          id: makeId(),
          description: row.description.trim(),
          categoryId: row.categoryId,
          amount: first,
          isUmsatz: row.isUmsatz,
        },
        {
          id: makeId(),
          description: '',
          categoryId: row.categoryId,
          amount: second,
          isUmsatz: row.isUmsatz,
        },
      ],
    })
  }

  function addSplit(index: number) {
    const row = draft?.rows[index]
    if (!row?.splits) return
    setRow(index, {
      splits: [
        ...row.splits,
        {
          id: makeId(),
          description: '',
          categoryId: row.categoryId,
          amount: 0,
          isUmsatz: row.isUmsatz,
        },
      ],
    })
  }

  function removeSplit(rowIndex: number, splitId: string) {
    const row = draft?.rows[rowIndex]
    if (!row?.splits) return
    const next = row.splits.filter((s) => s.id !== splitId)
    setRow(rowIndex, { splits: next.length >= 2 ? next : undefined })
  }

  function setAllSelected(selected: boolean) {
    update((f) => {
      if (!f.importDraft) return f
      const cls = classifyRows(f.bookings, f.importDraft.rows)
      return {
        ...f,
        importDraft: {
          ...f.importDraft,
          rows: f.importDraft.rows.map((r, i) =>
            cls.hard[i] || cls.soft[i] || !inFiscalYear(f, r.date) ? r : { ...r, selected },
          ),
        },
      }
    })
  }

  function discardDraft() {
    if (!confirm('Gespeicherten Import-Entwurf wirklich verwerfen?')) return
    update((f) => ({ ...f, importDraft: null }))
  }

  /** Übernimmt alle ausgewählten Zeilen als Buchungen und entfernt sie aus dem Entwurf. */
  function doImport() {
    const selectedRows = draft!.rows
      .map((r, i) => ({ row: r, index: i }))
      .filter(({ row, index }) => row.selected && rowIsImportable(row) && !dupes.hard[index])
    const selectedIdx = new Set(selectedRows.map(({ index }) => index))
    if (selectedIdx.size === 0) return
    const importedBookingsCount = selectedRows.reduce((count, { row }) => count + bookingParts(row).length, 0)
    update((f) => {
      if (!f.importDraft) return f
      let seq = nextSeq(f)
      const added = f.importDraft.rows
        .filter((_, i) => selectedIdx.has(i))
        .flatMap((r) =>
          bookingParts(r).map((part) => ({
            id: makeId(),
            seq: seq++,
            date: r.date,
            categoryId: part.categoryId,
            name: r.name.trim(),
            description: part.description.trim(),
            subcategory: r.splits?.length ? undefined : (r.subcategory ?? '').trim() || undefined,
            type: r.amount < 0 ? ('ausgabe' as const) : ('einnahme' as const),
            amount: part.amount,
            isUmsatz: part.isUmsatz,
            receiptAvailable: false,
            nonUmsatzAmount: 0,
            note: r.bankText,
            source: 'import' as const,
            importHash: r.hash,
            importHashVersion: 2 as const,
          })),
        )
      const remaining = f.importDraft.rows.filter((_, i) => !selectedIdx.has(i))
      return {
        ...f,
        bookings: [...f.bookings, ...added],
        importDraft: remaining.length > 0 ? { ...f.importDraft, rows: remaining } : null,
      }
    })
    setToast(`${importedBookingsCount} Buchungen aus ${selectedRows.length} Bankpositionen importiert.`)
    setTimeout(() => setToast(''), 4000)
  }

  const selected = draft
    ? draft.rows.filter((r, i) => r.selected && !dupes.hard[i])
    : []
  const invalidRows = selected.filter((r) => !rowIsImportable(r)).length
  const readyRows = selected.filter(rowIsImportable)
  const readyBookings = readyRows.reduce((count, r) => count + bookingParts(r).length, 0)

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
          <datalist id="import-sub-suggestions">
            {[...new Set(file.bookings.map((b) => (b.subcategory ?? '').trim()).filter(Boolean))].map((sName) => (
              <option key={sName} value={sName} />
            ))}
          </datalist>
          <table className="ledger">
            <thead>
              <tr>
                <th></th>
                <th>Datum</th>
                <th>Kontoauszug (Original)</th>
                <th>Name</th>
                <th>Eigener Verwendungszweck</th>
                <th className="num">Betrag</th>
                <th>Kategorie</th>
                <th>Umsatz</th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((r, i) => {
                // hart = bereits importiert (gesperrt), weich = deckt sich mit
                // einer manuellen Buchung (vorab abgewählt, aber überschreibbar)
                const isDuplicate = dupes.hard[i]
                const isSoftDup = dupes.soft[i]
                const inYear = inFiscalYear(file, r.date)
                const splitTotal = sumSplits(r.splits)
                const splitDiff = Math.abs(r.amount) - splitTotal
                return (
                  <Fragment key={`${r.hash}-${i}`}>
                  <tr style={isDuplicate || isSoftDup || !inYear ? { opacity: 0.5 } : undefined}>
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
                      {isSoftDup && (
                        <div>
                          <span className="pill pill--out" title="Datum und Betrag decken sich mit einer vorhandenen Buchung">
                            bereits vorhanden
                          </span>
                        </div>
                      )}
                      {!inYear && !isDuplicate && !isSoftDup && (
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
                        value={r.name ?? ''}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                        placeholder="Zahlungspflichtige:r / Empfänger:in"
                        disabled={!r.selected || isDuplicate}
                        aria-label="Name"
                        aria-invalid={r.selected && !isDuplicate && !(r.name ?? '').trim()}
                        style={{ minWidth: 150, width: '100%' }}
                      />
                    </td>
                    <td>
                      <input
                        value={r.description}
                        onChange={(e) => setRow(i, { description: e.target.value })}
                        placeholder="Verwendungszweck"
                        disabled={!r.selected || isDuplicate || Boolean(r.splits?.length)}
                        aria-label="Eigener Verwendungszweck"
                        aria-invalid={r.selected && !isDuplicate && !(r.splits?.length) && !r.description.trim()}
                        style={{ minWidth: 140, width: '100%' }}
                      />
                      {!r.splits?.length && (
                        <input
                          value={r.subcategory ?? ''}
                          onChange={(e) => setRow(i, { subcategory: e.target.value })}
                          placeholder="Unterkategorie (optional)"
                          disabled={!r.selected || isDuplicate}
                          aria-label="Unterkategorie"
                          list="import-sub-suggestions"
                          style={{ minWidth: 140, width: '100%', marginTop: 4, fontSize: 'var(--text-xs)' }}
                        />
                      )}
                      {r.splits?.length ? (
                        <span className="pill" style={{ marginTop: 6 }}>
                          auf {r.splits.length} Buchungen aufgeteilt
                        </span>
                      ) : (
                        <button
                          className="btn btn--ghost btn--sm"
                          style={{ marginTop: 6 }}
                          disabled={!r.selected || isDuplicate}
                          onClick={() => startSplit(i)}
                        >
                          Aufteilen
                        </button>
                      )}
                    </td>
                    <td className="num">
                      <Amount cents={r.amount} withSign />
                    </td>
                    <td>
                      <select
                        value={r.categoryId}
                        onChange={(e) => setRow(i, { categoryId: e.target.value })}
                        disabled={!r.selected || isDuplicate || Boolean(r.splits?.length)}
                        aria-label="Kategorie"
                        aria-invalid={r.selected && !isDuplicate && !r.splits?.length && !r.categoryId}
                        style={{ maxWidth: 160 }}
                      >
                        <option value="" disabled>
                          – Kategorie wählen –
                        </option>
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
                        disabled={!r.selected || isDuplicate || Boolean(r.splits?.length)}
                        onChange={(e) => setRow(i, { isUmsatz: e.target.checked })}
                        aria-label="Zählt als Umsatz"
                      />
                    </td>
                  </tr>
                  {r.splits?.length ? (
                    <tr key={`${r.hash}-${i}-splits`} className="split-row">
                      <td></td>
                      <td colSpan={7}>
                        <div className="split-editor">
                          {r.splits.map((split) => (
                            <div className="split-editor__line" key={split.id}>
                              <input
                                value={split.description}
                                onChange={(e) => setSplit(i, split.id, { description: e.target.value })}
                                placeholder="z. B. Getränke Event A"
                                disabled={!r.selected || isDuplicate}
                                aria-label="Split-Verwendungszweck"
                                aria-invalid={r.selected && !isDuplicate && !split.description.trim()}
                              />
                              <select
                                value={split.categoryId}
                                onChange={(e) => setSplit(i, split.id, { categoryId: e.target.value })}
                                disabled={!r.selected || isDuplicate}
                                aria-label="Split-Kategorie"
                                aria-invalid={r.selected && !isDuplicate && !split.categoryId}
                              >
                                <option value="" disabled>
                                  – Kategorie wählen –
                                </option>
                                {activeCats.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                              <CentsAmountInput
                                cents={split.amount}
                                disabled={!r.selected || isDuplicate}
                                invalid={r.selected && !isDuplicate && split.amount <= 0}
                                onCommit={(amount) => setSplit(i, split.id, { amount })}
                                aria-label="Split-Betrag"
                                style={{ maxWidth: 120, textAlign: 'right' }}
                              />
                              <label className="split-editor__check">
                                <input
                                  type="checkbox"
                                  checked={split.isUmsatz}
                                  disabled={!r.selected || isDuplicate}
                                  onChange={(e) => setSplit(i, split.id, { isUmsatz: e.target.checked })}
                                />
                                Umsatz
                              </label>
                              <button
                                className="btn btn--ghost btn--sm btn--danger"
                                disabled={!r.selected || isDuplicate || r.splits!.length <= 2}
                                onClick={() => removeSplit(i, split.id)}
                              >
                                Entfernen
                              </button>
                            </div>
                          ))}
                          <div className="toolbar">
                            <button
                              className="btn btn--ghost btn--sm"
                              disabled={!r.selected || isDuplicate}
                              onClick={() => addSplit(i)}
                            >
                              Teil hinzufügen
                            </button>
                            <button
                              className="btn btn--ghost btn--sm"
                              disabled={!r.selected || isDuplicate}
                              onClick={() => setRow(i, { splits: undefined })}
                            >
                              Split entfernen
                            </button>
                            <div className="toolbar__spacer" />
                            <span className={splitDiff === 0 ? 'hint' : 'hint split-editor__error'}>
                              Aufgeteilt: <Amount cents={splitTotal} /> / Original: <Amount cents={Math.abs(r.amount)} />
                              {splitDiff !== 0 && <> · Differenz: <Amount cents={splitDiff} /></>}
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 'var(--space-4)' }}>
            {invalidRows > 0 && (
              <p className="hint" style={{ margin: 0 }}>
                {invalidRows} ausgewählte Umsätze sind noch unvollständig oder Split-Summen passen nicht.
              </p>
            )}
            <div className="toolbar__spacer" />
            <button className="btn btn--primary" disabled={readyRows.length === 0} onClick={doImport}>
              {readyBookings} Buchungen übernehmen
            </button>
          </div>
        </section>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function bookingParts(row: ImportDraftRow): ImportDraftSplit[] {
  if (row.splits?.length) return row.splits
  return [
    {
      id: row.hash,
      description: row.description,
      categoryId: row.categoryId,
      amount: Math.abs(row.amount),
      isUmsatz: row.isUmsatz,
    },
  ]
}

function rowIsImportable(row: ImportDraftRow): boolean {
  const parts = bookingParts(row)
  if (!(row.name ?? '').trim()) return false
  if (parts.some((p) => !p.description.trim() || !p.categoryId || p.amount <= 0)) return false
  if (!row.splits?.length) return true
  return sumSplits(row.splits) === Math.abs(row.amount)
}

function sumSplits(splits: ImportDraftSplit[] | undefined): number {
  return splits?.reduce((sum, split) => sum + split.amount, 0) ?? 0
}
