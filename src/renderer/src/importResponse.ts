import { appendToDraft, buildDraft } from '@shared/importDraft'
import { newImportRows } from '@shared/importRows'
import type { StatementRow } from '@shared/csv'
import type { YearFile } from '@shared/types'

/** Merge only against the target account's latest in-memory state. */
export function mergeImportResponse(file: YearFile, rows: readonly StatementRow[], sourceName: string, skipped: number) {
  const built = buildDraft(file, rows, sourceName, skipped)
  const reconciled = built.mutate(file)
  if (newImportRows(file).length === 0) {
    return { file: reconciled, freshCount: newImportRows(reconciled).length, messages: built.messages }
  }
  const appended = appendToDraft(file, rows, sourceName)
  const merged = appended.mutate(file)
  return { file: { ...merged, bookings: reconciled.bookings }, freshCount: appended.added, messages: built.messages }
}
