import { describe, expect, test } from 'vitest'
import { fiscalEndLabel, fiscalLabel, fiscalRange, inFiscalYear, prevFiscalEndLabel } from '../fiscal'

describe('Wirtschaftsjahr (Karnevalskonto: November–Oktober)', () => {
  const karneval = { year: 2025, fiscalStartMonth: 11 }
  const haupt = { year: 2026 }

  test('Label: Kalenderjahr bzw. Jahresspanne', () => {
    expect(fiscalLabel(haupt)).toBe('2026')
    expect(fiscalLabel(karneval)).toBe('2025/2026')
  })

  test('Zeitraum: 01.11.2025 bis 31.10.2026', () => {
    expect(fiscalRange(karneval)).toEqual({ start: '2025-11-01', end: '2026-10-31' })
    expect(fiscalRange(haupt)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  test('inFiscalYear: Jahreswechsel innerhalb des Wirtschaftsjahres', () => {
    expect(inFiscalYear(karneval, '2025-11-01')).toBe(true)
    expect(inFiscalYear(karneval, '2026-02-14')).toBe(true)
    expect(inFiscalYear(karneval, '2026-10-31')).toBe(true)
    expect(inFiscalYear(karneval, '2025-10-31')).toBe(false)
    expect(inFiscalYear(karneval, '2026-11-01')).toBe(false)
  })

  test('Abschluss-Labels', () => {
    expect(fiscalEndLabel(karneval)).toBe('31.10.2026')
    expect(prevFiscalEndLabel(karneval)).toBe('31.10.2025')
    expect(fiscalEndLabel(haupt)).toBe('31.12.2026')
  })

  test('ungültiger Startmonat fällt auf Januar zurück', () => {
    expect(fiscalLabel({ year: 2026, fiscalStartMonth: 0 })).toBe('2026')
    expect(fiscalLabel({ year: 2026, fiscalStartMonth: 13 })).toBe('2026')
  })
})
