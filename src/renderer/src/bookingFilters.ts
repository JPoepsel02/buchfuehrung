import { bookingMatches } from '@shared/ledger'
import { parseAmountToCents } from '@shared/money'
import { bookingMatchesSelectionFilter } from './bookingSelection'
import type { BookingType, ComputedBooking, YearFile } from '@shared/types'

export interface BookingFilters {
  categoryId: string
  amount: string
  subcategory: string
  type: '' | BookingType
  month: string
  umsatzOnly: boolean
}

export type BookingFilterPreset = Partial<Pick<BookingFilters, 'categoryId' | 'type' | 'month' | 'umsatzOnly'>>

export interface BookingFilterRequest {
  scope: string
  filters: BookingFilterPreset
  /** Expliziter Erfassungsauftrag, ohne die gespeicherte Ansicht zu ändern. */
  edit?: boolean
}

export function bookingScope(file: Pick<YearFile, 'konto' | 'year'>): string {
  return `${file.konto ?? 'haupt'}:${file.year}`
}

export function createBookingFilters(preset: BookingFilterPreset = {}): BookingFilters {
  return {
    categoryId: preset.categoryId ?? '', amount: '', subcategory: '',
    type: preset.type ?? '', month: preset.month ?? '', umsatzOnly: preset.umsatzOnly ?? false,
  }
}

export function hasBookingFilters(filter: BookingFilters): boolean {
  return Boolean(filter.categoryId || filter.amount.trim() || filter.subcategory || filter.type || filter.month || filter.umsatzOnly)
}

/** Dieselben sichtbaren Kriterien gelten für Liste, Mehrfachauswahl und CSV. */
export function filterBookings<T extends ComputedBooking>(rows: readonly T[], query: string, filter: BookingFilters): T[] {
  const amount = filter.amount.trim() ? parseAmountToCents(filter.amount) : null
  if (filter.amount.trim() && (amount === null || amount < 0)) return []
  return rows.filter((row) =>
    bookingMatches(row, query) &&
    bookingMatchesSelectionFilter(row, { categoryId: filter.categoryId, amount, subcategory: filter.subcategory }) &&
    (!filter.type || row.type === filter.type) &&
    (!filter.month || row.date.startsWith(`${filter.month}-`)) &&
    (!filter.umsatzOnly || row.umsatzAmount !== 0),
  )
}
