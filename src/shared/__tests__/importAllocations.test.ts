import { describe, expect, test } from 'vitest'
import { buildBackup, validateBackup } from '../backup'
import { bookingKey, makeAssignment, organizationDefaults } from '../organization'
import { importDraftWithAssignments } from '../importAllocations'
import { appendToDraft, bookingParts, buildDraft, draftAllocationError, importSelectedRows, importSelectedRowsDetailed, rowIsImportable } from '../importDraft'
import type { ActivityAllocation } from '../organization'
import type { ImportDraftRow, ImportDraftSplit, YearFile } from '../types'

function row(overrides: Partial<ImportDraftRow> = {}): ImportDraftRow {
  return { date: '2026-06-15', amount: -1001, bankText: 'Originaltext', bankName: 'Bankname', hash: 'fresh-1', name: 'Eigener Name', description: 'Material',
    selected: true, categoryId: 'a', isUmsatz: true, ...overrides }
}
function file(rows: ImportDraftRow[] = [row()]): YearFile {
  return { schemaVersion: 1, year: 2026, konto: 'haupt', openingBalance: 0, clubName: 'Testverein', treasurerName: '',
    categories: [{ id: 'a', name: 'Aktion', code: 'A', active: true, sortOrder: 0 }, { id: 'b', name: 'Andere', code: 'B', active: true, sortOrder: 1 }],
    bookings: [], importDraft: { fileName: 'Konto.csv', skipped: 0, rows } }
}
function split(overrides: Partial<ImportDraftSplit> = {}): ImportDraftSplit {
  return { id: 'part-a', categoryId: 'a', description: 'Teil A', amount: 600, isUmsatz: true, ...overrides }
}
const periodConfig = (data: YearFile) => ({ ...organizationDefaults([data]), rules: [
  { id: 'r-a', konto: 'haupt', categoryId: 'a', area: 'I' as const },
  { id: 'r-b', konto: 'haupt', categoryId: 'b', area: 'W' as const },
] })

describe('Bereiche im Importentwurf', () => {
  test('behält undefined als Default, [] als bewusst offen und echte Anteile getrennt', () => {
    const parts: ActivityAllocation[] = [{ area: 'Z', amount: 501 }, { area: 'W', amount: 500 }]
    expect(bookingParts(row())[0].allocations).toBeUndefined()
    expect(bookingParts(row({ allocations: [] }))[0].allocations).toEqual([])
    expect(bookingParts(row({ allocations: parts }))[0].allocations).toEqual(parts)
    expect(draftAllocationError(1001, undefined)).toBeNull()
    expect(draftAllocationError(1001, [])).toBeNull()
    expect(draftAllocationError(1001, parts)).toBeNull()
    expect(rowIsImportable(row({ allocations: parts }))).toBe(true)
  })
  test.each([
    [{ area: 'I', amount: 1000 }], [{ area: 'I', amount: 1.5 }, { area: 'Z', amount: 999.5 }],
    [{ area: 'I', amount: -1 }, { area: 'Z', amount: 1002 }], [{ area: 'I', amount: 500 }, { area: 'I', amount: 501 }],
    [{ area: 'falsch', amount: 1001 }], null, 'I',
  ].map((value) => [value]))('lehnt ungültige Bereichsaufteilungen vor der Übernahme ab: %j', (allocations) => {
    const invalid = allocations as unknown as ActivityAllocation[]
    expect(draftAllocationError(1001, invalid)).not.toBeNull()
    expect(rowIsImportable(row({ allocations: invalid }))).toBe(false)
  })
  test('prüft Bereiche pro Importteil gegen dessen eigenen Betrag', () => {
    const parts = [split({ allocations: [{ area: 'Z', amount: 600 }] }), split({ id: 'part-b', categoryId: 'b', amount: 401, allocations: [{ area: 'W', amount: 401 }] })]
    expect(rowIsImportable(row({ splits: parts }))).toBe(true)
    expect(rowIsImportable(row({ splits: [{ ...parts[0], allocations: [{ area: 'Z', amount: 1001 }] }, parts[1]] }))).toBe(false)
    expect(rowIsImportable(row({ splits: [{ ...parts[0], amount: 600.5 }, parts[1]] }))).toBe(false)
  })
  test('liefert die wirklichen neuen IDs mit der dazugehörigen expliziten Aufteilung', () => {
    const draft = file([row({ splits: [split({ receiptRef: { categoryId: 'a', refNo: 7 }, allocations: [] }), split({ id: 'part-b', categoryId: 'b', amount: 401, allocations: [{ area: 'Z', amount: 401 }] })] })])
    const original = JSON.stringify(draft)
    const result = importSelectedRowsDetailed(draft)
    expect(result.added).toHaveLength(2)
    expect(result.added[0].allocations).toEqual([])
    expect(result.added[1].allocations).toEqual([{ area: 'Z', amount: 401 }])
    expect(result.file.bookings.map((booking) => booking.id)).toEqual(result.added.map((entry) => entry.booking.id))
    expect(result.added[0].booking.refNo).toBe(7)
    expect(result.added[0].booking.importHash).toBe('fresh-1')
    expect(result.added[1].booking.importHash).toBe('fresh-1')
    expect(result.file.importDraft).toBeNull()
    expect(JSON.stringify(draft)).toBe(original)
    expect(importSelectedRows(draft).bookings).toHaveLength(2)
  })
  test('wendet Kategorie-Defaults auf neue Imports an und erhält manuelle/absichtlich offene Zuweisungen', () => {
    const manual: ActivityAllocation[] = [{ area: 'Z', amount: 1001 }]
    const draft = file([row(), row({ hash: 'fresh-2', date: '2026-06-16', allocations: [] }), row({ hash: 'fresh-3', date: '2026-06-17', allocations: manual })])
    const config = periodConfig(draft)
    const result = importDraftWithAssignments(draft, config)
    expect(result.importedCount).toBe(3)
    const byHash = Object.fromEntries(result.file.bookings.map((booking) => [booking.importHash!, booking]))
    const assignmentFor = (hash: string) => result.organization.assignments[bookingKey({ konto: 'haupt', year: 2026, bookingId: byHash[hash].id })]
    expect(assignmentFor('fresh-1').allocations).toEqual([{ area: 'I', amount: 1001 }])
    expect(assignmentFor('fresh-2')).toBeUndefined()
    expect(assignmentFor('fresh-3').allocations).toEqual(manual)
    expect(config.assignments).toEqual({})
  })
  test('verknüpft bei Splitimports keine Anteile anhand von Listenpositionen', () => {
    const draft = file([row({ splits: [split(), split({ id: 'part-b', categoryId: 'b', amount: 401 })] })])
    const config = periodConfig(draft)
    const result = importDraftWithAssignments(draft, config)
    expect(result.file.bookings).toHaveLength(2)
    for (const booking of result.file.bookings) {
      const entry = result.organization.assignments[bookingKey({ konto: 'haupt', year: 2026, bookingId: booking.id })]
      expect(entry).toEqual(makeAssignment(booking, [{ area: booking.categoryId === 'a' ? 'I' : 'W', amount: booking.amount }]))
    }
    expect(result.organization.transfers).toEqual([])
  })
  test('unvollständige, unbekannte oder doppelte Importzeilen bleiben im Entwurf', () => {
    const draft = file([row({ selected: false }), row({ hash: 'invalid', date: '2026-06-16', allocations: [{ area: 'I', amount: 1 }] }), row({ hash: 'unknown', date: '2026-06-17', categoryId: 'unknown' })])
    const result = importDraftWithAssignments(draft, periodConfig(draft))
    expect(result.importedCount).toBe(0)
    expect(result.file.bookings).toEqual([])
    expect(result.file.importDraft?.rows).toHaveLength(3)
    expect(importSelectedRowsDetailed({ ...draft, importDraft: null })).toMatchObject({ file: { ...draft, importDraft: null }, added: [] })
  })
  test('neue Bankquellen behalten den Originalnamen neben einem später editierbaren Namen', () => {
    const parsed = [{ date: '2026-06-15', amount: -1001, name: 'Bank Original', description: 'Originaltext', hash: 'bank-raw', legacyHashes: [] }]
    const data = file([])
    expect(buildDraft(data, parsed, 'CSV', 0).mutate(data).importDraft?.rows[0].bankName).toBe('Bank Original')
    expect(appendToDraft(data, parsed, 'Bank').mutate(data).importDraft?.rows[0].bankName).toBe('Bank Original')
  })
})

