import { describe, expect, test } from 'vitest'
import { bookingMatchesSelectionFilter, selectBookingRange } from '../bookingSelection'

const rows = [
  { id: 'b1', categoryId: 'karneval', subcategory: 'Getränke', amount: 7000 },
  { id: 'b2', categoryId: 'karneval', subcategory: 'Kostüme', amount: 7000 },
  { id: 'b3', categoryId: 'karneval', subcategory: 'Getränke', amount: 5000 },
  { id: 'b4', categoryId: 'ostern', subcategory: 'Getränke', amount: 7000 },
]

describe('selectBookingRange', () => {
  test('wählt beim Shift-Klick den sichtbaren Bereich einschließlich Start und Ziel', () => {
    const selected = selectBookingRange(new Set(['vorhanden']), rows.map((row) => row.id), 'b1', 'b3', true)

    expect([...selected]).toEqual(['vorhanden', 'b1', 'b2', 'b3'])
  })

  test('kann einen Bereich per Shift auch abwählen', () => {
    const selected = selectBookingRange(
      new Set(['b1', 'b2', 'b3', 'b4']),
      rows.map((row) => row.id),
      'b1',
      'b3',
      false,
    )

    expect([...selected]).toEqual(['b4'])
  })

  test('fällt bei einem nicht sichtbaren Anker auf die Zielzeile zurück', () => {
    expect([...selectBookingRange(new Set(), ['b2', 'b3'], 'b1', 'b3', true)]).toEqual(['b3'])
  })
})

describe('bookingMatchesSelectionFilter', () => {
  test('kombiniert Kategorie, exakten Betrag und Unterkategorie', () => {
    const matches = rows.filter((row) => bookingMatchesSelectionFilter(row, {
      categoryId: 'karneval',
      amount: 7000,
      subcategory: 'getränke',
    }))

    expect(matches.map((row) => row.id)).toEqual(['b1'])
  })

  test('jeder Filter kann einzeln verwendet werden', () => {
    expect(rows.filter((row) => bookingMatchesSelectionFilter(row, {
      categoryId: 'karneval', amount: null, subcategory: '',
    })).map((row) => row.id)).toEqual(['b1', 'b2', 'b3'])
    expect(rows.filter((row) => bookingMatchesSelectionFilter(row, {
      categoryId: '', amount: 7000, subcategory: '',
    })).map((row) => row.id)).toEqual(['b1', 'b2', 'b4'])
    expect(rows.filter((row) => bookingMatchesSelectionFilter(row, {
      categoryId: '', amount: null, subcategory: ' GETRÄNKE ',
    })).map((row) => row.id)).toEqual(['b1', 'b3', 'b4'])
  })

  test('ohne gesetzte Kriterien bleiben alle Buchungen sichtbar', () => {
    expect(rows.every((row) => bookingMatchesSelectionFilter(row, {
      categoryId: '', amount: null, subcategory: '',
    }))).toBe(true)
  })
})
