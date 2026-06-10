/** Beträge werden durchgängig in Cent (ganzzahlig) gespeichert. */
export type Cents = number

export type BookingType = 'einnahme' | 'ausgabe'

export interface Category {
  id: string
  /** Vollständiger Name, z. B. "Maskenball" */
  name: string
  /** Kürzel für die Beleg-Nr., z. B. "M" */
  code: string
  /** Reihenfolge im Veranstaltungs-Blatt und im Prüfbericht */
  sortOrder: number
  active: boolean
}

export interface Booking {
  id: string
  /** ISO-Datum YYYY-MM-DD */
  date: string
  categoryId: string
  /** Verwendungszweck */
  description: string
  type: BookingType
  /** Betrag in Cent, immer positiv – das Vorzeichen ergibt sich aus type */
  amount: Cents
  /** Zählt die Buchung zum Umsatz? (z. B. Wechselgeld nicht) */
  isUmsatz: boolean
  /** Anteil in Cent, der NICHT als Umsatz zählt (z. B. enthaltenes Wechselgeld) */
  nonUmsatzAmount: Cents
  note: string
  /** Laufende Nummer der Erfassung – bestimmt die Beleg-Nr.-Vergabe */
  seq: number
  /** Herkunft der Buchung */
  source: 'manuell' | 'import'
  /** Duplikat-Erkennung beim Kontoauszug-Import */
  importHash?: string
}

/** Eine Zeile eines zwischengespeicherten Kontoauszug-Imports. */
export interface ImportDraftRow {
  /** ISO-Datum YYYY-MM-DD */
  date: string
  /** Original-Verwendungszweck aus dem Kontoauszug (nur zur Anzeige) */
  bankText: string
  /** Betrag in Cent, vorzeichenbehaftet wie im Auszug */
  amount: Cents
  /** Duplikat-Erkennung */
  hash: string
  /** Eigener, kurzer Verwendungszweck – Pflicht vor der Übernahme */
  description: string
  selected: boolean
  categoryId: string
  isUmsatz: boolean
}

/**
 * Entwurf eines Kontoauszug-Imports. Wird in der Jahresdatei gespeichert,
 * damit er beim Tab-Wechsel oder Neustart nicht verloren geht.
 */
export interface ImportDraft {
  fileName: string
  /** Beim Einlesen übersprungene Zeilen (Kopf-/Saldozeilen) */
  skipped: number
  rows: ImportDraftRow[]
}

export interface YearFile {
  schemaVersion: 1
  year: number
  /** Anfangssaldo in Cent (Abschlusssaldo des Vorjahres) */
  openingBalance: Cents
  /** Name des Vereins / der Ortsgruppe für Berichte */
  clubName: string
  /** Name Kassenwart:in für den Prüfbericht */
  treasurerName: string
  categories: Category[]
  bookings: Booking[]
  /** Nicht abgeschlossener Kontoauszug-Import */
  importDraft?: ImportDraft | null
}

/** Buchung mit allen abgeleiteten Feldern (Beleg-Nr., Vorzeichenbetrag, Umsatz). */
export interface ComputedBooking extends Booking {
  /** Beleg-Nr., z. B. "M3" */
  ref: string
  categoryName: string
  /** Vorzeichenbetrag in Cent: Ausgaben negativ */
  signedAmount: Cents
  /** Umsatzanteil in Cent (vorzeichenbehaftet), 0 wenn kein Umsatz */
  umsatzAmount: Cents
}

export interface ChronoRow extends ComputedBooking {
  /** Kassenstand nach dieser Buchung in Cent */
  runningBalance: Cents
}

export interface CategoryGroup {
  category: Category
  rows: ComputedBooking[]
  einnahmen: Cents
  ausgaben: Cents
  saldo: Cents
  umsatz: Cents
}

export interface MonthSummary {
  /** 1–12 */
  month: number
  einnahmen: Cents
  ausgaben: Cents
  saldo: Cents
  umsatz: Cents
  /** Kassenstand am Monatsende in Cent */
  balanceEnd: Cents
  count: number
}

export interface YearTotals {
  einnahmen: Cents
  ausgaben: Cents
  saldo: Cents
  umsatz: Cents
  closingBalance: Cents
  count: number
}
