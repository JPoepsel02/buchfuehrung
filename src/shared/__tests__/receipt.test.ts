import { describe, expect, test } from 'vitest'
import { migrateReceiptStatuses, receiptAvailable, receiptStatus } from '../receipt'
import type { YearFile } from '../types'

describe('Belegstatus – rückwärtskompatible Migration', () => {
  test('liest alte Beleg-Haken ohne Bedeutungsänderung', () => {
    expect(receiptStatus({ receiptAvailable: true })).toBe('vorhanden')
    expect(receiptStatus({ receiptAvailable: false })).toBe('offen')
    // Alte manuell erfasste Buchungen ohne Feld galten bislang als vorhanden.
    expect(receiptStatus({})).toBe('vorhanden')
  })

  test('nur der Status vorhanden zählt als Beleg im Ordner', () => {
    expect(receiptAvailable('vorhanden')).toBe(true)
    expect(receiptAvailable('offen')).toBe(false)
    expect(receiptAvailable('nicht_erforderlich')).toBe(false)
  })

  test('ergänzt den neuen Status und behält den alten Haken für ältere App-Versionen', () => {
    const file: YearFile = {
      schemaVersion: 1,
      year: 2026,
      openingBalance: 0,
      clubName: 'Testverein',
      treasurerName: 'Jannik',
      categories: [{ id: 's', name: 'Sonstiges', code: 'S', sortOrder: 10, active: true }],
      bookings: [
        {
          id: 'vorhanden',
          seq: 1,
          date: '2026-01-01',
          categoryId: 's',
          description: 'Alte Buchung mit Beleg',
          type: 'ausgabe',
          amount: 100,
          isUmsatz: false,
          nonUmsatzAmount: 0,
          note: '',
          source: 'manuell',
          receiptAvailable: true,
        },
        {
          id: 'offen',
          seq: 2,
          date: '2026-01-02',
          categoryId: 's',
          description: 'Alter Import ohne Beleg',
          type: 'ausgabe',
          amount: 200,
          isUmsatz: false,
          nonUmsatzAmount: 0,
          note: '',
          source: 'import',
          receiptAvailable: false,
        },
      ],
      importDraft: {
        fileName: 'auszug.csv',
        skipped: 0,
        rows: [
          {
            date: '2026-01-03',
            bankText: 'Banktext',
            amount: -300,
            hash: 'hash',
            name: 'Muster GmbH',
            description: '',
            selected: true,
            categoryId: '',
            isUmsatz: false,
            receiptAvailable: false,
          },
        ],
      },
    }

    const migrated = migrateReceiptStatuses(file)
    expect(migrated.migratedCount).toBe(3)
    expect(migrated.file.bookings.map((b) => b.receiptStatus)).toEqual(['vorhanden', 'offen'])
    expect(migrated.file.bookings.map((b) => b.receiptAvailable)).toEqual([true, false])
    expect(migrated.file.importDraft?.rows[0]).toMatchObject({ receiptStatus: 'offen', receiptAvailable: false })
  })
})
