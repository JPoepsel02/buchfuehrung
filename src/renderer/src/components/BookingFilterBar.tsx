import { AmountField } from './AmountInput'
import type { Category } from '@shared/types'
import type { BookingFilters } from '../bookingFilters'

interface Props {
  filter: BookingFilters
  categories: Category[]
  months: Array<{ value: string; label: string }>
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

export function BookingFilterBar(props: Props) {
  const { filter, onChange } = props
  return (
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
        <label htmlFor="booking-filter-month">Monat</label>
        <select id="booking-filter-month" value={filter.month} onChange={(event) => onChange({ month: event.target.value })}>
          <option value="">Alle Monate</option>
          {props.months.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
        </select>
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
      <div className="booking-filterbar__actions">
        {props.active && <button className="btn btn--ghost btn--sm" type="button" onClick={props.onReset}>Filter zurücksetzen</button>}
        <button className="btn btn--primary btn--sm" type="button" disabled={props.count === 0 || props.amountInvalid} onClick={props.onSelectAll}>
          {props.count} Treffer auswählen
        </button>
        {props.selectedCount > 0 && <button className="btn btn--ghost btn--sm" type="button" onClick={props.onClearSelection}>Auswahl aufheben</button>}
      </div>
    </div>
  )
}
