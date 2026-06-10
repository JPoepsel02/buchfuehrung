import type { Cents } from './types'

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const NUM = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatEur(cents: Cents): string {
  return EUR.format(normalize(cents) / 100)
}

/** Ohne €-Zeichen, für Tabellen mit eigener Einheiten-Spalte. */
export function formatAmount(cents: Cents): string {
  return NUM.format(normalize(cents) / 100)
}

/** Verhindert die Anzeige von "-0,00" bei negativer Null. */
function normalize(cents: Cents): Cents {
  return cents === 0 ? 0 : cents
}

/**
 * Parst deutsche Betragseingaben ("1.234,56", "12,5", "300") zu Cent.
 * Gibt null zurück, wenn die Eingabe kein gültiger Betrag ist.
 */
export function parseAmountToCents(input: string): Cents | null {
  const raw = input.trim().replace(/€/g, '').replace(/\s/g, '')
  if (!raw) return null
  // Deutsches Format: Punkt = Tausender, Komma = Dezimal.
  // Englisches Format mit Dezimalpunkt ("12.50") wird ebenfalls akzeptiert,
  // solange es nicht mit Tausenderpunkten kollidiert.
  let normalized: string
  if (raw.includes(',')) {
    normalized = raw.replace(/\./g, '').replace(',', '.')
  } else if (/^\-?\d+\.\d{1,2}$/.test(raw)) {
    normalized = raw
  } else {
    normalized = raw.replace(/\./g, '')
  }
  if (!/^\-?\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

/** ISO-Datum (YYYY-MM-DD) als deutsches Datum (TT.MM.JJJJ). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

export const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const

export function monthOf(iso: string): number {
  return Number(iso.slice(5, 7))
}
