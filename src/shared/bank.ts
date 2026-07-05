import type { Cents } from './types'

/**
 * Gemeinsame Typen für den Online-Banking-Abruf (FinTS). Der eigentliche
 * Bankzugriff läuft im Main-Prozess (src/main/bank.ts); der Renderer erhält
 * ausschließlich diese Ergebnis-Objekte.
 */

/** Ein abgerufener Umsatz, noch ohne Zuordnung. */
export interface BankFetchedRow {
  /** ISO-Datum YYYY-MM-DD (Wertstellung) */
  date: string
  /** Vorzeichenbetrag in Cent (negativ = Ausgabe) */
  amount: Cents
  /** Zahlungspflichtige:r bzw. Empfänger:in laut Bank */
  name: string
  /** Buchungstext und Verwendungszweck laut Bank */
  description: string
}

/** Ein Bankkonto aus den Stammdaten der Bank (UPD) zur Auswahl. */
export interface BankAccountChoice {
  accountNumber: string
  iban?: string
  /** Produktname der Bank, z. B. "VR-Girokonto" */
  product?: string
  holder?: string
}

/**
 * Ergebnis eines Abruf-Schritts. Der Renderer reagiert auf den Status:
 * 'tan' zeigt den Freigabe-Dialog (decoupled = Freigabe in der Banking-App,
 * sonst TAN-Eingabe), 'tanPending' heißt: Freigabe steht noch aus, weiter
 * abfragen. 'chooseAccount' verlangt die einmalige Auswahl der Kontonummer.
 */
export type BankFetchResult =
  | { status: 'ok'; rows: BankFetchedRow[] }
  | { status: 'needPin' }
  | { status: 'tan'; sessionId: string; challenge: string; decoupled: boolean }
  | { status: 'tanPending'; sessionId: string; challenge: string; decoupled: boolean }
  | { status: 'chooseAccount'; accounts: BankAccountChoice[] }
  | { status: 'error'; message: string }

export interface BankFetchOptions {
  /** PIN für diesen Abruf; fehlt sie, wird die gespeicherte PIN verwendet */
  pin?: string
  /** PIN verschlüsselt im Schlüsselbund des Betriebssystems hinterlegen */
  savePin?: boolean
  /** Ab-Datum (ISO) für den Umsatzabruf */
  from?: string
}
