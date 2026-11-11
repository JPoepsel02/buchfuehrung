import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { categoryAllocations } from '@shared/organization'
import { bookingParts, draftAllocationError, rowIsImportable, subcategorySuggestions, sumSplits } from '@shared/importDraft'
import { importReceiptLabel } from '@shared/importReceipts'
import { newImportRows } from '@shared/importRows'
import { inFiscalYear } from '@shared/fiscal'
import { makeId } from '@shared/defaults'
import { formatDate, formatEur } from '@shared/money'
import { receiptStatus, withReceiptStatus } from '@shared/receipt'
import type { ActivityAllocation, OrganizationConfig } from '@shared/organization'
import type { ImportDraftRow, ImportDraftSplit, ReceiptStatus, YearFile } from '@shared/types'
import { ActivityAllocationEditor } from '../components/ActivityAllocationEditor'
import { CentsAmountInput } from '../components/AmountInput'
import { Icon } from '../components/Icon'
import { useStore } from '../store'
import { splitReviewAllocations } from './ImportReviewAllocation'

export interface ImportReviewTarget {
  index: number
  hash: string
  date: string
  amount: number
  bankText: string
}
export interface ImportReviewSession {
  scope: string
  fileName: string
  targets: ImportReviewTarget[]
  initialPosition: number
  focusAllocations?: boolean
}

export function importReviewRowMatches(row: ImportDraftRow | undefined, target: ImportReviewTarget): row is ImportDraftRow {
  return Boolean(row && row.hash === target.hash && row.date === target.date && row.amount === target.amount && row.bankText === target.bankText)
}

