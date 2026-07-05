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
  /**
   * Darstellung in der Jahres-Präsentation:
   * 'monat' = einmal im Jahresverlauf, 'sammel' = auf der Sammel-Folie
   * nach den Monaten. Ohne Wert wird automatisch entschieden (Sonstiges,
   * Beiträge, Zuschüsse und Spenden landen auf der Sammel-Folie).
   */
  praesentation?: 'monat' | 'sammel' | 'aus'
  /** Monat (1–12) für den Jahresverlauf; ohne Wert: Monat der ersten Buchung */
  praesentationMonat?: number
}

export interface Booking {
  id: string
  /** ISO-Datum YYYY-MM-DD */
  date: string
  categoryId: string
  /** Zahlungspflichtige:r bei Einnahmen bzw. Empfänger:in bei Ausgaben */
  name?: string
  /** Verwendungszweck */
  description: string
  type: BookingType
  /** Betrag in Cent, immer positiv – das Vorzeichen ergibt sich aus type */
  amount: Cents
  /** Zählt die Buchung zum Umsatz? (z. B. Wechselgeld nicht) */
  isUmsatz: boolean
  /** Anteil in Cent, der NICHT als Umsatz zählt (z. B. enthaltenes Wechselgeld) */
  nonUmsatzAmount: Cents
  /**
   * Optionale Unterkategorie (z. B. "Karnevalsbeiträge"): In der
   * Veranstaltungs-Ansicht werden Buchungen mit gleicher Unterkategorie zu
   * einer Summenzeile zusammengefasst – chronologisch bleibt jede Buchung
   * einzeln gelistet.
   */
  subcategory?: string
  /** Gibt an, ob eine Rechnung/Quittung/ein Eigenbeleg im Belegordner liegt */
  receiptAvailable?: boolean
  note: string
  /** Laufende Nummer der Erfassung – bestimmt die Beleg-Nr.-Vergabe */
  seq: number
  /**
   * Fest vergebene Beleg-Nummer innerhalb der Kategorie (z. B. 2 für "O2").
   * Wird einmalig bei der Anlage vergeben und ändert sich nie mehr – auch
   * nicht, wenn andere Buchungen gelöscht werden. Gelöschte Nummern werden
   * nicht wiederverwendet (nächste Nummer = bisheriges Maximum + 1).
   */
  refNo?: number
  /** Herkunft der Buchung */
  source: 'manuell' | 'import'
  /** Duplikat-Erkennung beim Kontoauszug-Import */
  importHash?: string
  /** Version des Import-Hashes; 2 = Datum, Betrag und Bank-Beschreibung */
  importHashVersion?: 2
}

export type ThemeSetting = 'hell' | 'dunkel' | 'system'

/**
 * Zugangsdaten eines Online-Banking-Kontos für den FinTS-Abruf.
 * Die PIN gehört bewusst NICHT hierher – sie wird ausschließlich
 * verschlüsselt über den Betriebssystem-Schlüsselbund (safeStorage)
 * im Main-Prozess abgelegt.
 */
export interface BankAccountConfig {
  id: string
  /** Anzeigename, z. B. "Hauptkonto Volksbank" */
  label: string
  /** Bankleitzahl */
  blz: string
  /** FinTS-Zugangsadresse der Bank */
  fintsUrl: string
  /** VR-NetKey bzw. Online-Banking-Anmeldename */
  userId: string
  /** Kontonummer bei der Bank – wird nach der ersten Synchronisation gewählt */
  accountNumber?: string
  /** IBAN, nur zur Anzeige */
  iban?: string
}

/** Jahresübergreifende App-Einstellungen (eigene Datei neben den Jahresdateien). */
export interface AppSettings {
  /** Eigenes Vereinslogo als Data-URL (PNG/JPEG); erscheint in Seitenleiste, Prüfbericht und Dock */
  logoDataUrl?: string | null
  /** Farbschema der App (Standard: system) */
  theme?: ThemeSetting
  /** Optionaler zusätzlicher Sicherungsordner, z. B. in iCloud Drive oder OneDrive */
  cloudBackupDir?: string | null
  /** Spiegelt Jahresdateien und Einstellungen zusätzlich in den Cloud-Ordner */
  cloudBackupEnabled?: boolean
  /** Hinterlegte Online-Banking-Konten (beliebig viele) */
  bankAccounts?: BankAccountConfig[]
  /** FinTS-Produktkennung (kostenlose Registrierung bei der Deutschen Kreditwirtschaft) */
  fintsProductId?: string | null
}

