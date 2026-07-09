import { Fragment, useMemo, useState } from 'react'
import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { CentsAmountInput } from '../components/AmountInput'
import { inFiscalYear } from '@shared/fiscal'
import { makeId } from '@shared/defaults'
import { receiptAvailableForImport, subcategorySuggestions } from '@shared/importDraft'
import { classifyDraftDuplicates, nextRefNo, nextSeq } from '@shared/ledger'
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
  receiptAvailable: '' | 'ja' | 'nein'
  isUmsatz: '' | 'ja' | 'nein'
}

const EMPTY_BULK: BulkPatch = { categoryId: '', subcategory: '', description: '', name: '', receiptAvailable: '', isUmsatz: '' }

export function ImportDraftCard() {
  const { file, update } = useStore()
  const [toast, setToast] = useState('')
  const [onlyNew, setOnlyNew] = useState(false)
  const [bulk, setBulk] = useState<BulkPatch>(EMPTY_BULK)

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

  if (!file?.importDraft) return null
  const draft = file.importDraft

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
    const current = draft.rows[rowIndex]
    if (!current?.splits) return
    setRow(rowIndex, {
      splits: current.splits.map((s) => (s.id === splitId ? { ...s, ...patch } : s)),
    })
  }

  function startSplit(index: number) {
    const row = draft.rows[index]
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

  /** Wendet die Sammel-Zuweisung auf alle ausgewählten (nicht gesperrten) Zeilen an. */
  function applyBulk() {
    const cls = classifyRows(file!.bookings, draft.rows)
    let touched = 0
    update((f) => {
      if (!f.importDraft) return f
      return {
        ...f,
        importDraft: {
          ...f.importDraft,
          rows: f.importDraft.rows.map((r, i) => {
            if (!r.selected || cls.hard[i]) return r
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
            if (bulk.receiptAvailable) next.receiptAvailable = bulk.receiptAvailable === 'ja'
            return next
          }),
        },
      }
    })
    setToast(`Zuweisung auf ${touched} ausgewählte Umsätze angewendet.`)
    setTimeout(() => setToast(''), 4000)
  }

  const bulkHasValue =
    Boolean(bulk.categoryId || bulk.subcategory.trim() || bulk.description.trim() || bulk.name.trim()) ||
    bulk.receiptAvailable !== '' ||
    bulk.isUmsatz !== ''

  /** Übernimmt alle ausgewählten Zeilen als Buchungen und entfernt sie aus dem Entwurf. */
  function doImport() {
    const selectedRows = draft.rows
      .map((r, i) => ({ row: r, index: i }))
      .filter(({ row, index }) => row.selected && rowIsImportable(row) && !dupes.hard[index])
    const selectedIdx = new Set(selectedRows.map(({ index }) => index))
    if (selectedIdx.size === 0) return
    const importedBookingsCount = selectedRows.reduce((count, { row }) => count + bookingParts(row).length, 0)
    update((f) => {
      if (!f.importDraft) return f
      let seq = nextSeq(f)
      // Feste Beleg-Nummern je Kategorie fortlaufend ab Maximum + 1 vergeben
      const refCounters = new Map<string, number>()
      const takeRefNo = (categoryId: string) => {
        const n = refCounters.get(categoryId) ?? nextRefNo(f, categoryId)
        refCounters.set(categoryId, n + 1)
        return n
      }
      const added = f.importDraft.rows
        .filter((_, i) => selectedIdx.has(i))
        .flatMap((r) =>
          bookingParts(r).map((part) => ({
            id: makeId(),
            seq: seq++,
            refNo: takeRefNo(part.categoryId),
            date: r.date,
            categoryId: part.categoryId,
            name: r.name.trim(),
            description: part.description.trim(),
            subcategory: r.splits?.length ? undefined : (r.subcategory ?? '').trim() || undefined,
            type: r.amount < 0 ? ('ausgabe' as const) : ('einnahme' as const),
            amount: part.amount,
            isUmsatz: part.isUmsatz,
            receiptAvailable: receiptAvailableForImport(r),
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

  const selected = draft.rows.filter((r, i) => r.selected && !dupes.hard[i])
  const invalidRows = selected.filter((r) => !rowIsImportable(r)).length
  const readyRows = selected.filter(rowIsImportable)
  const readyBookings = readyRows.reduce((count, r) => count + bookingParts(r).length, 0)
  // Bereits vorhandene Zeilen (Import oder manuell) – für Zähler und Filter
  const dupCount = dupes.hard.filter(Boolean).length + dupes.soft.filter(Boolean).length

  return (
    <section className="card">
      <div className="toolbar" style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className="card__title" style={{ marginBottom: 0 }}>
          {draft.fileName} · {draft.rows.length} offene Umsätze
          {dupCount > 0 && <span className="hint"> · {dupCount} bereits vorhanden</span>}
        </h2>
        <div className="toolbar__spacer" />
        {dupCount > 0 && (
          <label className="checkrow" style={{ marginRight: 'var(--space-2)' }}>
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            Nur neue anzeigen
          </label>
        )}
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
            value={bulk.receiptAvailable}
            onChange={(e) => setBulk({ ...bulk, receiptAvailable: e.target.value as BulkPatch['receiptAvailable'] })}
            aria-label="Beleg für Auswahl"
          >
            <option value="">Beleg unverändert</option>
            <option value="ja">Beleg: vorhanden</option>
            <option value="nein">Beleg: fehlt</option>
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
            <th>Beleg</th>
            <th>Umsatz</th>
          </tr>
        </thead>
        <tbody>
          {draft.rows
            .map((r, i) => ({ r, i }))
            .filter(({ i }) => !onlyNew || (!dupes.hard[i] && !dupes.soft[i]))
            .map(({ r, i }) => {
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
                  {!r.splits?.length && (
                    <input
                      value={r.subcategory ?? ''}
                      onChange={(e) => setRow(i, { subcategory: e.target.value })}
                      placeholder="Unterkategorie (optional)"
                      disabled={!r.selected || isDuplicate}
                      aria-label="Unterkategorie"
                      list={r.categoryId ? `import-sub-suggestions-${r.categoryId}` : undefined}
                      style={{ minWidth: 140, width: '100%', marginTop: 4, fontSize: 'var(--text-xs)' }}
                    />
                  )}
                </td>
                <td>
                  <label className="checkrow" style={{ whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      checked={receiptAvailableForImport(r)}
                      disabled={!r.selected || isDuplicate}
                      onChange={(e) => setRow(i, { receiptAvailable: e.target.checked })}
                      aria-label="Beleg vorhanden"
                    />
                    vorhanden
                  </label>
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
                  <td colSpan={8}>
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
      {toast && <div className="toast">{toast}</div>}
    </section>
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