export function ImportReviewDialog({ session, onClose }: { session: ImportReviewSession; onClose(): void }) {
  const { file, update, organization } = useStore()
  const [position, setPosition] = useState(session.initialPosition)
  const [attempted, setAttempted] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const target = session.targets[position]
  const scopeMatches = Boolean(file && `${file.konto ?? 'haupt'}:${file.year}` === session.scope && file.importDraft?.fileName === session.fileName)
  const candidate = scopeMatches ? file?.importDraft?.rows[target.index] : undefined
  const fresh = useMemo(() => file ? new Set(newImportRows(file).map(entry => entry.index)) : new Set<number>(), [file])
  const row = file && importReviewRowMatches(candidate, target) && fresh.has(target.index) && inFiscalYear(file, candidate.date) ? candidate : undefined
  const last = position === session.targets.length - 1
  const validCategoryIds = new Set(file?.categories.map(category => category.id) ?? [])
  const parts = row ? bookingParts(row) : []
  const allocationsValid = parts.every(part => !draftAllocationError(part.amount, part.allocations))
  const valid = Boolean(row && rowIsImportable(row) && parts.every(part => validCategoryIds.has(part.categoryId)) && allocationsValid)
  const invalidReason = !row ? 'Dieser Umsatz ist nicht mehr im offenen Entwurf vorhanden.'
    : !Number.isSafeInteger(row.amount) || row.amount === 0 ? 'Der Bankbetrag ist ungültig.'
      : !(row.name ?? '').trim() ? 'Name ergänzen.'
      : parts.some(part => !part.description.trim()) ? 'Verwendungszweck für jede Buchung ergänzen.'
        : parts.some(part => !validCategoryIds.has(part.categoryId)) ? 'Für jede Buchung eine Kategorie wählen.'
          : parts.some(part => !Number.isSafeInteger(part.amount) || part.amount <= 0) ? 'Für jede Buchung einen positiven Betrag angeben.'
          : row.splits?.length && sumSplits(row.splits) !== Math.abs(row.amount) ? 'Die Buchungsbeträge müssen genau dem Bankbetrag entsprechen.'
            : !allocationsValid ? 'Die Teilbeträge der Tätigkeitsbereiche müssen dem jeweiligen Buchungsbetrag entsprechen.' : ''

  useEffect(() => {
    const previous = document.activeElement
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    if (session.focusAllocations) editorRef.current?.querySelector<HTMLElement>('select,button,input')?.focus()
    else headingRef.current?.focus()
    return () => {
      if (dialog?.open) dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [session.focusAllocations])

  function mutateRow(mutate: (current: ImportDraftRow) => ImportDraftRow) {
    update(current => {
      const draft = current.importDraft
      if (`${current.konto ?? 'haupt'}:${current.year}` !== session.scope || draft?.fileName !== session.fileName || !importReviewRowMatches(draft.rows[target.index], target)) return current
      if (!inFiscalYear(current, target.date) || !newImportRows(current).some(entry => entry.index === target.index)) return current
      return { ...current, importDraft: { ...draft, rows: draft.rows.map((entry, index) => index === target.index ? mutate(entry) : entry) } }
    })
  }
  function patchRow(patch: Partial<ImportDraftRow>) { mutateRow(current => ({ ...current, ...patch })) }
  function patchSplit(id: string, patch: Partial<ImportDraftSplit>) {
    mutateRow(current => ({ ...current, splits: current.splits?.map(split => split.id === id ? { ...split, ...patch } : split) }))
  }
  function next(selected: boolean) {
    if (selected && !valid) { setAttempted(true); return }
    if (row) patchRow({ selected })
    if (last) onClose()
    else {
      setPosition(value => value + 1)
      setAttempted(false)
      bodyRef.current?.scrollTo({ top: 0 })
      headingRef.current?.focus()
    }
  }
  function previous() {
    setPosition(value => Math.max(0, value - 1))
    setAttempted(false)
    bodyRef.current?.scrollTo({ top: 0 })
    headingRef.current?.focus()
  }
  function startSplit() {
    if (!row) return
    const total = Math.abs(row.amount)
    const first = Math.floor(total / 2)
    const [firstAllocations, secondAllocations] = splitReviewAllocations(row.allocations, total, first)
    patchRow({ splits: [
      { id: makeId(), description: row.description.trim(), categoryId: row.categoryId, amount: first, isUmsatz: row.isUmsatz, receiptRef: row.receiptRef,
        allocations: firstAllocations },
      { id: makeId(), description: '', categoryId: row.categoryId, amount: total - first, isUmsatz: row.isUmsatz, allocations: secondAllocations },
    ] })
  }
  function addSplit() {
    if (!row?.splits) return
    patchRow({ splits: [...row.splits, { id: makeId(), description: '', categoryId: row.categoryId, amount: 0, isUmsatz: row.isUmsatz }] })
  }
  function removeSplit(id: string) {
    if (!row?.splits || row.splits.length <= 2) return
    patchRow({ splits: row.splits.filter(part => part.id !== id) })
  }

  const dialog = <dialog className="import-review-dialog" ref={dialogRef} aria-label="Umsätze einzeln zuordnen" aria-describedby="import-review-progress" onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
    if (!controls?.length) return
    const first = controls[0], lastControl = controls[controls.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { event.preventDefault(); lastControl.focus() }
    else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); first.focus() }
  }}>
    <header className="import-review-header"><div><p id="import-review-progress" aria-live="polite" aria-atomic="true">Umsatz {position + 1} von {session.targets.length}</p><h2 ref={headingRef} tabIndex={-1} aria-describedby="import-review-progress">Umsatz zuordnen</h2></div><button className="btn btn--ghost" type="button" onClick={onClose}><Icon name="close" size={17} />Schließen</button></header>
    <div className="import-review-progress" aria-hidden="true"><span style={{ width: `${(position + 1) / session.targets.length * 100}%` }} /></div>
    <div className="import-review-body" ref={bodyRef}>
      {row && file ? <>
        <aside className="import-review-source" aria-label="Angaben aus dem Kontoauszug">
          <div className="import-review-source__top"><span>{formatDate(row.date)}</span><span className="pill">{row.amount < 0 ? 'Ausgabe' : 'Einnahme'}</span></div>
          <div className={`import-review-source__amount ${row.amount < 0 ? 'amount--out' : 'amount--in'}`}>{row.amount > 0 ? '+' : ''}{formatEur(row.amount)}</div>
          <div className="import-review-source__name">{row.bankName || '—'}</div>
          <h3>Kontoauszug (Original)</h3><p className="import-review-source__text">{row.bankText || '—'}</p>
          <span className="import-review-source__file">{session.fileName}</span>
        </aside>
        <form id="import-review-form" className="import-review-form" noValidate onSubmit={event => { event.preventDefault(); next(true) }}>
          <div className="field"><label htmlFor="import-review-name">Name</label><input id="import-review-name" aria-label="Name" value={row.name ?? ''} onChange={event => patchRow({ name: event.target.value })} aria-invalid={attempted && !(row.name ?? '').trim()} autoComplete="off" /></div>
          {!row.splits?.length ? <>
            <div className="field"><label htmlFor="import-review-description">Eigener Verwendungszweck</label><input id="import-review-description" aria-label="Eigener Verwendungszweck" value={row.description} onChange={event => patchRow({ description: event.target.value })} aria-invalid={attempted && !row.description.trim()} autoComplete="off" /></div>
            <div className="import-review-fields"><CategoryField value={row.categoryId} file={file} onChange={value => patchRow({ categoryId: value })} /><div className="field"><label htmlFor="import-review-subcategory">Unterkategorie</label><input id="import-review-subcategory" aria-label="Unterkategorie" value={row.subcategory ?? ''} onChange={event => patchRow({ subcategory: event.target.value })} list="import-review-subcategories" /><datalist id="import-review-subcategories">{subcategorySuggestions(file.bookings, row.categoryId, file.importDraft?.rows).map(value => <option key={value} value={value} />)}</datalist></div></div>
            <div ref={editorRef}><ReviewAllocations amount={Math.abs(row.amount)} categoryId={row.categoryId} allocations={row.allocations} organization={organization} konto={file.konto ?? 'haupt'} onChange={allocations => patchRow({ allocations })} /></div>
            <label className="checkrow"><input type="checkbox" checked={row.isUmsatz} onChange={event => patchRow({ isUmsatz: event.target.checked })} aria-label="Zählt als Umsatz" />Zählt als Umsatz</label>
            <button type="button" className="btn btn--ghost btn--sm" onClick={startSplit}><Icon name="plus" size={15} />Auf mehrere Buchungen aufteilen</button>
          </> : <div className="import-review-splits" ref={editorRef}>
            <div className="import-review-splits__heading"><h3>{row.splits.length} Buchungen</h3><button type="button" className="btn btn--ghost btn--sm" onClick={() => patchRow({ splits: undefined })}>Aufteilung entfernen</button></div>
            {row.splits.map((split, index) => <section className="import-review-split" key={split.id} aria-label={`Buchung ${index + 1}`}>
              <div className="import-review-split__heading"><h3>Buchung {index + 1}</h3>{row.splits!.length > 2 && <button type="button" className="icon-button" aria-label={`Buchung ${index + 1} entfernen`} onClick={() => removeSplit(split.id)}><Icon name="close" size={16} /></button>}</div>
              <div className="field"><label htmlFor={`import-review-description-${split.id}`}>Verwendungszweck</label><input id={`import-review-description-${split.id}`} aria-label={`Verwendungszweck Buchung ${index + 1}`} value={split.description} onChange={event => patchSplit(split.id, { description: event.target.value })} /></div>
              <div className="import-review-fields"><CategoryField value={split.categoryId} file={file} label={`Kategorie Buchung ${index + 1}`} id={`import-review-category-${split.id}`} onChange={value => patchSplit(split.id, { categoryId: value })} /><label className="field"><span>Betrag in €</span><CentsAmountInput cents={split.amount} onCommit={amount => patchSplit(split.id, { amount })} aria-label={`Betrag Buchung ${index + 1}`} invalid={split.amount <= 0} /></label></div>
              <ReviewAllocations amount={split.amount} categoryId={split.categoryId} allocations={split.allocations} organization={organization} konto={file.konto ?? 'haupt'} onChange={allocations => patchSplit(split.id, { allocations })} />
              <div className="import-review-split__footer"><label className="checkrow"><input type="checkbox" checked={split.isUmsatz} onChange={event => patchSplit(split.id, { isUmsatz: event.target.checked })} aria-label={`Zählt als Umsatz Buchung ${index + 1}`} />Zählt als Umsatz</label>{receiptStatus(row, 'offen') === 'vorhanden' && <ReceiptNumber file={file} part={split} />}</div>
            </section>)}
            <div className="import-review-split-total"><span>Aufgeteilt</span><strong className={sumSplits(row.splits) !== Math.abs(row.amount) ? 'amount--out' : ''}>{formatEur(sumSplits(row.splits))} / {formatEur(Math.abs(row.amount))}</strong></div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={addSplit}><Icon name="plus" size={15} />Buchung hinzufügen</button>
          </div>}
          <div className="import-review-receipt"><label className="field"><span>Belegstatus</span><select value={receiptStatus(row, 'offen')} aria-label="Belegstatus" onChange={event => mutateRow(current => withReceiptStatus(current, event.target.value as ReceiptStatus))}><option value="vorhanden">Beleg vorhanden</option><option value="offen">Beleg prüfen</option><option value="nicht_erforderlich">Nicht erforderlich</option></select></label>{receiptStatus(row, 'offen') === 'vorhanden' && !row.splits?.length && <ReceiptNumber file={file} part={row} />}</div>
          {!valid && <p className="import-review-validation" role="status" id="import-review-validation">{invalidReason}</p>}
        </form>
      </> : <div className="import-review-unavailable" role="status"><Icon name="check" size={28} /><h3>Umsatz nicht mehr offen</h3><p>Der Umsatz wurde bereits übernommen oder der Entwurf wurde geändert.</p></div>}
    </div>
    <footer className="import-review-footer"><button type="button" className="btn" disabled={position === 0} onClick={previous}>Zurück</button><div className="import-review-footer__actions"><button type="button" className="btn btn--ghost" onClick={() => next(false)}>Überspringen</button><button type="submit" form="import-review-form" className="btn btn--primary" disabled={!valid} aria-describedby={!valid ? 'import-review-validation' : undefined}>{last ? 'Zur Übersicht' : 'Weiter'}<Icon name="arrow" size={16} /></button></div></footer>
  </dialog>
  return createPortal(dialog, document.body)
}

