import { describe, expect, test } from 'vitest'
import { emptyYearFile } from '@shared/defaults'
import { legacyRowHashes, rowHash } from '@shared/csv'
import { mergeImportResponse } from '../importResponse'
import type { StatementRow } from '@shared/csv'

function row(description: string, amount = 1200): StatementRow {
  return { date: '2026-05-01', amount, description, name: 'Testmitglied',
    hash: rowHash('2026-05-01', amount, description), legacyHashes: legacyRowHashes('2026-05-01', amount, description) }
}

describe('mergeImportResponse', () => {
  test('erstellt den ersten Entwurf aus dem aktuellen Zieljahr', () => {
    const current = { ...emptyYearFile(2026), konto: 'zweit', treasurerName: 'Inzwischen geändert' }
    const result = mergeImportResponse(current, [row('Neu')], 'Auszug.csv', 2)
    expect(result.file.konto).toBe('zweit')
    expect(result.file.treasurerName).toBe('Inzwischen geändert')
    expect(result.file.importDraft).toMatchObject({ fileName: 'Auszug.csv', skipped: 2, rows: [{ bankText: 'Neu' }] })
    expect(result.freshCount).toBe(1)
    expect(current.importDraft).toBeUndefined()
  })

  test('hängt bei einer zwischenzeitlichen Zuordnung nur neue Umsätze an', () => {
    const base = { ...emptyYearFile(2026), konto: 'haupt' }
    const first = mergeImportResponse(base, [row('Zuerst angekommen')], 'Neuere Antwort.csv', 0).file
    const assigned = { ...first, importDraft: { ...first.importDraft!, rows: first.importDraft!.rows.map((draft) => ({
      ...draft, selected: true, name: 'Bearbeiteter Name', description: 'Bereits zugeordnet',
      categoryId: first.categories[0].id, allocations: [{ area: 'I' as const, amount: 1200 }],
    })) } }
    const result = mergeImportResponse(assigned, [row('Verspätete Antwort'), row('Zuerst angekommen')], 'Ältere Antwort.csv', 8)
    expect(result.file.importDraft?.fileName).toBe('Neuere Antwort.csv')
    expect(result.file.importDraft?.rows).toHaveLength(2)
    expect(result.file.importDraft?.rows[0]).toEqual(assigned.importDraft.rows[0])
    expect(result.file.importDraft?.rows[1]).toMatchObject({ bankText: 'Verspätete Antwort', selected: false })
    expect(result.freshCount).toBe(1)
  })

  test('entfernt keinen offenen Entwurf, wenn die verspätete Antwort nur bekannte Zeilen enthält', () => {
    const first = mergeImportResponse(emptyYearFile(2026), [row('Schon da')], 'Erster Auszug', 0).file
    const result = mergeImportResponse(first, [row('Schon da')], 'Wiederholung', 0)
    expect(result.file.importDraft).toEqual(first.importDraft)
    expect(result.freshCount).toBe(0)
  })
})
