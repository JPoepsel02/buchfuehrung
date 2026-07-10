import type { ImportDraftRow, ReceiptStatus, YearFile } from './types'

type ReceiptState = { receiptStatus?: ReceiptStatus; receiptAvailable?: boolean }

/**
 * Liest sowohl den neuen dreistufigen Status als auch das frühere
 * Wahr/Falsch-Feld. Buchungen ganz alter Versionen ohne Feld galten bislang
 * als "Beleg vorhanden" und behalten genau diese Bedeutung.
 */
export function receiptStatus(value: ReceiptState, fallback: ReceiptStatus = 'vorhanden'): ReceiptStatus {
  if (value.receiptStatus === 'vorhanden' || value.receiptStatus === 'offen' || value.receiptStatus === 'nicht_erforderlich') {
    return value.receiptStatus
  }
  if (value.receiptAvailable === true) return 'vorhanden'
  if (value.receiptAvailable === false) return 'offen'
  return fallback
}

/** Nur ein vorhandener Beleg erhält das Symbol im Prüfbericht. */
export function receiptAvailable(status: ReceiptStatus): boolean {
  return status === 'vorhanden'
}

export function receiptStatusLabel(status: ReceiptStatus): string {
  switch (status) {
    case 'vorhanden':
      return 'Beleg im Ordner vorhanden'
    case 'offen':
      return 'Beleg noch prüfen'
    case 'nicht_erforderlich':
      return 'Kein Beleg erforderlich'
  }
}

/** Schreibt den neuen Status und das alte Feld gemeinsam für ältere App-Versionen. */
export function withReceiptStatus<T extends object>(value: T & ReceiptState, status: ReceiptStatus): T & Required<ReceiptState> {
  return { ...value, receiptStatus: status, receiptAvailable: receiptAvailable(status) }
}

/**
 * Ergänzt den Status in bestehenden Jahresdateien. Die Migration ist
 * idempotent und verändert keine fachlichen Buchungswerte.
 */
export function migrateReceiptStatuses(file: YearFile): { file: YearFile; migratedCount: number } {
  let migratedCount = 0
  const normalizeBooking = <T extends object>(value: T & ReceiptState, fallback: ReceiptStatus): T & Required<ReceiptState> => {
    const status = receiptStatus(value, fallback)
    const available = receiptAvailable(status)
    if (value.receiptStatus === status && value.receiptAvailable === available) return value as T & Required<ReceiptState>
    migratedCount++
    return withReceiptStatus(value, status)
  }

  const bookings = file.bookings.map((booking) => normalizeBooking(booking, 'vorhanden'))
  const draft = file.importDraft
  const rows = draft?.rows.map((row) => normalizeBooking(row, 'offen'))
  const importDraft = draft && rows ? { ...draft, rows: rows as ImportDraftRow[] } : draft
  const next = migratedCount > 0 ? { ...file, bookings, importDraft } : file
  return { file: next, migratedCount }
}
