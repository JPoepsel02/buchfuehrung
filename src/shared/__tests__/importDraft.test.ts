import { describe, expect, test } from 'vitest'
import { receiptAvailableForImport, subcategorySuggestions } from '../importDraft'

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
})
