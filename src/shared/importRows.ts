import { classifyDraftDuplicates } from './ledger'
import type { ImportDraftRow, YearFile } from './types'

/**
 * Klassifiziert immer den vollständigen Entwurf. Ursprüngliche Indizes und
 * ausgeblendete Zeilen bleiben erhalten, insbesondere für manuelle Treffer,
 * die pro bestehender Buchung nur einmal verbraucht werden dürfen.
 */
export function newImportRows(
  file: Pick<YearFile, 'bookings' | 'importDraft'>,
): Array<{ row: ImportDraftRow; index: number }> {
  const rows = file.importDraft?.rows ?? []
  const duplicates = classifyDraftDuplicates(file.bookings, rows)
  return rows.flatMap((row, index) =>
    duplicates.hard[index] || duplicates.soft[index] || duplicates.repeated[index]
      ? []
      : [{ row, index }],
  )
}
