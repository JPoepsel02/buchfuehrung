import { describe, expect, test } from 'vitest'
import { receiptAvailableForImport } from '../importDraft'

describe('receiptAvailableForImport', () => {
  test('behandelt alte Importentwürfe ohne Feld als nicht vorhanden', () => {
    expect(receiptAvailableForImport({})).toBe(false)
  })

  test('übernimmt nur einen ausdrücklich gesetzten Beleg-Haken', () => {
    expect(receiptAvailableForImport({ receiptAvailable: true })).toBe(true)
    expect(receiptAvailableForImport({ receiptAvailable: false })).toBe(false)
  })
})
