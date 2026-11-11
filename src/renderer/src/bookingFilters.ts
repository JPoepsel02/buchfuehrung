import { bookingMatches } from '@shared/ledger'
import { parseAmountToCents } from '@shared/money'
import { receiptStatus } from '@shared/receipt'
import { bookingMatchesSelectionFilter } from './bookingSelection'
import type { BookingType, ComputedBooking, ReceiptStatus, YearFile } from '@shared/types'

export interface BookingFilters {
  categoryId: string
  amount: string
  subcategory: string
  type: '' | BookingType
  receiptStatus: '' | ReceiptStatus
  dateFrom: string
  dateTo: string
  umsatzOnly: boolean
}

export type BookingFilterPreset = Partial<Pick<BookingFilters, 'categoryId' | 'type' | 'dateFrom' | 'dateTo' | 'umsatzOnly'>>

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
    categoryId: preset.categoryId ?? '', amount: '', subcategory: '', receiptStatus: '',
    type: preset.type ?? '', dateFrom: preset.dateFrom ?? '', dateTo: preset.dateTo ?? '', umsatzOnly: preset.umsatzOnly ?? false,
  }
}

export function hasBookingFilters(filter: BookingFilters): boolean {
  return Boolean(filter.categoryId || filter.amount.trim() || filter.subcategory || filter.type || filter.receiptStatus || filter.dateFrom || filter.dateTo || filter.umsatzOnly)
}

/** Dieselben sichtbaren Kriterien gelten für Liste, Mehrfachauswahl und CSV. */
export function filterBookings<T extends ComputedBooking>(rows: readonly T[], query: string, filter: BookingFilters): T[] {
  const amount = filter.amount.trim() ? parseAmountToCents(filter.amount) : null
  if ((filter.amount.trim() && (amount === null || amount < 0)) || invalidBookingDateRange(filter)) return []
  return rows.filter((row) =>
    bookingMatches(row, query) &&
    bookingMatchesSelectionFilter(row, { categoryId: filter.categoryId, amount, subcategory: filter.subcategory }) &&
    (!filter.type || row.type === filter.type) &&
    (!filter.receiptStatus || receiptStatus(row) === filter.receiptStatus) &&
    (!filter.dateFrom || row.date >= filter.dateFrom) &&
    (!filter.dateTo || row.date <= filter.dateTo) &&
    (!filter.umsatzOnly || row.umsatzAmount !== 0),
  )
}

/** Kalendergrenzen ohne lokale Zeitzonenverschiebung, auch im Schaltjahr. */
export function calendarMonthFilters(year: number, month: number): Pick<BookingFilters, 'dateFrom' | 'dateTo'> {
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('Ungültiger Kalendermonat.')
  }
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { dateFrom: `${prefix}-01`, dateTo: `${prefix}-${lastDay}` }
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const value = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date
}

export function invalidBookingDateRange(filter: Pick<BookingFilters, 'dateFrom' | 'dateTo'>): boolean {
  return Boolean(
    (filter.dateFrom && !validDate(filter.dateFrom)) ||
    (filter.dateTo && !validDate(filter.dateTo)) ||
    (filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo),
  )
}
