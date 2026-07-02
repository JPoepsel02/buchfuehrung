import type { AppSettings, YearFile } from './types'

/**
 * Export-/Import-Format für die Datensicherung: alle Kassenjahre plus
 * Einstellungen in einer JSON-Datei. Beim Import wird jede Datei streng
 * validiert, damit keine defekten oder manipulierten Werte in die
 * Buchführung gelangen.
 */

export const BACKUP_FORMAT = 'buchfuehrung-sicherung'
export const BACKUP_VERSION = 1

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  years: YearFile[]
  settings?: AppSettings
}

export function buildBackup(years: YearFile[], settings: AppSettings | undefined, exportedAt: string): Backup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, years, settings }
}

export type ValidationResult = { ok: true; backup: Backup } | { ok: false; errors: string[] }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Prüft eine eingelesene Sicherung Feld für Feld. Sammelt maximal 12 Fehler. */
export function validateBackup(data: unknown): ValidationResult {
  const errors: string[] = []
  const err = (msg: string) => {
    if (errors.length < 12) errors.push(msg)
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['Die Datei enthält kein gültiges Sicherungs-Objekt.'] }
  }
  const b = data as Record<string, unknown>
  if (b.format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['Das ist keine Buchführung-Sicherungsdatei (Format-Kennung fehlt).'] }
  }
  if (b.version !== BACKUP_VERSION) {
    return { ok: false, errors: [`Unbekannte Sicherungs-Version ${String(b.version)} (erwartet: ${BACKUP_VERSION}).`] }
  }
  if (!Array.isArray(b.years) || b.years.length === 0) {
    return { ok: false, errors: ['Die Sicherung enthält keine Kassenjahre.'] }
  }

  // Jahr darf je Konto nur einmal vorkommen (Haupt- und Zweitkonto getrennt)
  const seenYears = new Set<string>()
  b.years.forEach((y, yi) => {
    const where = `Jahr ${yi + 1}`
    if (typeof y !== 'object' || y === null) return err(`${where}: kein Objekt.`)
    const f = y as Record<string, unknown>
    if (!Number.isInteger(f.year) || (f.year as number) < 2000 || (f.year as number) > 2100)
      return err(`${where}: ungültige Jahreszahl ${String(f.year)}.`)
    const yearNo = f.year as number
    const yearKey = `${typeof f.konto === 'string' ? f.konto : 'haupt'}:${yearNo}`
    if (seenYears.has(yearKey)) err(`Kassenjahr ${yearNo} ist doppelt enthalten.`)
    seenYears.add(yearKey)
    if (!Number.isInteger(f.openingBalance)) err(`Kassenjahr ${yearNo}: Anfangssaldo ist kein Cent-Betrag.`)
    if (typeof f.clubName !== 'string' || typeof f.treasurerName !== 'string')
      err(`Kassenjahr ${yearNo}: Vereins-/Kassenwart-Name fehlt.`)
    if (f.konto !== undefined && f.konto !== 'haupt' && f.konto !== 'zweit')
      err(`Kassenjahr ${yearNo}: ungültige Konto-Kennung.`)
    if (f.kontoName !== undefined && typeof f.kontoName !== 'string')
      err(`Kassenjahr ${yearNo}: Konto-Name ist kein Text.`)
    if (
      f.fiscalStartMonth !== undefined &&
      (!Number.isInteger(f.fiscalStartMonth) || (f.fiscalStartMonth as number) < 1 || (f.fiscalStartMonth as number) > 12)
    )
      err(`Kassenjahr ${yearNo}: Startmonat des Kassenjahres muss 1–12 sein.`)

    if (!Array.isArray(f.categories) || f.categories.length === 0) {
      err(`Kassenjahr ${yearNo}: keine Kategorien.`)
      return
    }
    const catIds = new Set<string>()
    f.categories.forEach((c, ci) => {
      const cw = `Kassenjahr ${yearNo}, Kategorie ${ci + 1}`
      if (typeof c !== 'object' || c === null) return err(`${cw}: kein Objekt.`)
      const cat = c as Record<string, unknown>
      if (typeof cat.id !== 'string' || !cat.id) return err(`${cw}: ID fehlt.`)
      if (catIds.has(cat.id)) err(`${cw}: doppelte ID "${cat.id}".`)
      catIds.add(cat.id)
      if (typeof cat.name !== 'string' || !cat.name.trim()) err(`${cw}: Name fehlt.`)
      if (typeof cat.code !== 'string' || !cat.code.trim()) err(`${cw}: Kürzel fehlt.`)
      if (typeof cat.sortOrder !== 'number') err(`${cw}: Reihenfolge ist keine Zahl.`)
      if (typeof cat.active !== 'boolean') err(`${cw}: Aktiv-Kennzeichen fehlt.`)
      if (cat.praesentation !== undefined && cat.praesentation !== 'monat' && cat.praesentation !== 'sammel')
        err(`${cw}: ungültiger Präsentations-Modus.`)
      if (
        cat.praesentationMonat !== undefined &&
        (!Number.isInteger(cat.praesentationMonat) || (cat.praesentationMonat as number) < 1 || (cat.praesentationMonat as number) > 12)
      )
        err(`${cw}: Präsentations-Monat muss 1–12 sein.`)
    })

    if (!Array.isArray(f.bookings)) {
      err(`Kassenjahr ${yearNo}: Buchungsliste fehlt.`)
      return
    }
    const bookingIds = new Set<string>()
    f.bookings.forEach((bk, bi) => {
      const bw = `Kassenjahr ${yearNo}, Buchung ${bi + 1}`
      if (typeof bk !== 'object' || bk === null) return err(`${bw}: kein Objekt.`)
      const bo = bk as Record<string, unknown>
      if (typeof bo.id !== 'string' || !bo.id) return err(`${bw}: ID fehlt.`)
      if (bookingIds.has(bo.id)) err(`${bw}: doppelte ID "${bo.id}".`)
      bookingIds.add(bo.id)
      if (typeof bo.date !== 'string' || !DATE_RE.test(bo.date) || Number.isNaN(Date.parse(bo.date)))
        err(`${bw}: ungültiges Datum "${String(bo.date)}".`)
      if (typeof bo.categoryId !== 'string' || !catIds.has(bo.categoryId))
        err(`${bw}: verweist auf unbekannte Kategorie.`)
      if (bo.name !== undefined && typeof bo.name !== 'string') err(`${bw}: Name ist kein Text.`)
      if (typeof bo.description !== 'string') err(`${bw}: Verwendungszweck fehlt.`)
      if (bo.type !== 'einnahme' && bo.type !== 'ausgabe') err(`${bw}: Art muss Einnahme oder Ausgabe sein.`)
      if (!Number.isInteger(bo.amount) || (bo.amount as number) < 0)
        err(`${bw}: Betrag muss ein Cent-Betrag ≥ 0 sein.`)
      if (typeof bo.isUmsatz !== 'boolean') err(`${bw}: Umsatz-Kennzeichen fehlt.`)
      if (
        !Number.isInteger(bo.nonUmsatzAmount) ||
        (bo.nonUmsatzAmount as number) < 0 ||
        (Number.isInteger(bo.amount) && (bo.nonUmsatzAmount as number) > (bo.amount as number))
      )
        err(`${bw}: "davon kein Umsatz" muss zwischen 0 und dem Betrag liegen.`)
      if (typeof bo.note !== 'string') err(`${bw}: Notiz-Feld fehlt.`)
      if (bo.subcategory !== undefined && typeof bo.subcategory !== 'string')
        err(`${bw}: Unterkategorie ist kein Text.`)
      if (bo.receiptAvailable !== undefined && typeof bo.receiptAvailable !== 'boolean')
        err(`${bw}: Beleg-Kennzeichen ist kein Wahr/Falsch-Wert.`)
      if (!Number.isInteger(bo.seq)) err(`${bw}: laufende Nummer fehlt.`)
      if (bo.refNo !== undefined && (!Number.isInteger(bo.refNo) || (bo.refNo as number) < 1))
        err(`${bw}: Beleg-Nummer muss eine positive Ganzzahl sein.`)
      if (bo.source !== 'manuell' && bo.source !== 'import') err(`${bw}: ungültige Herkunft.`)
      if (bo.importHashVersion !== undefined && bo.importHashVersion !== 2) {
        err(`${bw}: ungültige Import-Hash-Version.`)
      }
    })
  })

  if (b.settings !== undefined) {
    if (typeof b.settings !== 'object' || b.settings === null || Array.isArray(b.settings)) {
      err('Einstellungen: kein Objekt.')
    } else {
      const s = b.settings as Record<string, unknown>
      if (s.logoDataUrl !== undefined && s.logoDataUrl !== null) {
        if (typeof s.logoDataUrl !== 'string' || !s.logoDataUrl.startsWith('data:image/'))
          err('Einstellungen: Logo ist keine Bild-Data-URL.')
      }
      if (s.theme !== undefined && s.theme !== 'hell' && s.theme !== 'dunkel' && s.theme !== 'system')
        err('Einstellungen: ungültiges Farbschema.')
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, backup: data as Backup }
}