export interface ImportDraftSplit {
  id: string
  description: string
  categoryId: string
  amount: Cents
  isUmsatz: boolean
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
  /** Zahlungspflichtige:r bzw. Empfänger:in */
  name: string
  selected: boolean
  categoryId: string
  isUmsatz: boolean
  /** Liegt ein Beleg im Ordner vor? (Standard beim Import: nein) */
  receiptAvailable?: boolean
  /** Optionale Unterkategorie für die Veranstaltungs-Zusammenfassung */
  subcategory?: string
  splits?: ImportDraftSplit[]
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

/** Angaben für den Kassenprüfbericht (nach der Vorlage des Vereins). */
export interface AuditInfo {
  /** Namen der beiden Kassenprüfer */
  pruefer1: string
  pruefer2: string
  /** Anwesende bei der Prüfung ("im Beisein von …") */
  beisein: string
  /** Geprüfte Konten (zweites optional) */
  konto1: string
  konto2: string
  /** Datum der Mitgliederversammlung, die die Prüfer gewählt hat */
  wahlDatum: string
  /** Datum der Kassenprüfung */
  pruefDatum: string
  /** Datum der Generalversammlung, in der entlastet wird */
  gvDatum: string
  /** Ort für die Unterschriftszeile */
  ort: string
}

/** Kennung der geführten Bücher: Hauptkonto und optionales Zweitkonto. */
export type KontoId = 'haupt' | 'zweit'

export interface YearFile {
  schemaVersion: 1
  /**
   * Kalenderjahr bzw. – bei abweichendem Wirtschaftsjahr – das Jahr, in dem
   * das Wirtschaftsjahr BEGINNT (z. B. 2025 für November 2025 – Oktober 2026).
   */
  year: number
  /** Zu welchem Buch die Datei gehört (Standard: haupt) */
  konto?: KontoId
  /** Anzeigename des Kontos, z. B. "Karnevalskonto" */
  kontoName?: string
  /** Erster Monat des Wirtschaftsjahres (1 = Januar, 11 = November); Standard 1 */
  fiscalStartMonth?: number
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
  /** Angaben für den Kassenprüfbericht */
  audit?: Partial<AuditInfo>
}

/** Buchung mit allen abgeleiteten Feldern (Beleg-Nr., Vorzeichenbetrag, Umsatz). */
export interface ComputedBooking extends Booking {
  /** Beleg-Nr., z. B. "M3" */
  ref: string
  /** Beleg-Nummer als Zahl (gespeichert oder für Altdaten hergeleitet) */
  refNo: number
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

/**
 * Anzeigezeile der Veranstaltungs-Ansicht: einzelne Buchung oder die
 * Summenzeile einer Unterkategorie.
 */
export interface EventRow {
  kind: 'einzeln' | 'unterkategorie'
  /** Datum der (ersten) Buchung – bestimmt die Sortierung in der Gruppe */
  date: string
  /** Beleg-Nr. für Einzelzeilen; bei gruppierten Unterkategorien bewusst leer */
  refs: string
  /** Verwendungszweck bzw. Name der Unterkategorie */
  label: string
  /** Zahlungspflichtige:r bzw. Empfänger:in; bei Gruppen zusammengefasst */
  name: string
  ausgaben: Cents
  einnahmen: Cents
  /** Anzahl zusammengefasster Buchungen */
  count: number
  /** Anzahl Buchungen, bei denen ein Beleg im Ordner markiert ist */
  receiptAvailableCount: number
}

export interface MonthSummary {
  /** 1–12 (bei Wirtschaftsjahren in Wirtschaftsjahr-Reihenfolge) */
  month: number
  /** Kalenderjahr des Monats (kann beim Wirtschaftsjahr ins Folgejahr reichen) */
  year: number
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
