import { describe, expect, test } from 'vitest'
import {
  allOrganizationBookings, applyCategoryDefaultReferences, bookingKey, categoryAllocations,
  categoryDefaultCandidates, createTransfer, makeAssignment, organizationDefaults,
} from '../organization'
import type { ActivityAllocation, OrganizationConfig } from '../organization'
import type { Booking, YearFile } from '../types'

function booking(id: string, overrides: Partial<Booking> = {}): Booking {
  return { id, date: '2026-06-15', categoryId: 'event', description: id, type: 'einnahme', amount: 1000,
    isUmsatz: true, nonUmsatzAmount: 0, note: '', seq: 1, source: 'manuell', ...overrides }
}
function file(konto = 'haupt', bookings: Booking[] = []): YearFile {
  return { schemaVersion: 1, year: 2026, konto, openingBalance: 0, clubName: 'Verein', treasurerName: '',
    categories: [{ id: 'event', name: 'Aktion', code: 'A', active: true, sortOrder: 0 }], bookings }
}
function organization(files: YearFile[]): OrganizationConfig {
  return { ...organizationDefaults(files), rules: [{ id: 'rule', konto: 'haupt', categoryId: 'event', area: 'I' }] }
}
const reference = (bookingId: string, konto = 'haupt') => ({ konto, year: 2026, bookingId })

describe('Kategorie-Standardbereich', () => {
  test('löst Konto und Kategorie exakt auf und liefert frische Cent-Anteile', () => {
    const config = organization([])
    expect(categoryAllocations(config, 'haupt', 'event', 1001)).toEqual([{ area: 'I', amount: 1001 }])
    expect(categoryAllocations(config, 'zweit', 'event', 1001)).toEqual([])
    expect(categoryAllocations(config, 'haupt', 'andere', 1001)).toEqual([])
    const first = categoryAllocations(config, 'haupt', 'event', 1001)
    const second = categoryAllocations(config, 'haupt', 'event', 1001)
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
  })
  test.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('legt für ungültige Centbeträge keinen Anteil an: %s', (amount) => {
    expect(categoryAllocations(organization([]), 'haupt', 'event', amount)).toEqual([])
  })
  test('Regeln allein verändern bestehende Buchungen nicht', () => {
    const files = [file('haupt', [booking('offen')])]
    const config = organization(files)
    expect(allOrganizationBookings(files, config)[0].status).toBe('open')
    expect(Object.keys(config.assignments)).toEqual([])
    expect(categoryDefaultCandidates(files, config).map((row) => row.booking.id)).toEqual(['offen'])
  })
  test('bietet nur sichere Buchungen ohne jede vorhandene Zuordnung oder Transferverknüpfung an', () => {
    const files = [file('haupt', [booking('offen'), booking('manuell'), booking('split'), booking('invalid'), booking('out', { type: 'ausgabe' })]), file('zweit', [booking('in')])]
    const config = organization(files)
    config.assignments = {
      [bookingKey(reference('manuell'))]: makeAssignment(booking('manuell'), [{ area: 'W', amount: 1000 }]),
      [bookingKey(reference('split'))]: makeAssignment(booking('split'), [{ area: 'I', amount: 400 }, { area: 'Z', amount: 600 }]),
      [bookingKey(reference('invalid'))]: makeAssignment(booking('invalid', { amount: 2000 }), [{ area: 'W', amount: 2000 }]),
    }
    config.transfers = [createTransfer(files, reference('out'), reference('in', 'zweit'))]
    expect(categoryDefaultCandidates(files, config).map((row) => row.booking.id)).toEqual(['offen'])
    config.transfers = [{ ...config.transfers[0], amount: 999 }]
    expect(categoryDefaultCandidates(files, config).map((row) => row.booking.id)).toEqual(['offen'])
  })
  test('bestätigt nur explizit ausgewählte Referenzen und erhält alle bisherigen Zuordnungen', () => {
    const manual = booking('manuell')
    const files = [file('haupt', [booking('erste'), booking('zweite'), manual])]
    const config = organization(files)
    config.assignments = { [bookingKey(reference('manuell'))]: makeAssignment(manual, [{ area: 'W', amount: 1000 }]) }
    const before = JSON.stringify(config)
    const next = applyCategoryDefaultReferences(files, config, [reference('erste')])
    expect(next.assignments[bookingKey(reference('erste'))].allocations).toEqual([{ area: 'I', amount: 1000 }])
    expect(next.assignments[bookingKey(reference('zweite'))]).toBeUndefined()
    expect(next.assignments[bookingKey(reference('manuell'))]).toEqual(config.assignments[bookingKey(reference('manuell'))])
    expect(JSON.stringify(config)).toBe(before)
    expect(applyCategoryDefaultReferences(files, config, [])).toBe(config)
  })
  test('verhindert eine veraltete Vorschau statt neue manuelle Entscheidungen zu überschreiben', () => {
    const files = [file('haupt', [booking('erste'), booking('zweite')])]
    const config = organization(files)
    const updated = { ...config, assignments: { [bookingKey(reference('zweite'))]: makeAssignment(booking('zweite'), [{ area: 'W', amount: 1000 }]) } }
    expect(() => applyCategoryDefaultReferences(files, updated, [reference('erste'), reference('zweite')])).toThrow()
    expect(updated.assignments[bookingKey(reference('erste'))]).toBeUndefined()
    expect(() => applyCategoryDefaultReferences(files, config, [reference('fehlt')])).toThrow()
    expect(() => applyCategoryDefaultReferences(files, { ...config, rules: [] }, [reference('erste')])).toThrow()
  })
  test('arbeitet centgenau mit bestehenden Splits als unantastbarer manueller Entscheidung', () => {
    const original = booking('split')
    const allocations: ActivityAllocation[] = [{ area: 'I', amount: 333 }, { area: 'Z', amount: 667 }]
    const files = [file('haupt', [original])]
    const config = { ...organization(files), assignments: { [bookingKey(reference('split'))]: makeAssignment(original, allocations) } }
    expect(categoryDefaultCandidates(files, config)).toEqual([])
    expect(() => applyCategoryDefaultReferences(files, config, [reference('split')])).toThrow()
    expect(config.assignments[bookingKey(reference('split'))].allocations).toEqual(allocations)
  })
})
