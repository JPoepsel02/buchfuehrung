import { formatDate } from './money'
import type { YearFile } from './types'

/**
 * Wirtschaftsjahr-Logik: Das Hauptkonto läuft Januar–Dezember, das
 * Zweitkonto kann abweichen (z. B. Karnevalskonto November–Oktober).
 * `year` einer Datei ist immer das Kalenderjahr, in dem das
 * Wirtschaftsjahr beginnt.
 */

type FiscalInfo = Pick<YearFile, 'year' | 'fiscalStartMonth'>

export function fiscalStartMonth(f: Pick<YearFile, 'fiscalStartMonth'>): number {
  const m = f.fiscalStartMonth ?? 1
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1
}

/** Anzeige-Label: "2026" bzw. "2025/2026" bei abweichendem Wirtschaftsjahr. */
export function fiscalLabel(f: FiscalInfo): string {
  return fiscalStartMonth(f) === 1 ? String(f.year) : `${f.year}/${f.year + 1}`
}

/** Erster und letzter Tag des Wirtschaftsjahres als ISO-Datum (inklusive). */
export function fiscalRange(f: FiscalInfo): { start: string; end: string } {
  const m = fiscalStartMonth(f)
  const start = `${f.year}-${String(m).padStart(2, '0')}-01`
  const endYear = m === 1 ? f.year : f.year + 1
  const endMonth = m === 1 ? 12 : m - 1
  const lastDay = new Date(endYear, endMonth, 0).getDate()
  const end = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export function inFiscalYear(f: FiscalInfo, isoDate: string): boolean {
  const { start, end } = fiscalRange(f)
  return isoDate >= start && isoDate <= end
}

/** Letzter Tag des Wirtschaftsjahres, deutsch formatiert ("31.10.2026"). */
export function fiscalEndLabel(f: FiscalInfo): string {
  return formatDate(fiscalRange(f).end)
}

/** Letzter Tag des VORHERIGEN Wirtschaftsjahres ("31.10.2025" / "31.12.2025"). */
export function prevFiscalEndLabel(f: FiscalInfo): string {
  return fiscalEndLabel({ year: f.year - 1, fiscalStartMonth: f.fiscalStartMonth })
}

/** Erster Tag des Wirtschaftsjahres, deutsch formatiert ("01.11.2025"). */
export function fiscalStartLabel(f: FiscalInfo): string {
  return formatDate(fiscalRange(f).start)
}
