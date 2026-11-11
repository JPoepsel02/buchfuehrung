import { Fragment, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { shouldStartBookingEdit } from '../bookingRow'
import { Amount } from '../components/Amount'
import { CentsAmountInput } from '../components/AmountInput'
import { inFiscalYear } from '@shared/fiscal'
import { makeId } from '@shared/defaults'
import { bookingParts, clearImportSelection, rowIsImportable, subcategorySuggestions, sumSplits } from '@shared/importDraft'
import { importReceiptLabel } from '@shared/importReceipts'
import { newImportRows } from '@shared/importRows'
import { formatDate } from '@shared/money'
import { receiptStatus, withReceiptStatus } from '@shared/receipt'
import type { ImportDraftRow, ImportDraftSplit, ReceiptStatus } from '@shared/types'
import { ImportReviewDialog, importReviewRowMatches } from './ImportReviewDialog'
import type { ImportReviewSession } from './ImportReviewDialog'
import { ImportReviewAllocation, splitReviewAllocations } from './ImportReviewAllocation'
import '../styles/importReview.css'

/**
 * Zuweisungstabelle für den gespeicherten Import-Entwurf: Auswahl,
 * eigener Verwendungszweck, Kategorie, Splits, Duplikat-Kennzeichnung und
 * Übernahme als Buchungen. Wird vom Kontoauszug-Import (CSV) und vom
 * Online-Banking-Abruf gemeinsam genutzt.
 */
/** Sammel-Zuweisung: leere Felder bzw. "unverändert" lassen den Wert der Zeile unangetastet. */
interface BulkPatch {
  categoryId: string
  subcategory: string
  description: string
  name: string
  receiptStatus: '' | ReceiptStatus
  isUmsatz: '' | 'ja' | 'nein'
}

const EMPTY_BULK: BulkPatch = { categoryId: '', subcategory: '', description: '', name: '', receiptStatus: '', isUmsatz: '' }

export function ImportDraftCard({ onImported }: { onImported?(message: string): void } = {}) {
  const { file, update, organization, importDraft } = useStore()
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [review, setReview] = useState<ImportReviewSession | null>(null)
  const [bulk, setBulk] = useState<BulkPatch>(EMPTY_BULK)
  const scope = file ? `${file.konto ?? 'haupt'}:${file.year}` : ''

  useEffect(() => {
    update((current) => `${current.konto ?? 'haupt'}:${current.year}` === scope ? clearImportSelection(current) : current)
  }, [scope, update])

  const activeCats = useMemo(
    () => (file ? file.categories.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [file],
  )
  const freshRows = useMemo(() => file ? newImportRows(file) : [], [file])

  if (!file?.importDraft) return null
  const draft = file.importDraft
  const rowReady = (row: ImportDraftRow) => rowIsImportable(row) && bookingParts(row).every(part => file.categories.some(category => category.id === part.categoryId))

  function mutateRow(index: number, mutate: (row: ImportDraftRow) => ImportDraftRow) {
    const expected = draft.rows[index]
    if (!expected) return
    const target = { index, hash: expected.hash, date: expected.date, amount: expected.amount, bankText: expected.bankText }
    update(current => {
      const currentDraft = current.importDraft
      if (`${current.konto ?? 'haupt'}:${current.year}` !== scope || currentDraft?.fileName !== draft.fileName || !importReviewRowMatches(currentDraft.rows[index], target)) return current
      if (!inFiscalYear(current, target.date) || !newImportRows(current).some(entry => entry.index === index)) return current
      return { ...current, importDraft: { ...currentDraft, rows: currentDraft.rows.map((row, i) => i === index ? mutate(row) : row) } }
    })
  }
  function setRow(index: number, patch: Partial<ImportDraftRow>) {
    mutateRow(index, row => ({ ...row, ...patch }))
  }
  function startReview(index?: number, focusAllocations = false) {
    const targets = freshRows.filter(entry => inFiscalYear(file!, entry.row.date)).map(({ row, index: rowIndex }) => ({ index: rowIndex, hash: row.hash, date: row.date, amount: row.amount, bankText: row.bankText }))
    if (!targets.length) return
    const initialPosition = Math.max(0, targets.findIndex(target => target.index === index))
    setReview({ scope, fileName: draft.fileName, targets, initialPosition, focusAllocations })
  }

  function toggleRowSelection(index: number, hash: string) {
    if (draft.rows[index]?.hash !== hash) return
    mutateRow(index, row => ({ ...row, selected: !row.selected }))
  }

  function setSplit(rowIndex: number, splitId: string, patch: Partial<ImportDraftSplit>) {
    mutateRow(rowIndex, row => ({ ...row, splits: row.splits?.map(split => split.id === splitId ? { ...split, ...patch } : split) }))
  }

  function startSplit(index: number) {
    const row = draft.rows[index]
    if (!row) return
    const total = Math.abs(row.amount)
    const first = Math.floor(total / 2)
    const second = total - first
    const [firstAllocations, secondAllocations] = splitReviewAllocations(row.allocations, total, first)
    setRow(index, {
      splits: [
        {
          id: makeId(),
          description: row.description.trim(),
          categoryId: row.categoryId,
          amount: first,
          isUmsatz: row.isUmsatz,
          receiptRef: row.receiptRef,
          allocations: firstAllocations,
        },
        {
          id: makeId(),
          description: '',
          categoryId: row.categoryId,
          amount: second,
          isUmsatz: row.isUmsatz,
          allocations: secondAllocations,
        },
      ],
    })
  }

  function addSplit(index: number) {
    const row = draft.rows[index]
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
    const row = draft.rows[rowIndex]
    if (!row?.splits) return
    const next = row.splits.filter((s) => s.id !== splitId)
    setRow(rowIndex, { splits: next.length >= 2 ? next : undefined })
  }

  function setAllSelected(selected: boolean) {
    if (!selected) {
      update(current => `${current.konto ?? 'haupt'}:${current.year}` === scope && current.importDraft?.fileName === draft.fileName ? clearImportSelection(current) : current)
      return
    }
    update((f) => {
      if (!f.importDraft || `${f.konto ?? 'haupt'}:${f.year}` !== scope || f.importDraft.fileName !== draft.fileName) return f
      const freshIndices = new Set(newImportRows(f).map(({ index }) => index))
      return {
        ...f,
        importDraft: {
          ...f.importDraft,
          rows: f.importDraft.rows.map((r, i) => ({
            ...r, selected: freshIndices.has(i) && inFiscalYear(f, r.date),
          })),
        },
      }
    })
  }

  function discardDraft() {
    if (!confirm('Gespeicherten Import-Entwurf wirklich verwerfen?')) return
    update(f => `${f.konto ?? 'haupt'}:${f.year}` === scope && f.importDraft?.fileName === draft.fileName ? { ...f, importDraft: null } : f)
  }

  /** Wendet die Sammel-Zuweisung ausschließlich auf ausgewählte neue Zeilen an. */
  function applyBulk() {
    let touched = 0
    update((f) => {
      if (!f.importDraft || `${f.konto ?? 'haupt'}:${f.year}` !== scope || f.importDraft.fileName !== draft.fileName) return f
      const freshIndices = new Set(newImportRows(f).map(({ index }) => index))
      return {
        ...f,
        importDraft: {
          ...f.importDraft,
          rows: f.importDraft.rows.map((r, i) => {
            if (!r.selected || !freshIndices.has(i) || !inFiscalYear(f, r.date)) return r
            touched++
            const next = { ...r }
            // Kategorie/Verwendungszweck/Unterkategorie gelten nicht für aufgeteilte Zeilen
            if (!r.splits?.length) {
              if (bulk.categoryId) next.categoryId = bulk.categoryId
              if (bulk.subcategory.trim()) next.subcategory = bulk.subcategory.trim()
              if (bulk.description.trim()) next.description = bulk.description.trim()
              if (bulk.isUmsatz) next.isUmsatz = bulk.isUmsatz === 'ja'
            }
            if (bulk.name.trim()) next.name = bulk.name.trim()
            return bulk.receiptStatus ? withReceiptStatus(next, bulk.receiptStatus) : next
          }),
        },
      }
    })
    setToast(`Zuweisung auf ${touched} ausgewählte Umsätze angewendet.`)
    setTimeout(() => setToast(''), 4000)
  }

  const bulkHasValue =
    Boolean(bulk.categoryId || bulk.subcategory.trim() || bulk.description.trim() || bulk.name.trim()) ||
    bulk.receiptStatus !== '' ||
    bulk.isUmsatz !== ''

  /** Übernimmt alle ausgewählten Zeilen als Buchungen und entfernt sie aus dem Entwurf. */
  async function doImport() {
    const selectedRows = freshRows.filter(
      ({ row }) => row.selected && rowReady(row) && inFiscalYear(file!, row.date),
    )
    if (selectedRows.length === 0) return
    const importedBookingsCount = selectedRows.reduce((count, { row }) => count + bookingParts(row).length, 0)
    setImporting(true)
    setError('')
    try {
      await importDraft()
      const message = `${importedBookingsCount} Buchungen aus ${selectedRows.length} Bankpositionen importiert.`
      if (onImported) onImported(message)
      else { setToast(message); setTimeout(() => setToast(''), 4000) }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Die Buchungen konnten nicht übernommen werden.') }
    finally { setImporting(false) }
  }

  const selected = freshRows.map(({ row }) => row).filter((row) => row.selected)
  const invalidRows = selected.filter((r) => !rowReady(r)).length
  const readyRows = selected.filter((row) => rowReady(row) && inFiscalYear(file, row.date))
  const readyBookings = readyRows.reduce((count, r) => count + bookingParts(r).length, 0)
  const excludedCount = freshRows.filter(entry => !inFiscalYear(file, entry.row.date)).length
  const alreadyKnownCount = draft.rows.length - freshRows.length
  const reviewCount = freshRows.length - excludedCount

  return (
    <section className="card">
      <fieldset disabled={importing} className="import-draft-controls" aria-label="Importentwurf bearbeiten">
      <div className="toolbar import-draft-toolbar" style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className="card__title" style={{ marginBottom: 0 }}>
          {draft.fileName} · {freshRows.length} {freshRows.length === 1 ? 'neuer Umsatz' : 'neue Umsätze'}
        </h2>
        <div className="toolbar__spacer" />
        <button type="button" className="btn btn--primary btn--sm" disabled={!reviewCount || importing} onClick={() => startReview()}>Einzeln zuordnen</button>
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
      {(excludedCount > 0 || alreadyKnownCount > 0) && <p className="import-draft-note--excluded">{[alreadyKnownCount ? `${alreadyKnownCount} bereits bekannte Umsätze ausgeblendet` : '', excludedCount ? `${excludedCount} Umsätze außerhalb des Kassenjahres` : ''].filter(Boolean).join(' · ')}</p>}
      {error && <p className="org-error" role="alert">{error}</p>}
      {draft.skipped > 0 && (
        <p className="hint" style={{ marginTop: 0 }}>
          {draft.skipped} Zeilen konnten nicht gelesen werden (z. B. Kopf- oder Saldozeilen).
        </p>
      )}
      {selected.length > 1 && (
        <div className="bulkbar">
          <strong className="bulkbar__count">{selected.length} ausgewählt</strong>
          <select
            value={bulk.categoryId}
            onChange={(e) => setBulk({ ...bulk, categoryId: e.target.value })}
            aria-label="Kategorie für Auswahl"
          >
            <option value="">Kategorie unverändert</option>
            {activeCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            value={bulk.subcategory}
            onChange={(e) => setBulk({ ...bulk, subcategory: e.target.value })}
            placeholder="Unterkategorie"
            aria-label="Unterkategorie für Auswahl"
            list={bulk.categoryId ? `import-sub-suggestions-${bulk.categoryId}` : undefined}
          />
          <input
            value={bulk.description}
            onChange={(e) => setBulk({ ...bulk, description: e.target.value })}
            placeholder="Verwendungszweck"
            aria-label="Verwendungszweck für Auswahl"
          />
          <input
            value={bulk.name}
            onChange={(e) => setBulk({ ...bulk, name: e.target.value })}
            placeholder="Name"
            aria-label="Name für Auswahl"
          />
          <select
            value={bulk.receiptStatus}
            onChange={(e) => setBulk({ ...bulk, receiptStatus: e.target.value as BulkPatch['receiptStatus'] })}
            aria-label="Beleg für Auswahl"
          >
            <option value="">Beleg unverändert</option>
            <option value="vorhanden">Beleg vorhanden</option>
            <option value="offen">Beleg prüfen</option>
            <option value="nicht_erforderlich">Beleg: nicht erforderlich</option>
          </select>
          <select
            value={bulk.isUmsatz}
            onChange={(e) => setBulk({ ...bulk, isUmsatz: e.target.value as BulkPatch['isUmsatz'] })}
            aria-label="Umsatz für Auswahl"
          >
            <option value="">Umsatz unverändert</option>
            <option value="ja">zählt als Umsatz</option>
            <option value="nein">kein Umsatz</option>
          </select>
          <button className="btn btn--sm btn--primary" disabled={!bulkHasValue} onClick={applyBulk}>
            Auf Auswahl anwenden
          </button>
        </div>
      )}
      {activeCats.map((category) => (
        <datalist key={category.id} id={`import-sub-suggestions-${category.id}`}>
          {subcategorySuggestions(file.bookings, category.id, draft.rows).map((sName) => (
            <option key={sName} value={sName} />
          ))}
        </datalist>
      ))}
      <div className="import-draft-table-scroll"><table className="ledger import-draft-table">
        <thead>
          <tr>
            <th></th>
            <th>Datum</th>
            <th>Kontoauszug (Original)</th>
            <th>Name</th>
            <th>Eigener Verwendungszweck</th>
            <th className="num">Betrag</th>
            <th>Kategorie</th>
            <th>Beleg</th>
            <th>Umsatz</th>
          </tr>
        </thead>
        <tbody>
          {freshRows.map(({ row: r, index: i }) => {
            const inYear = inFiscalYear(file, r.date)
            const splitTotal = sumSplits(r.splits)
            const splitDiff = Math.abs(r.amount) - splitTotal
            return (
              <Fragment key={`${r.hash}-${i}`}>
              <tr className="import-row" aria-selected={r.selected}
                style={!inYear ? { opacity: 0.5 } : undefined}
                onClick={(event) => {
                  if (shouldStartBookingEdit(event.target as HTMLElement)) toggleRowSelection(i, r.hash)
                }}>
                <td>
                  <input
                    type="checkbox"
                    checked={r.selected}
                    disabled={!inYear || importing}
                    onChange={(e) => setRow(i, { selected: e.target.checked })}
                    aria-label="Umsatz importieren"
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {formatDate(r.date)}
                  {!inYear && (
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
                    disabled={!r.selected}
                    aria-label="Name"
                    aria-invalid={r.selected && !(r.name ?? '').trim()}
                    style={{ minWidth: 150, width: '100%' }}
                  />
                </td>
                <td>
                  <input
                    value={r.description}
                    onChange={(e) => setRow(i, { description: e.target.value })}
                    placeholder="Verwendungszweck"
                    disabled={!r.selected || Boolean(r.splits?.length)}
                    aria-label="Eigener Verwendungszweck"
                    aria-invalid={r.selected && !(r.splits?.length) && !r.description.trim()}
                    style={{ minWidth: 140, width: '100%' }}
                  />
                  {r.splits?.length ? (
                    <span className="pill" style={{ marginTop: 6 }}>
                      auf {r.splits.length} Buchungen aufgeteilt
                    </span>
                  ) : (
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ marginTop: 6 }}
                      disabled={!r.selected}
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
                    disabled={!r.selected || Boolean(r.splits?.length)}
                    aria-label="Kategorie"
                    aria-invalid={r.selected && !r.splits?.length && !r.categoryId}
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
                  {!r.splits?.length && (
                    <input
                      value={r.subcategory ?? ''}
                      onChange={(e) => setRow(i, { subcategory: e.target.value })}
                      placeholder="Unterkategorie (optional)"
                      disabled={!r.selected}
                      aria-label="Unterkategorie"
                      list={r.categoryId ? `import-sub-suggestions-${r.categoryId}` : undefined}
                      style={{ minWidth: 140, width: '100%', marginTop: 4, fontSize: 'var(--text-xs)' }}
                    />
                  )}
                  {!r.splits?.length && <ImportReviewAllocation amount={Math.abs(r.amount)} categoryId={r.categoryId} value={r.allocations} organization={organization} konto={file.konto ?? 'haupt'} disabled={!r.selected || !inYear} onChange={allocations => setRow(i, { allocations })} onOpenReview={() => startReview(i, true)} />}
                  <button type="button" className="btn btn--ghost btn--sm import-review-row-button" disabled={!inYear || importing} onClick={() => startReview(i)}>Einzeln zuordnen</button>
                </td>
                <td>
                  <select
                    value={receiptStatus(r, 'offen')}
                    disabled={!r.selected}
                    onChange={(e) => setRow(i, withReceiptStatus({}, e.target.value as ReceiptStatus))}
                    aria-label="Belegstatus"
                    style={{ maxWidth: 178 }}
                  >
                    <option value="vorhanden">Beleg vorhanden</option>
                    <option value="offen">Beleg prüfen</option>
                    <option value="nicht_erforderlich">Nicht erforderlich</option>
                  </select>
                  {receiptStatus(r, 'offen') === 'vorhanden' && (
                    <div role="status" style={{ marginTop: 6, whiteSpace: 'nowrap' }}>
                      {bookingParts(r).some((part) => importReceiptLabel(file, part)) && <>
                        Beleg-Nr. <strong>{bookingParts(r).map((part) => importReceiptLabel(file, part)).filter(Boolean).join(' · ')}</strong>
                      </>}
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.isUmsatz}
                    disabled={!r.selected || Boolean(r.splits?.length)}
                    onChange={(e) => setRow(i, { isUmsatz: e.target.checked })}
                    aria-label="Zählt als Umsatz"
                  />
                </td>
              </tr>
              {r.splits?.length ? (
                <tr key={`${r.hash}-${i}-splits`} className="split-row">
                  <td></td>
                  <td colSpan={8}>
                    <div className="split-editor">
                      {r.splits.map((split) => (
                        <div className="split-editor__line" key={split.id}>
                          <input
                            value={split.description}
                            onChange={(e) => setSplit(i, split.id, { description: e.target.value })}
                            placeholder="z. B. Getränke Event A"
                            disabled={!r.selected}
                            aria-label="Split-Verwendungszweck"
                            aria-invalid={r.selected && !split.description.trim()}
                          />
                          <div className="import-split-category"><select
                            value={split.categoryId}
                            onChange={(e) => setSplit(i, split.id, { categoryId: e.target.value })}
                            disabled={!r.selected}
                            aria-label="Split-Kategorie"
                            aria-invalid={r.selected && !split.categoryId}
                          >
                            <option value="" disabled>
                              – Kategorie wählen –
                            </option>
                            {activeCats.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select><ImportReviewAllocation amount={split.amount} categoryId={split.categoryId} value={split.allocations} organization={organization} konto={file.konto ?? 'haupt'} disabled={!r.selected || !inYear} label="Split-Tätigkeitsbereich" onChange={allocations => setSplit(i, split.id, { allocations })} onOpenReview={() => startReview(i, true)} /></div>
                          {receiptStatus(r, 'offen') === 'vorhanden' && importReceiptLabel(file, split) && (
                            <strong style={{ whiteSpace: 'nowrap' }}>{importReceiptLabel(file, split)}</strong>
                          )}
                          <CentsAmountInput
                            cents={split.amount}
                            disabled={!r.selected}
                            invalid={r.selected && split.amount <= 0}
                            onCommit={(amount) => setSplit(i, split.id, { amount })}
                            aria-label="Split-Betrag"
                            style={{ maxWidth: 120, textAlign: 'right' }}
                          />
                          <label className="split-editor__check">
                            <input
                              type="checkbox"
                              checked={split.isUmsatz}
                              disabled={!r.selected}
                              onChange={(e) => setSplit(i, split.id, { isUmsatz: e.target.checked })}
                            />
                            Umsatz
                          </label>
                          <button
                            className="btn btn--ghost btn--sm btn--danger"
                            disabled={!r.selected || r.splits!.length <= 2}
                            onClick={() => removeSplit(i, split.id)}
                          >
                            Entfernen
                          </button>
                        </div>
                      ))}
                      <div className="toolbar">
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={!r.selected}
                          onClick={() => addSplit(i)}
                        >
                          Teil hinzufügen
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={!r.selected}
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
      </table></div>
      <div className="toolbar" style={{ marginTop: 'var(--space-4)' }}>
        {invalidRows > 0 && (
          <p className="hint" style={{ margin: 0 }}>
            {invalidRows} ausgewählte Umsätze sind noch unvollständig oder Split-Summen passen nicht.
          </p>
        )}
        <div className="toolbar__spacer" />
        <button className="btn btn--primary" disabled={readyRows.length === 0 || importing} onClick={() => void doImport()}>
          {importing ? 'Übernimmt …' : `${readyBookings} Buchungen übernehmen`}
        </button>
      </div>
      </fieldset>
      {toast && <div className="toast">{toast}</div>}
      {review && <ImportReviewDialog session={review} onClose={() => setReview(null)} />}
    </section>
  )
}