describe('Sicherung von Bereichsangaben im Entwurf', () => {
  test('behält Legacy-Default, bewusst offen und manuelle Anteile im Roundtrip', () => {
    const rows = [row(), row({ allocations: [] }), row({ allocations: [{ area: 'Z', amount: 1001 }], splits: [split({ allocations: [{ area: 'I', amount: 600 }] }), split({ id: 'b', amount: 401, allocations: [] })] })]
    const data = file(rows)
    const backup = JSON.parse(JSON.stringify(buildBackup([data], { organization: periodConfig(data) }, '2026-11-04T12:00:00Z')))
    const validated = validateBackup(backup)
    expect(validated.ok).toBe(true)
    if (validated.ok) {
      const restored = validated.backup.years[0].importDraft!.rows
      expect(restored[0].allocations).toBeUndefined()
      expect(restored[1].allocations).toEqual([])
      expect(restored[2].allocations).toEqual([{ area: 'Z', amount: 1001 }])
      expect(restored[2].splits?.[0].allocations).toEqual([{ area: 'I', amount: 600 }])
      expect(restored[0].bankName).toBe('Bankname')
    }
  })
  test('sichert unvollständige Entwürfe strukturell, lässt sie aber noch nicht übernehmen', () => {
    const unfinished = row({ allocations: [{ area: 'I', amount: 700 }, { area: 'Z', amount: 0 }] })
    const unfinishedSplit = row({ splits: [split({ allocations: [{ area: 'I', amount: 70 }, { area: 'Z', amount: 0 }] }), split({ id: 'b', amount: 401 })] })
    const data = file([unfinished, unfinishedSplit])
    const serialized = JSON.parse(JSON.stringify(buildBackup([data], {}, '2026-11-04T12:00:00Z')))
    const result = validateBackup(serialized)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup.years[0].importDraft!.rows).toEqual(data.importDraft!.rows)
    expect(rowIsImportable(unfinished)).toBe(false)
    expect(rowIsImportable(unfinishedSplit)).toBe(false)
  })
  test('bei Teilbuchungen blockiert ein ungenutzter Row-Override keine gültigen Teilzuordnungen', () => {
    const original = row({ allocations: [{ area: 'I', amount: 123 }], splits: [split(), split({ id: 'b', amount: 401 })] })
    expect(rowIsImportable(original)).toBe(true)
  })
  test('verhindert defekte Anteile und nicht-textuelle Originalnamen vor dem Wiederherstellen', () => {
    for (const changed of [row({ allocations: [{ area: 'I', amount: -1 }] }), row({ bankName: 42 as unknown as string }), row({ splits: [split({ amount: 1001, allocations: [{ area: 'falsch' as 'I', amount: 999 }] })] })]) {
      expect(validateBackup(buildBackup([file([changed])], {}, '2026-11-04T12:00:00Z')).ok).toBe(false)
    }
  })
})
