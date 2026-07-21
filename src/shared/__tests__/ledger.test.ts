import { describe, expect, test } from 'vitest'
import {
  assignMissingRefNos,
  bookingMatches,
  byCategory,
  chronological,
  classifyDraftDuplicates,
  computeBookings,
  eventRows,
  migrateExistingImportHashes,
  monthSummaries,
  nextRefNo,
  nextSeq,
  reconcileImportedBookings,
  yearTotals,
} from '../ledger'
import { rowHash } from '../csv'
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

  test('eventRows fasst Unterkategorien zu Summenzeilen zusammen', () => {
    const f = file([
      booking({ seq: 1, date: '2026-01-05', categoryId: 'm', type: 'einnahme', amount: 10000, subcategory: 'Karnevalsbeiträge', description: 'Beitrag A', name: 'Anna' }),
      booking({ seq: 2, date: '2026-01-08', categoryId: 'm', type: 'einnahme', amount: 5000, subcategory: 'Karnevalsbeiträge', description: 'Beitrag B', name: 'Bernd' }),
      booking({ seq: 3, date: '2026-01-06', categoryId: 'm', type: 'ausgabe', amount: 2000, description: 'Getränke', name: 'Getränke Meier' }),
    ])
    const rows = eventRows(byCategory(f)[0])
    expect(rows).toHaveLength(2)
    const sub = rows.find((r) => r.kind === 'unterkategorie')!
    expect(sub.label).toBe('Karnevalsbeiträge')
    expect(sub.einnahmen).toBe(15000)
    expect(sub.count).toBe(2)
    expect(sub.refs).toBe('')
    expect(sub.name).toBe('')
    const single = rows.find((r) => r.kind === 'einzeln')!
    expect(single.label).toBe('Getränke')
    expect(single.name).toBe('Getränke Meier')
    expect(single.ausgaben).toBe(2000)
    // Chronologie bleibt unberührt: weiterhin 3 einzelne Buchungen
    expect(chronological(f)).toHaveLength(3)
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

  test('monthSummaries folgt dem Wirtschaftsjahr (Nov–Okt) über den Jahreswechsel', () => {
    const f = {
      ...file([
        booking({ seq: 1, date: '2025-11-15', categoryId: 'm', type: 'einnahme', amount: 10000 }),
        booking({ seq: 2, date: '2026-02-10', categoryId: 'm', type: 'ausgabe', amount: 4000 }),
      ]),
      year: 2025,
      fiscalStartMonth: 11,
    }
    const months = monthSummaries(f)
    expect(months[0]).toMatchObject({ month: 11, year: 2025, einnahmen: 10000 })
    expect(months[3]).toMatchObject({ month: 2, year: 2026, ausgaben: 4000 })
    expect(months[11]).toMatchObject({ month: 10, year: 2026, balanceEnd: 740405 + 10000 - 4000 })
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

  test('bookingMatches findet Beträge, Notizen, Beleg-Nr. und Kategorie', () => {
    const f = file([
      booking({ seq: 1, date: '2026-01-10', categoryId: 'm', type: 'ausgabe', amount: 10080, description: 'Getränke', name: 'Getränke Meier', note: 'VR BANK Lastschrift' }),
    ])
    const row = computeBookings(f)[0]
    // Über den Betrag gefunden (wie in der globalen Suche) → muss auch im Listenfilter treffen
    expect(bookingMatches(row, '100')).toBe(true)
    expect(bookingMatches(row, '100,80')).toBe(true)
    expect(bookingMatches(row, 'getränke')).toBe(true)
    expect(bookingMatches(row, 'meier')).toBe(true)
    expect(bookingMatches(row, 'vr bank')).toBe(true)
    expect(bookingMatches(row, 'M1')).toBe(true)
    expect(bookingMatches(row, 'maskenball')).toBe(true)
    expect(bookingMatches(row, '999,99')).toBe(false)
  })

  test('migriert alte Import-Hashes und ergänzt nur fehlende Namen', () => {
    const bookings = [
      booking({ seq: 1, date: '2026-01-10', categoryId: 'm', type: 'einnahme', amount: 1000, source: 'manuell', importHash: 'legacy-1' }),
      booking({ seq: 2, date: '2026-01-11', categoryId: 'm', type: 'ausgabe', amount: 2000, source: 'import', importHash: 'new-2', name: 'Schon vorhanden' }),
      booking({ seq: 3, date: '2026-01-12', categoryId: 'm', type: 'ausgabe', amount: 1000, source: 'manuell', importHash: 'legacy-split' }),
      booking({ seq: 4, date: '2026-01-12', categoryId: 'b', type: 'ausgabe', amount: 2000, source: 'manuell', importHash: 'legacy-split' }),
      booking({ seq: 4, date: '2026-01-13', categoryId: 'm', type: 'ausgabe', amount: 4000, source: 'manuell' }),
    ]

    const result = reconcileImportedBookings(
      bookings,
      [
        { hash: 'new-1', legacyHashes: ['legacy-1'], name: 'Neuer Name' },
        { hash: 'new-2', legacyHashes: ['legacy-2'], name: 'Nicht überschreiben' },
        { hash: 'new-split', legacyHashes: ['legacy-split'], name: 'Split Name' },
      ],
    )

    expect(result.updatedNameCount).toBe(3)
    expect(result.migratedHashCount).toBe(3)
    expect(result.bookings.map((b) => b.name)).toEqual([
      'Neuer Name',
      'Schon vorhanden',
      'Split Name',
      'Split Name',
      undefined,
    ])
    expect(result.bookings.map((b) => b.importHash)).toEqual([
      'new-1',
      'new-2',
      'new-split',
      'new-split',
      undefined,
    ])
    expect(result.bookings.slice(0, 4).every((b) => b.source === 'import')).toBe(true)
    expect(bookings[0].name).toBeUndefined()
    expect(bookings[0].importHash).toBe('legacy-1')
  })

  test('berechnet bestehende Import-Hashes aus Datum, Gesamtbetrag und Banktext neu', () => {
    const bookings = [
      booking({
        seq: 1,
        date: '2026-03-30',
        categoryId: 'm',
        type: 'ausgabe',
        amount: 73699,
        source: 'manuell',
        importHash: 'alter-hash',
        note: 'Auftrags Nr: 2184 – Echtzeitüberweisung',
      }),
      booking({
        seq: 2,
        date: '2026-03-30',
        categoryId: 'b',
        type: 'ausgabe',
        amount: 26717,
        source: 'manuell',
        importHash: 'alter-hash',
        note: 'Auftrags Nr: 2184 – Echtzeitüberweisung',
      }),
      booking({
        seq: 3,
        date: '2026-04-01',
        categoryId: 'm',
        type: 'einnahme',
        amount: 2000,
        source: 'manuell',
        note: 'Echte manuelle Buchung',
      }),
    ]

    const result = migrateExistingImportHashes(bookings)

    expect(result.migratedCount).toBe(2)
    expect(result.bookings[0].importHash).toBe(result.bookings[1].importHash)
    expect(result.bookings[0].importHash).not.toBe('alter-hash')
    expect(result.bookings.slice(0, 2).every((booking) => booking.source === 'import')).toBe(true)
    expect(result.bookings[2]).toBe(bookings[2])
    expect(bookings[0].importHash).toBe('alter-hash')

    const edited = result.bookings.map((booking, index) =>
      index < 2 ? { ...booking, note: 'Später bearbeitete Notiz' } : booking,
    )
    const repeated = migrateExistingImportHashes(edited)
    expect(repeated.migratedCount).toBe(0)
    expect(repeated.bookings[0].importHash).toBe(result.bookings[0].importHash)
  })

  test('migriert Version-2-Hashes verlustfrei auf den vereinheitlichten Banktext', () => {
    const csvText = 'Nina Pöpsel, M, Nina – Überweisungsgutschr.'
    const onlineText = 'Überweisungsgutschr. · Nina Pöpsel, M, Nina'
    const existing = booking({
      seq: 8,
      date: '2026-06-25',
      categoryId: 'm',
      type: 'einnahme',
      amount: 4000,
      name: 'Nina Pöpsel',
      description: 'T-Shirt Nina',
      note: csvText,
      source: 'import',
      importHash: 'j8ud73-1n',
      importHashVersion: 2,
    })

    const result = migrateExistingImportHashes([existing])
    const migrated = result.bookings[0]

    expect(result.migratedCount).toBe(1)
    expect(migrated).toMatchObject({
      name: existing.name,
      description: existing.description,
      note: existing.note,
      amount: existing.amount,
      categoryId: existing.categoryId,
      importHash: rowHash(existing.date, 4000, onlineText),
      importHashVersion: 3,
    })
    expect(existing.importHash).toBe('j8ud73-1n')
    expect(existing.importHashVersion).toBe(2)
  })
})

describe('classifyDraftDuplicates – Auszugszeilen gegen bestehende Buchungen', () => {
  const draft = (hash: string, date: string, amount: number) => ({ hash, date, amount })

  test('erkennt frühere Importe über den importHash (hard)', () => {
    const bookings = [
      booking({ seq: 1, date: '2026-02-14', categoryId: 'm', type: 'einnahme', amount: 10000, source: 'import', importHash: 'h1', importHashVersion: 2 }),
    ]
    const { hard, soft } = classifyDraftDuplicates(bookings, [draft('h1', '2026-02-14', 10000)])
    expect(hard).toEqual([true])
    expect(soft).toEqual([false])
  })

  test('erkennt von Hand erfasste Buchungen über Datum + Betrag (soft)', () => {
    // Ausgabe 136,50 € am 02.01., manuell erfasst (kein importHash)
    const bookings = [
      booking({ seq: 1, date: '2026-01-02', categoryId: 'm', type: 'ausgabe', amount: 13650, source: 'manuell' }),
    ]
    const { hard, soft } = classifyDraftDuplicates(bookings, [draft('neu', '2026-01-02', -13650)])
    expect(hard).toEqual([false])
    expect(soft).toEqual([true])
  })

  test('unterscheidet Vorzeichen: Einnahme matcht keine gleich hohe Ausgabe', () => {
    const bookings = [
      booking({ seq: 1, date: '2026-01-02', categoryId: 'm', type: 'ausgabe', amount: 10000, source: 'manuell' }),
    ]
    const { soft } = classifyDraftDuplicates(bookings, [draft('neu', '2026-01-02', 10000)])
    expect(soft).toEqual([false])
  })

  test('verbraucht je bestehende Buchung nur eine Zeile', () => {
    const bookings = [
      booking({ seq: 1, date: '2026-01-02', categoryId: 'm', type: 'ausgabe', amount: 10000, source: 'manuell' }),
    ]
    const { soft } = classifyDraftDuplicates(bookings, [
      draft('a', '2026-01-02', -10000),
      draft('b', '2026-01-02', -10000),
    ])
    expect(soft).toEqual([true, false])
  })

  test('keine Übereinstimmung → beide Flags false', () => {
    const bookings = [booking({ seq: 1, date: '2026-01-02', categoryId: 'm', type: 'ausgabe', amount: 10000, source: 'manuell' })]
    const { hard, soft } = classifyDraftDuplicates(bookings, [draft('x', '2026-03-09', -500)])
    expect(hard).toEqual([false])
    expect(soft).toEqual([false])
  })

  test('importierte Buchung zählt nicht in den Soft-Vorrat (kein doppeltes Flag)', () => {
    const bookings = [
      booking({ seq: 1, date: '2026-02-14', categoryId: 'm', type: 'einnahme', amount: 10000, source: 'import', importHash: 'h1', importHashVersion: 2 }),
    ]
    // andere Auszugszeile, gleiches Datum/Betrag, aber anderer Hash
    const { hard, soft } = classifyDraftDuplicates(bookings, [draft('h2', '2026-02-14', 10000)])
    expect(hard).toEqual([false])
    expect(soft).toEqual([false])
  })
})

describe('Feste Beleg-Nummern (refNo)', () => {
  test('gespeicherte Nummern gewinnen: O2 bleibt O2, wenn O1 gelöscht wird', () => {
    const f = file([
      // O1 wurde gelöscht – nur O2 ist noch da
      booking({ seq: 2, date: '2026-04-10', categoryId: 'm', type: 'einnahme', amount: 200, refNo: 2 }),
    ])
    const rows = computeBookings(f)
    expect(rows[0].ref).toBe('M2')
    expect(rows[0].refNo).toBe(2)
  })

  test('nextRefNo vergibt Maximum + 1 und verwendet gelöschte Nummern nicht wieder', () => {
    const f = file([
      booking({ seq: 2, date: '2026-04-10', categoryId: 'm', type: 'einnahme', amount: 200, refNo: 2 }),
    ])
    // O1 ist frei, trotzdem bekommt die nächste Buchung O3
    expect(nextRefNo(f, 'm')).toBe(3)
    // andere Kategorie startet bei 1
    expect(nextRefNo(f, 'b')).toBe(1)
  })

  test('Altdaten ohne refNo: chronologische Herleitung überspringt feste Nummern', () => {
    const f = file([
      booking({ seq: 1, date: '2026-01-05', categoryId: 'm', type: 'einnahme', amount: 100 }), // alt, ohne refNo
      booking({ seq: 2, date: '2026-02-01', categoryId: 'm', type: 'einnahme', amount: 200, refNo: 1 }), // fest: M1
    ])
    const byId = new Map(computeBookings(f).map((b) => [b.id, b.ref]))
    // die feste 1 ist belegt → Altbuchung bekommt die 2 (trotz früherem Datum)
    expect(byId.get('b2')).toBe('M1')
    expect(byId.get('b1')).toBe('M2')
  })

  test('assignMissingRefNos schreibt Nummern einmalig fest und ist idempotent', () => {
    const f = file([
      booking({ seq: 1, date: '2026-03-20', categoryId: 'm', type: 'ausgabe', amount: 300 }),
      booking({ seq: 2, date: '2026-01-02', categoryId: 'm', type: 'einnahme', amount: 100 }),
    ])
    const first = assignMissingRefNos(f)
    expect(first.migratedCount).toBe(2)
    const byId = new Map(first.bookings.map((b) => [b.id, b.refNo]))
    // chronologisch: 02.01. → 1, 20.03. → 2
    expect(byId.get('b2')).toBe(1)
    expect(byId.get('b1')).toBe(2)
    const again = assignMissingRefNos({ ...f, bookings: first.bookings })
    expect(again.migratedCount).toBe(0)
    expect(again.bookings).toBe(first.bookings)
  })

  test('Löschen einer mittleren Nummer verändert die übrigen nicht', () => {
    const all = [
      booking({ seq: 1, date: '2026-04-01', categoryId: 'm', type: 'einnahme', amount: 100, refNo: 1 }),
      booking({ seq: 2, date: '2026-04-05', categoryId: 'm', type: 'einnahme', amount: 200, refNo: 2 }),
      booking({ seq: 3, date: '2026-04-09', categoryId: 'm', type: 'einnahme', amount: 300, refNo: 3 }),
    ]
    const afterDelete = file(all.filter((b) => b.refNo !== 1))
    const refs = computeBookings(afterDelete).map((b) => b.ref)
    expect(refs).toEqual(['M2', 'M3'])
  })
})
