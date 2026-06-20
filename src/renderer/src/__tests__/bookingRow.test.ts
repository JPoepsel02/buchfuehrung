import { describe, expect, test, vi } from 'vitest'
import { shouldStartBookingEdit } from '../bookingRow'

describe('shouldStartBookingEdit', () => {
  test('startet die Bearbeitung bei einem Klick auf normalen Zeileninhalt', () => {
    const target = { closest: vi.fn(() => null) }

    expect(shouldStartBookingEdit(target)).toBe(true)
  })

  test.each(['button', 'input', 'label', 'a', 'select', 'textarea'])(
    'ignoriert Klicks innerhalb von %s',
    (element) => {
      const target = {
        closest: vi.fn((selector: string) => (selector.includes(element) ? {} : null)),
      }

      expect(shouldStartBookingEdit(target)).toBe(false)
    },
  )
})
