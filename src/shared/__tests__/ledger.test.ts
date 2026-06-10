import { describe, expect, test } from 'vitest'
import { byCategory, chronological, computeBookings, monthSummaries, nextSeq, yearTotals } from '../ledger'
import type { Booking, YearFile } from '../types'

function booking(partial: Partial<Booking> & Pick<Booking, 'seq' | 'date' | 'categoryId' | 'type' | 'amount'>): Booking {
  return {
    id: `b${partial.seq}`,
    description: '',
    isUmsatz: false,
    nonUmsatzAmount: 0,
    note: '',
    source: 'manuell',
    ...partial,
  }
}

function file(bookings: Booking[]): YearFile {
  return {
    schemaVersion: 1,
    year: 2026,
    openingBalance: 740405, // 7.404,05 € wie im Original
    clubName: 'Testverein',
    treasurerName: 'Jannik',
    categories: [
      { id: 'r', name: 'Rechnungsabgrenzungsposten', code: 'R', sortOrder: 10, active: true },
      { id: 'm', name: 'Maskenball', code: 'M', sortOrder: 30, active: true },
      { id: 'b', name: 'Beiträge', code: 'B', sortOrder: 40, active: true },
    ],
    bookings,
  }
}

describe('computeBookings – Beleg-Nr. und Beträge', () => {
  test('vergibt Beleg-Nr. je Kategorie chronologisch', () => {
    const f = file([
      booking({ seq: 1, date: '2026-02-10', categoryId: 'm', type: 'ausgabe', amount: 50000 }),
      booking({ seq: 2, date: '2026-01-05', categoryId: 'b', type: 'einnahme', amount: 92800 }),
      booking({ seq: 3, date: '2026-02-12', categoryId: 'm', type: 'einnahme', amount: 218000 }),
    ])
    const refs = computeBookings(f).map((b) => b.ref)
    expect(refs).toEqual(['B1', 'M1', 'M2'])
  })

  test('Beleg-Nr. ist unabhängig von der Erfassungs-/Import-Reihenfolge', () => {
    // Rückwärts erfasst (z. B. Kontoauszug neueste zuerst importiert):
    // der früheste Umsatz des Jahres bekommt trotzdem die kleinste Nummer.
    const f = file([
      booking({ seq: 1, date: '2026-03-20', categoryId: 'm', type: 'ausgabe', amount: 300 }),
      booking({ seq: 2, date: '2026-02-15', categoryId: 'm', type: 'einnahme', amount: 200 }),
      booking({ seq: 3, date: '2026-01-02', categoryId: 'm', type: 'einnahme', amount: 100 }),
    ])
    const byId = new Map(computeBookings(f).map((b) => [b.id, b.ref]))
    expect(byId.get('b3')).toBe('M1')
    expect(byId.get('b2')).toBe('M2')
    expect(byId.get('b1')).toBe('M3')
  })

  test('bei gleichem Datum entscheidet die Erfassungsreihenfolge', () => {
    const f = file([
      booking({ seq: 1, date: '2026-01-10', categoryId: 'm', type: 'ausgabe', amount: 100 }),
      booking({ seq: 2, date: '2026-01-10', categoryId: 'm', type: 'einnahme', amount: 200 }),
    ])
    const byId = new Map(computeBookings(f).map((b) => [b.id, b.ref]))
    expect(byId.get('b1')).toBe('M1')
    expect(byId.get('b2')).toBe('M2')
  })

  test('Ausgaben erhalten negativen Vorzeichenbetrag', () => {
    const f = file([booking({ seq: 1, date: '2026-03-01', categoryId: 'r', type: 'ausgabe', amount: 13650 })])
    expect(computeBookings(f)[0].signedAmount).toBe(-13650)
  })

  test('Umsatzbetrag zieht "davon kein Umsatz" ab', () => {
    const f = file([
      booking({ seq: 1, date: '2026-02-12', categoryId: 'm', type: 'einnahme', amount: 218000, isUmsatz: true, nonUmsatzAmount: 50000 }),
      booking({ seq: 2, date: '2026-02-12', categoryId: 'm', type: 'einnahme', amount: 150000, isUmsatz: true }),
      booking({ seq: 3, date: '2026-02-10', categoryId: 'm', type: 'ausgabe', amount: 50000, isUmsatz: false }),
    ])
    const byId = new Map(computeBookings(f).map((b) => [b.id, b.umsatzAmount]))
    expect(byId.get('b1')).toBe(168000)
    expect(byId.get('b2')).toBe(150000)
    expect(byId.get('b3')).toBe(0)
  })
})

