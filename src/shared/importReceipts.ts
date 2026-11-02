import { inFiscalYear } from './fiscal'
import { checkedRefNo, computeBookings } from './ledger'
import { newImportRows } from './importRows'
import { receiptStatus } from './receipt'
import type { ImportDraftRow, ImportDraftSplit, ImportReceiptReference, YearFile } from './types'

type ReceiptPart = Pick<ImportDraftSplit, 'categoryId' | 'receiptRef'>

function validReference(ref: ImportReceiptReference | undefined): ref is ImportReceiptReference {
  return Boolean(ref?.categoryId && Number.isSafeInteger(ref.refNo) && ref.refNo > 0)
}

function parts(row: ImportDraftRow): ReceiptPart[] {
  return row.splits?.length ? row.splits : [row]
}

/** Zeigt dieselbe feste Nummer, die beim Übernehmen in die Buchung gelangt. */
export function importReceiptLabel(file: YearFile, part: ReceiptPart): string | undefined {
  const ref = part.receiptRef
  if (!validReference(ref) || ref.categoryId !== part.categoryId) return undefined
  const category = file.categories.find((c) => c.id === ref.categoryId)
  return category ? `${category.code}${ref.refNo}` : undefined
}

function countersFor(file: YearFile): Map<string, number> {
  const counters = new Map<string, number>()
  const remember = (categoryId: string, refNo: number) => {
    if (Number.isSafeInteger(refNo) && refNo > 0) {
      counters.set(categoryId, Math.max(counters.get(categoryId) ?? 0, refNo))
    }
  }
  for (const [categoryId, refNo] of Object.entries(file.refNoCounters ?? {})) remember(categoryId, refNo)
  for (const booking of computeBookings(file)) remember(booking.categoryId, booking.refNo)
  for (const row of file.importDraft?.rows ?? []) {
    for (const ref of [row.receiptRef, ...(row.splits?.map((s) => s.receiptRef) ?? [])]) {
      if (validReference(ref)) remember(ref.categoryId, ref.refNo)
    }
  }
  return counters
}

/** Bestehende Reservierungen zuerst schützen, bevor weitere Zeilen Nummern bekommen. */
function existingReferences(file: YearFile): Map<ReceiptPart, ImportReceiptReference> {
  const used = new Set(computeBookings(file).map((b) => JSON.stringify([b.categoryId, b.refNo])))
  const kept = new Map<ReceiptPart, ImportReceiptReference>()
  for (const row of file.importDraft?.rows ?? []) {
    for (const part of parts(row)) {
      const ref = part.receiptRef
      if (!validReference(ref) || ref.categoryId !== part.categoryId) continue
      const key = JSON.stringify([ref.categoryId, ref.refNo])
      if (used.has(key)) continue
      used.add(key)
      kept.set(part, ref)
    }
  }
  return kept
}

/**
 * Reserviert Nummern beim Vorliegen von Kategorie und Papierbeleg, unabhängig
 * von Auswahl und noch fehlenden Texten. Zähler bleiben auch beim Verwerfen
 * oder Löschen erhalten, damit beschriftete Nummern nicht erneut vergeben werden.
 */
export function reserveImportReceiptNumbers(file: YearFile): YearFile {
  const counters = countersFor(file)
  const kept = existingReferences(file)
  const categoryIds = new Set(file.categories.map((c) => c.id))
  const draft = file.importDraft
  const freshIndices = new Set(newImportRows(file).map(({ index }) => index))
  const rows = draft?.rows.map((row, index) => {
    const canReserve = receiptStatus(row, 'offen') === 'vorhanden' &&
      freshIndices.has(index) && inFiscalYear(file, row.date)
    const assign = <T extends ReceiptPart>(part: T): T => {
      let receiptRef = kept.get(part)
      if (!receiptRef && canReserve && categoryIds.has(part.categoryId)) {
        const refNo = checkedRefNo((counters.get(part.categoryId) ?? 0) + 1)
        counters.set(part.categoryId, refNo)
        receiptRef = { categoryId: part.categoryId, refNo }
      }
      return receiptRef === part.receiptRef ? part : { ...part, receiptRef }
    }
    if (!row.splits?.length) return assign(row)
    const splits = row.splits.map(assign)
    return splits.every((part, i) => part === row.splits![i]) ? row : { ...row, splits }
  })
  const refNoCounters = Object.fromEntries(counters)
  const countersChanged = Object.keys(refNoCounters).length !== Object.keys(file.refNoCounters ?? {}).length ||
    Object.entries(refNoCounters).some(([key, value]) => file.refNoCounters?.[key] !== value)
  const rowsChanged = rows?.some((row, i) => row !== draft?.rows[i]) ?? false
  if (!countersChanged && !rowsChanged) return file
  return {
    ...file,
    ...(countersChanged ? { refNoCounters } : {}),
    ...(draft && rowsChanged ? { importDraft: { ...draft, rows: rows! } } : {}),
  }
}
