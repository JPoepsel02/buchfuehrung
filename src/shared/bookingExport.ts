import { formatAmount, formatDate } from './money'
import { receiptStatus, receiptStatusLabel } from './receipt'
import type { ComputedBooking } from './types'

const HEADERS = [
  'Datum',
  'Beleg-Nr.',
  'Kategorie',
  'Unterkategorie',
  'Art',
  'Name',
  'Verwendungszweck',
  'Betrag (€)',
  'Umsatz (€)',
  'Belegstatus',
  'Herkunft',
  'Notiz',
]

function cell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Deutscher, Excel-freundlicher Export der sichtbaren Buchungen. */
export function bookingsToCsv(rows: readonly ComputedBooking[]): string {
  const lines = rows.map((row) =>
    [
      formatDate(row.date),
      row.ref,
      row.categoryName,
      row.subcategory ?? '',
      row.type === 'einnahme' ? 'Einnahme' : 'Ausgabe',
      row.name ?? '',
      row.description,
      formatAmount(row.signedAmount),
      row.isUmsatz ? formatAmount(row.umsatzAmount) : '',
      receiptStatusLabel(receiptStatus(row)),
      row.source === 'import' ? 'Import' : 'Manuell',
      row.note,
    ]
      .map((value) => cell(value))
      .join(';'),
  )
  return `\ufeff${HEADERS.join(';')}\r\n${lines.join('\r\n')}\r\n`
}