describe('chronological – Sortierung und laufender Saldo', () => {
  test('sortiert nach Datum, bei Gleichstand nach Erfassungsreihenfolge', () => {
    const f = file([
      booking({ seq: 1, date: '2026-03-01', categoryId: 'm', type: 'einnahme', amount: 100 }),
      booking({ seq: 2, date: '2026-01-15', categoryId: 'b', type: 'einnahme', amount: 200 }),
      booking({ seq: 3, date: '2026-01-15', categoryId: 'r', type: 'ausgabe', amount: 300 }),
    ])
    const rows = chronological(f)
    expect(rows.map((r) => r.id)).toEqual(['b2', 'b3', 'b1'])
  })

  test('laufender Saldo startet beim Anfangssaldo', () => {
    const f = file([
      booking({ seq: 1, date: '2026-01-10', categoryId: 'b', type: 'einnahme', amount: 10000 }),
      booking({ seq: 2, date: '2026-01-20', categoryId: 'r', type: 'ausgabe', amount: 2500 }),
    ])
    const rows = chronological(f)
    expect(rows[0].runningBalance).toBe(740405 + 10000)
    expect(rows[1].runningBalance).toBe(740405 + 10000 - 2500)
  })
})

describe('byCategory – Veranstaltungs-Gruppierung', () => {
  test('gruppiert in Kategorien-Reihenfolge mit Zwischensummen', () => {
    const f = file([
      booking({ seq: 1, date: '2026-02-10', categoryId: 'm', type: 'ausgabe', amount: 50000 }),
      booking({ seq: 2, date: '2026-01-05', categoryId: 'b', type: 'einnahme', amount: 92800 }),
      booking({ seq: 3, date: '2026-02-12', categoryId: 'm', type: 'einnahme', amount: 218000 }),
    ])
    const groups = byCategory(f)
    expect(groups.map((g) => g.category.code)).toEqual(['M', 'B'])
    const m = groups[0]
    expect(m.einnahmen).toBe(218000)
    expect(m.ausgaben).toBe(50000)
    expect(m.saldo).toBe(168000)
  })

  test('leere Kategorien erscheinen nicht', () => {
    const f = file([booking({ seq: 1, date: '2026-01-05', categoryId: 'b', type: 'einnahme', amount: 100 })])
    expect(byCategory(f).map((g) => g.category.code)).toEqual(['B'])
  })
})

describe('Auswertung', () => {
  test('yearTotals berechnet Abschlusssaldo wie die Excel', () => {
    const f = file([
      booking({ seq: 1, date: '2026-01-05', categoryId: 'b', type: 'einnahme', amount: 92800 }),
      booking({ seq: 2, date: '2026-02-10', categoryId: 'm', type: 'ausgabe', amount: 50000 }),
    ])
    const t = yearTotals(f)
    expect(t.einnahmen).toBe(92800)
    expect(t.ausgaben).toBe(50000)
    expect(t.saldo).toBe(42800)
    expect(t.closingBalance).toBe(740405 + 42800)
    expect(t.count).toBe(2)
  })

  test('monthSummaries führt den Kassenstand über die Monate fort', () => {
    const f = file([
      booking({ seq: 1, date: '2026-01-10', categoryId: 'b', type: 'einnahme', amount: 10000 }),
      booking({ seq: 2, date: '2026-03-15', categoryId: 'm', type: 'ausgabe', amount: 4000 }),
    ])
    const months = monthSummaries(f)
    expect(months[0].balanceEnd).toBe(740405 + 10000)
    expect(months[1].balanceEnd).toBe(740405 + 10000)
    expect(months[2].balanceEnd).toBe(740405 + 10000 - 4000)
    expect(months[2].ausgaben).toBe(4000)
  })

  test('nextSeq liefert fortlaufende Nummern', () => {
    const f = file([booking({ seq: 7, date: '2026-01-01', categoryId: 'b', type: 'einnahme', amount: 1 })])
    expect(nextSeq(f)).toBe(8)
  })
})
