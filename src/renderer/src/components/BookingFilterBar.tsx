import { useEffect, useState } from 'react'
import { AmountField } from './AmountInput'
import type { Category } from '@shared/types'
import { invalidBookingDateRange, type BookingFilters } from '../bookingFilters'
import { formatDate } from '@shared/money'

interface Props {
  compact?: boolean
  query?: string
  filter: BookingFilters
  categories: Category[]
  subcategories: string[]
  amountInvalid: boolean
  active: boolean
  count: number
  selectedCount: number
  onChange(patch: Partial<BookingFilters>): void
  onReset(): void
  onSelectAll(): void
  onClearSelection(): void
}

function filterSummary(props: Props): string {
  const f = props.filter
  return [
    f.categoryId && (props.categories.find((c) => c.id === f.categoryId)?.name ?? 'Kategorie'),
    f.type && (f.type === 'einnahme' ? 'Nur Einnahmen' : 'Nur Ausgaben'),
    f.dateFrom && `Von ${formatDate(f.dateFrom)}`,
    f.dateTo && `Bis ${formatDate(f.dateTo)}`,
    f.amount.trim() && `Betrag: ${f.amount} €`,
    f.subcategory,
    f.umsatzOnly && 'Nur Umsatzbuchungen',
    props.query?.trim() && `Suche: ${props.query.trim()}`,
  ].filter(Boolean).join(' · ') || 'Alle Buchungen'
}

export function BookingFilterBar(props: Props) {
  const { filter, onChange } = props
  const [expanded, setExpanded] = useState(false)
  const datesInvalid = invalidBookingDateRange(filter)
  useEffect(() => {
    if (props.compact) setExpanded(false)
  }, [props.compact])
  return (
    <>
    {props.compact && <div className="booking-filter-summary">
      <span className="booking-filter-summary__text">{filterSummary(props)}</span>
      {props.active && <button className="btn btn--ghost btn--sm" type="button" onClick={props.onReset}>Filter zurücksetzen</button>}
      <button type="button" className="btn btn--sm" aria-expanded={expanded} aria-controls="booking-filter-fields"
        onClick={() => setExpanded((value) => !value)}>{expanded ? 'Filter ausblenden' : 'Filter anzeigen'}</button>
    </div>}
    <div id="booking-filter-fields" hidden={props.compact && !expanded}>
    <div className="booking-filterbar">
      <div className="field">
        <label htmlFor="booking-filter-category">Kategorie</label>
        <select id="booking-filter-category" value={filter.categoryId}
          onChange={(event) => onChange({ categoryId: event.target.value, subcategory: '' })}>
          <option value="">Alle Kategorien</option>
          {[...props.categories].sort((a, b) => a.sortOrder - b.sortOrder).map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="booking-filter-type">Buchungsart</label>
        <select id="booking-filter-type" value={filter.type}
          onChange={(event) => onChange({ type: event.target.value as BookingFilters['type'] })}>
          <option value="">Einnahmen und Ausgaben</option>
          <option value="einnahme">Nur Einnahmen</option>
          <option value="ausgabe">Nur Ausgaben</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="booking-filter-from">Von</label>
        <input id="booking-filter-from" type="date" value={filter.dateFrom}
          aria-invalid={datesInvalid} aria-describedby={datesInvalid ? 'booking-date-error' : undefined}
          onChange={(event) => onChange({ dateFrom: event.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="booking-filter-to">Bis</label>
        <input id="booking-filter-to" type="date" value={filter.dateTo}
          aria-invalid={datesInvalid} aria-describedby={datesInvalid ? 'booking-date-error' : undefined}
          onChange={(event) => onChange({ dateTo: event.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="booking-filter-amount">Betragshöhe exakt (€)</label>
        <AmountField id="booking-filter-amount" value={filter.amount}
          onChange={(amount) => onChange({ amount })} invalid={props.amountInvalid} placeholder="z. B. 70,00" />
      </div>
      <div className="field">
        <label htmlFor="booking-filter-subcategory">Unterkategorie</label>
        <select id="booking-filter-subcategory" value={filter.subcategory}
          onChange={(event) => onChange({ subcategory: event.target.value })}>
          <option value="">Alle Unterkategorien</option>
          {props.subcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
        </select>
      </div>
      <label className="checkrow booking-filterbar__check">
        <input type="checkbox" checked={filter.umsatzOnly} onChange={(event) => onChange({ umsatzOnly: event.target.checked })} />
        Nur Umsatzbuchungen
      </label>
      {!props.compact && <div className="booking-filterbar__actions">
        {props.active && <button className="btn btn--ghost btn--sm" type="button" onClick={props.onReset}>Filter zurücksetzen</button>}
        <button className="btn btn--primary btn--sm" type="button" disabled={props.count === 0 || props.amountInvalid} onClick={props.onSelectAll}>
          {props.count} Treffer auswählen
        </button>
        {props.selectedCount > 0 && <button className="btn btn--ghost btn--sm" type="button" onClick={props.onClearSelection}>Auswahl aufheben</button>}
      </div>}
    </div>
    {datesInvalid && <p id="booking-date-error" className="hint" role="alert">Bitte einen gültigen Zeitraum wählen: Von darf nicht nach Bis liegen.</p>}
    </div>
    </>
  )
}