function CategoryField({ value, file, onChange, label = 'Kategorie', id = 'import-review-category' }: { value: string; file: YearFile; onChange(value: string): void; label?: string; id?: string }) {
  const categories = file.categories.filter(category => category.active || category.id === value).sort((a, b) => a.sortOrder - b.sortOrder)
  return <label className="field" htmlFor={id}><span>Kategorie</span><select id={id} aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Kategorie wählen</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
}

function ReviewAllocations({ amount, categoryId, allocations, organization, konto, onChange }: { amount: number; categoryId: string; allocations?: ActivityAllocation[]; organization: OrganizationConfig; konto: string; onChange(value: ActivityAllocation[] | undefined): void }) {
  const effective = allocations ?? categoryAllocations(organization, konto, categoryId, amount)
  return <div className="import-review-allocation"><ActivityAllocationEditor amount={amount} value={effective} onChange={onChange} />{allocations !== undefined && <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(undefined)}>Kategorie-Vorgabe verwenden</button>}</div>
}

function ReceiptNumber({ file, part }: { file: YearFile; part: Pick<ImportDraftSplit, 'categoryId' | 'receiptRef'> }) {
  const number = importReceiptLabel(file, part)
  return <span className="import-review-receipt-number" role="status">Beleg-Nr. <strong>{number ?? 'Kategorie wählen'}</strong></span>
}
