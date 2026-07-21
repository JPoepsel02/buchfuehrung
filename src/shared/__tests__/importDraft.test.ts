import { describe, expect, test } from 'vitest'
import { emptyYearFile } from '../defaults'
import {
  appendToDraft,
  buildDraft,
  migrateImportDraftHashes,
  receiptAvailableForImport,
  subcategorySuggestions,
} from '../importDraft'
import type { Booking, YearFile } from '../types'
import type { StatementRow } from '../csv'

describe('receiptAvailableForImport', () => {
  test('behandelt alte Importentwürfe ohne Feld als nicht vorhanden', () => {
    expect(receiptAvailableForImport({})).toBe(false)
  })

  test('übernimmt nur einen ausdrücklich gesetzten Beleg-Haken', () => {
    expect(receiptAvailableForImport({ receiptAvailable: true })).toBe(true)
    expect(receiptAvailableForImport({ receiptAvailable: false })).toBe(false)
  })

  test('liefert vorhandene Unterkategorien nur für die gewählte Hauptkategorie', () => {
    const bookings = [
      { categoryId: 'a', subcategory: ' Getränke ' },
      { categoryId: 'a', subcategory: 'Beiträge' },
      { categoryId: 'a', subcategory: 'Getränke' },
      { categoryId: 'b', subcategory: 'Reise' },
      { categoryId: 'a' },
    ]

    expect(subcategorySuggestions(bookings, 'a')).toEqual(['Beiträge', 'Getränke'])
    expect(subcategorySuggestions(bookings, 'b')).toEqual(['Reise'])
    expect(subcategorySuggestions(bookings, '')).toEqual([])
  })

  test('berücksichtigt auch Unterkategorien aus dem offenen Importentwurf', () => {
    const bookings = [{ categoryId: 'a', subcategory: 'Gebucht' }]
    const draftRows = [
      { categoryId: 'a', subcategory: 'Im Entwurf' },
      { categoryId: 'a', subcategory: 'Gebucht' },
      { categoryId: 'b', subcategory: 'Andere Kategorie' },
    ]

    expect(subcategorySuggestions(bookings, 'a', draftRows)).toEqual(['Gebucht', 'Im Entwurf'])
  })
})

