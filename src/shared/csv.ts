import { parseAmountToCents } from './money'

/**
 * CSV-Import für Kontoauszüge deutscher Banken (Sparkasse, Volksbank,
 * ING, DKB u. a.). Erkennt Trennzeichen und Spaltenbelegung automatisch.
 */

export interface StatementRow {
  /** ISO-Datum YYYY-MM-DD */
  date: string
  /** Verwendungszweck inkl. Name des Auftraggebers/Empfängers */
  description: string
  /** Vorzeichenbetrag in Cent (negativ = Ausgabe) */
  amount: number
  /** Duplikat-Erkennung */
  hash: string
}

export interface ParseResult {
  rows: StatementRow[]
  /** Zeilen, die nicht interpretiert werden konnten */
  skipped: number
  /** Erkannte Spaltennamen, für die Anzeige im Import-Dialog */
  mapping: { date: string; description: string[]; amount: string }
}

const DATE_HEADERS = ['buchungstag', 'buchungsdatum', 'buchung', 'valutadatum', 'wertstellung', 'datum']
const AMOUNT_HEADERS = ['betrag', 'umsatz', 'betrag (eur)', 'umsatz (eur)', 'betrag in eur']
const TEXT_HEADERS = [
  'verwendungszweck', 'buchungstext', 'vorgang/verwendungszweck', 'beschreibung',
  'beguenstigter/zahlungspflichtiger', 'begünstigter/zahlungspflichtiger',
  'name zahlungsbeteiligter', 'auftraggeber/empfänger', 'auftraggeber/empfaenger',
  'empfänger', 'empfaenger', 'zahlungspflichtiger',
]

export function detectDelimiter(headerLine: string): string {
  const counts: [string, number][] = [';', ',', '\t'].map((d) => [d, headerLine.split(d).length])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][0]
}

/** Zerlegt eine CSV-Zeile unter Beachtung von Anführungszeichen. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields.map((f) => f.trim())
}

/** "01.03.2026", "2026-03-01" oder "01.03.26" → "2026-03-01" */
export function parseGermanDate(raw: string): string | null {
  const s = raw.trim()
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

function findColumn(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().replace(/"/g, '').trim())
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h === cand)
    if (idx >= 0) return idx
  }
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h.includes(cand))
    if (idx >= 0) return idx
  }
  return -1
}

/** Einfacher, stabiler Hash für Duplikat-Erkennung. */
export function rowHash(date: string, amount: number, description: string): string {
  const str = `${date}|${amount}|${description.toLowerCase().replace(/\s+/g, ' ')}`
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36) + '-' + str.length.toString(36)
}

export function parseBankCsv(content: string): ParseResult {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { rows: [], skipped: 0, mapping: { date: '', description: [], amount: '' } }

  // Kopfzeile suchen: erste Zeile, die eine Datums- UND eine Betragsspalte nennt
  let headerIdx = -1
  let delimiter = ';'
  let headers: string[] = []
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const d = detectDelimiter(lines[i])
    const cols = splitCsvLine(lines[i], d)
    if (findColumn(cols, DATE_HEADERS) >= 0 && findColumn(cols, AMOUNT_HEADERS) >= 0) {
      headerIdx = i
      delimiter = d
      headers = cols
      break
    }
  }
  if (headerIdx === -1) {
    return { rows: [], skipped: lines.length, mapping: { date: '', description: [], amount: '' } }
  }

  const dateCol = findColumn(headers, DATE_HEADERS)
  const amountCol = findColumn(headers, AMOUNT_HEADERS)
  const textCols = TEXT_HEADERS
    .map((h) => findColumn(headers, [h]))
    .filter((i) => i >= 0)
  const uniqueTextCols = [...new Set(textCols)]

  const rows: StatementRow[] = []
  let skipped = 0
  for (const line of lines.slice(headerIdx + 1)) {
    const fields = splitCsvLine(line, delimiter)
    const date = parseGermanDate(fields[dateCol] ?? '')
    const amount = parseAmountToCents(fields[amountCol] ?? '')
    if (!date || amount === null) {
      skipped++
      continue
    }
    const description = uniqueTextCols
      .map((i) => fields[i] ?? '')
      .filter(Boolean)
      .join(' – ')
      .replace(/\s+/g, ' ')
      .trim()
    rows.push({ date, description, amount, hash: rowHash(date, amount, description) })
  }
  return {
    rows,
    skipped,
    mapping: {
      date: headers[dateCol],
      description: uniqueTextCols.map((i) => headers[i]),
      amount: headers[amountCol],
    },
  }
}