describe('buildDraft', () => {
  const row = (date: string, amount: number, hash: string): StatementRow => ({
    date,
    name: 'Erika Muster',
    description: `Umsatz ${hash}`,
    amount,
    hash,
    legacyHashes: [],
  })

  function fileWith(bookings: Booking[] = []): YearFile {
    return { ...emptyYearFile(2026), bookings }
  }

  test('migriert offene Entwürfe ohne ausgefüllte Felder zu verändern', () => {
    const original: YearFile = {
      ...fileWith(),
      importDraft: {
        fileName: 'Karnevalskonto · Abruf vom 21.07.2026',
        skipped: 0,
        rows: [{
          date: '2026-06-25',
          bankText: 'Nina Pöpsel, M, Nina – Überweisungsgutschr.',
          amount: 4000,
          hash: 'j8ud73-1n',
          name: 'Nina Pöpsel',
          description: 'T-Shirt Nina',
          selected: true,
          categoryId: 'c1',
          subcategory: 'Kleidung',
          isUmsatz: true,
          receiptStatus: 'vorhanden',
        }],
      },
    }

    const result = migrateImportDraftHashes(original)
    const migrated = result.file.importDraft!.rows[0]

    expect(result.migratedCount).toBe(1)
    expect(migrated.hash).not.toBe('j8ud73-1n')
    const { hash: _newHash, legacyHashes: _legacyHashes, ...userFields } = migrated
    const { hash: _oldHash, ...originalUserFields } = original.importDraft!.rows[0]
    expect(userFields).toEqual(originalUserFields)
    expect(migrated.legacyHashes).toContain('j8ud73-1n')
    expect(original.importDraft!.rows[0].hash).toBe('j8ud73-1n')
  })

  test('sortiert Bank-Reihenfolge (neueste zuerst) chronologisch aufsteigend', () => {
    const { mutate } = buildDraft(
      fileWith(),
      [row('2026-06-20', 7500, 'h1'), row('2026-04-02', -2350, 'h2')],
      'Abruf',
      0,
    )
    const next = mutate(fileWith())
    expect(next.importDraft?.rows.map((r) => r.date)).toEqual(['2026-04-02', '2026-06-20'])
    expect(next.importDraft?.fileName).toBe('Abruf')
  })

  test('wählt denselben Umsatz innerhalb eines Entwurfs nur einmal aus', () => {
    const duplicate = row('2026-06-25', 4000, 'gleicher-hash')
    const { mutate } = buildDraft(fileWith(), [duplicate, { ...duplicate }], 'Abruf', 0)

    expect(mutate(fileWith()).importDraft?.rows.map((draftRow) => draftRow.selected)).toEqual([
      true,
      false,
    ])
  })

  test('wählt Zeilen ab, die sich mit einer manuellen Buchung decken', () => {
    const manual: Booking = {
      id: 'b1',
      date: '2026-04-02',
      categoryId: 'c1',
      description: 'Getränke',
      type: 'ausgabe',
      amount: 2350,
      isUmsatz: true,
      nonUmsatzAmount: 0,
      note: '',
      seq: 1,
      source: 'manuell',
    }
    const { mutate } = buildDraft(
      fileWith([manual]),
      [row('2026-04-02', -2350, 'h2'), row('2026-06-20', 7500, 'h1')],
      'Abruf',
      0,
    )
    const next = mutate(fileWith([manual]))
    const byHash = Object.fromEntries(next.importDraft!.rows.map((r) => [r.hash, r.selected]))
    expect(byHash).toEqual({ h2: false, h1: true })
  })

  test('wählt Zeilen außerhalb des Kassenjahres ab', () => {
    const { mutate } = buildDraft(fileWith(), [row('2025-12-31', 1000, 'h3')], 'Abruf', 0)
    expect(mutate(fileWith()).importDraft?.rows[0].selected).toBe(false)
  })

  describe('appendToDraft', () => {
    test('hängt nur unbekannte Umsätze an und lässt bestehende Zuweisungen unangetastet', () => {
      const base = buildDraft(fileWith(), [row('2026-04-02', -2350, 'h2')], 'Alt', 0).mutate(fileWith())
      // Nutzer hat bereits zugewiesen
      const prepared: YearFile = {
        ...base,
        importDraft: {
          ...base.importDraft!,
          rows: base.importDraft!.rows.map((r) => ({ ...r, description: 'Getränke', categoryId: 'c1' })),
        },
      }

      const { mutate, added } = appendToDraft(
        prepared,
        [row('2026-04-02', -2350, 'h2'), row('2026-06-20', 7500, 'h1')],
        'Neu',
      )
      const next = mutate(prepared)

      expect(added).toBe(1)
      expect(next.importDraft?.rows).toHaveLength(2)
      expect(next.importDraft?.rows[0].description).toBe('Getränke')
      expect(next.importDraft?.rows[0].categoryId).toBe('c1')
      expect(next.importDraft?.rows[1].hash).toBe('h1')
      expect(next.importDraft?.fileName).toBe('Alt')
    })

    test('legt ohne bestehenden Entwurf einen neuen an', () => {
      const file = fileWith()
      const { mutate, added } = appendToDraft(file, [row('2026-06-20', 7500, 'h1')], 'Startabruf')
      const next = mutate(file)
      expect(added).toBe(1)
      expect(next.importDraft?.fileName).toBe('Startabruf')
    })

    test('überspringt bereits importierte Buchungen (Hash) und meldet 0', () => {
      const imported: Booking = {
        id: 'b1',
        date: '2026-06-20',
        categoryId: 'c1',
        description: 'Spende',
        type: 'einnahme',
        amount: 7500,
        isUmsatz: true,
        nonUmsatzAmount: 0,
        note: '',
        seq: 1,
        source: 'import',
        importHash: 'h1',
      }
      const file = fileWith([imported])
      const { added } = appendToDraft(file, [row('2026-06-20', 7500, 'h1')], 'Neu')
      expect(added).toBe(0)
    })
  })
})
