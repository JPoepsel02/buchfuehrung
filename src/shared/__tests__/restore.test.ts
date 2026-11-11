import { describe, expect, test } from 'vitest'
import { buildBackup } from '../backup'
import { buildRestoreSnapshot } from '../restore'
import { allOrganizationBookings, makeAssignment, validateOrganizationConfig } from '../organization'
import { validateSnapshot } from '../snapshot'
import type { AppSettings, Booking, YearFile } from '../types'
import type { OrganizationConfig, OrganizationTransfer } from '../organization'

const booking = (id: string, year: number, type: Booking['type'] = 'einnahme'): Booking => ({
  id, seq: 1, refNo: 1, date: `${year}-02-01`, categoryId: 'b', name: 'Test', description: 'Beitrag',
  type, amount: 1000, isUmsatz: false, nonUmsatzAmount: 0, note: '', source: 'manuell',
})
const year = (konto: string, number: number): YearFile => ({ schemaVersion: 1, konto, year: number,
  openingBalance: 0, clubName: 'Test', treasurerName: 'Person', categories: [
    { id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 1 },
  ], bookings: [booking(`${konto}-${number}`, number)] })
const key = (konto: string, number: number) => JSON.stringify([konto, number, `${konto}-${number}`])
const organization = (): OrganizationConfig => ({ name: 'Test', treasurerName: 'Person', rules: [], assignments: {}, transfers: [] })
const transfer = (id: string, number: number, from = 'haupt', to = 'zweit'): OrganizationTransfer => ({
  id, from: { konto: from, year: number, bookingId: `${from}-${number}` },
  to: { konto: to, year: number, bookingId: `${to}-${number}` }, amount: 1000,
  fromDate: `${number}-02-01`, toDate: `${number}-02-01`,
})

describe('partial restore', () => {
  test('keeps unrelated years, allocations, transfers, account numbers and bank accounts', () => {
    const existing = [year('haupt', 2025), year('haupt', 2026), year('k3', 2026), year('k4', 2026)]
    const imported = [year('haupt', 2025), year('zweit', 2025)]
    const kept = makeAssignment(existing[2].bookings[0], [{ area: 'I', amount: 1000 }])
    const incoming = makeAssignment(imported[0].bookings[0], [{ area: 'Z', amount: 1000 }])
    const bank = (id: string, konto: string) => ({ id, konto, label: 'Testbank', blz: '12345678', userId: 'Test', fintsUrl: 'https://bank.example.test/fints' })
    const settings: AppSettings = { theme: 'hell', cloudBackupEnabled: true, cloudBackupDir: '/unused-cloud',
      accountNumbers: { haupt: 'DE111', k3: 'DE333' }, bankAccounts: [bank('bank1', 'k3'), bank('bank2', 'haupt')],
      organization: { ...organization(), rules: [{ id: 'r', konto: 'k3', categoryId: 'b', area: 'I' }],
        assignments: { [key('k3', 2026)]: kept }, transfers: [transfer('collision', 2026, 'k3', 'k4')] },
    }
    const source = buildBackup(imported, { accountNumbers: { haupt: 'DE222', k3: 'DE000' }, bankAccounts: [bank('bank1', 'haupt')],
      organization: { ...organization(), rules: [{ id: 'r', konto: 'haupt', categoryId: 'b', area: 'Z' }, { id: 'foreign', konto: 'k3', categoryId: 'b', area: 'W' }],
        assignments: { [key('haupt', 2025)]: incoming, [key('k3', 2026)]: incoming }, transfers: [transfer('collision', 2025)] },
    }, '2026-11-01T00:00:00Z')
    const snapshot = buildRestoreSnapshot(source, settings, existing)
    expect(snapshot.years.map((entry) => `${entry.konto}:${entry.year}`)).toEqual(['haupt:2025', 'zweit:2025'])
    expect(snapshot.settings?.organization?.assignments).toEqual({ [key('k3', 2026)]: kept, [key('haupt', 2025)]: incoming })
    expect(snapshot.settings?.organization?.rules.map((entry) => [entry.konto, entry.area])).toEqual([['k3', 'I'], ['haupt', 'Z']])
    expect(snapshot.settings?.organization?.transfers).toHaveLength(2)
    expect(new Set(snapshot.settings?.organization?.transfers.map((entry) => entry.id)).size).toBe(2)
    expect(snapshot.settings?.accountNumbers).toEqual({ haupt: 'DE222', k3: 'DE333' })
    expect(snapshot.settings?.bankAccounts?.map((entry) => entry.konto)).toEqual(['k3', 'haupt'])
    expect(new Set(snapshot.settings?.bankAccounts?.map((entry) => entry.id)).size).toBe(2)
    expect(snapshot.settings?.bankAccounts?.find((entry) => entry.konto === 'k3')?.id).toBe('bank1')
    expect(snapshot.settings?.bankAccounts?.find((entry) => entry.konto === 'haupt')?.id).not.toBe('bank1')
    expect(snapshot.settings?.bankAccounts?.find((entry) => entry.konto === 'haupt')?.id).not.toBe('bank2')
    expect(snapshot.settings).toMatchObject({ cloudBackupEnabled: false, cloudBackupDir: null, theme: 'hell' })
    expect(snapshot.settings?.kontoSequence).toBe(4)
    expect(validateSnapshot(snapshot)).toEqual([])
    expect(validateOrganizationConfig(snapshot.settings!.organization)).toEqual([])
    expect(settings.cloudBackupEnabled).toBe(true)
  })

  test('disables cloud even for legacy backups without any settings and retains existing settings', () => {
    const current: AppSettings = { theme: 'dunkel', cloudBackupEnabled: true, cloudBackupDir: '/never-touch', organization: organization() }
    const result = buildRestoreSnapshot(buildBackup([year('haupt', 2026)], undefined, '2026-11-01T00:00:00Z'), current)
    expect(result.settings).toMatchObject({ ...current, cloudBackupEnabled: false, cloudBackupDir: null, kontoSequence: 1 })
    expect(current.cloudBackupEnabled).toBe(true)
  })

  test('replaces target allocations and touching transfers while keeping foreign years intact', () => {
    const current: AppSettings = { organization: { ...organization(),
      assignments: { [key('haupt', 2025)]: makeAssignment(booking('haupt-2025', 2025), [{ area: 'W', amount: 1000 }]) },
      transfers: [transfer('old', 2025)],
    } }
    const imported = buildBackup([year('haupt', 2025), year('zweit', 2025)], undefined, '2026-11-01T00:00:00Z')
    expect(buildRestoreSnapshot(imported, current).settings?.organization).toEqual(organization())
  })

  test('preserves a crossing transfer on a partial restore and flags changed endpoints for review', () => {
    const main = year('haupt', 2025), second = year('zweit', 2025)
    main.bookings[0] = { ...main.bookings[0], type: 'ausgabe' }
    const current: AppSettings = { organization: { ...organization(), transfers: [transfer('cross', 2025)] } }
    const imported = buildBackup([main], { organization: organization() }, '2026-11-01T00:00:00Z')
    const restored = buildRestoreSnapshot(imported, current, [main, second])
    expect(restored.settings?.organization?.transfers).toEqual(current.organization!.transfers)
    const entries = allOrganizationBookings([main, second], restored.settings!.organization!)
    expect(entries.every((entry) => entry.transferId === 'cross')).toBe(true)
    const changed = { ...main, bookings: [{ ...main.bookings[0], amount: 1100 }] }
    const changedSnapshot = buildRestoreSnapshot({ ...imported, years: [changed] }, current, [main, second])
    const invalid = allOrganizationBookings([changed, second], changedSnapshot.settings!.organization!)
    expect(invalid.every((entry) => entry.status === 'invalid' && !entry.transferId)).toBe(true)
  })

  test('keeps imported crossing transfer metadata instead of silently turning it into ordinary income or expenses', () => {
    const main = year('haupt', 2025), second = year('zweit', 2025)
    main.bookings[0] = { ...main.bookings[0], type: 'ausgabe' }
    const imported = buildBackup([main], { organization: { ...organization(), transfers: [transfer('cross', 2025)] } }, '2026-11-01T00:00:00Z')
    const restored = buildRestoreSnapshot(imported, {}, [second])
    expect(restored.settings?.organization?.transfers).toHaveLength(1)
    expect(allOrganizationBookings([main, second], restored.settings!.organization!).every((entry) => entry.transferId === 'cross')).toBe(true)
  })

  test('requires a new bank credential identity even when an imported configuration uses the existing account ID', () => {
    const bank = { id: 'same', konto: 'haupt', label: 'Test', blz: '12345678', userId: 'Test', fintsUrl: 'https://bank.example.test/fints' }
    const imported = buildBackup([year('haupt', 2026)], { bankAccounts: [bank] }, '2026-11-01T00:00:00Z')
    const restored = buildRestoreSnapshot(imported, { bankAccounts: [bank] })
    expect(restored.settings?.bankAccounts?.[0].id).not.toBe(bank.id)
    expect(imported.settings?.bankAccounts?.[0].id).toBe(bank.id)
  })

  test('never rolls back reserved account identifiers from current or imported history', () => {
    const backup = buildBackup([year('haupt', 2026)], { kontoSequence: 3 }, '2026-11-01T00:00:00Z')
    expect(buildRestoreSnapshot(backup, { kontoSequence: 12 }).settings?.kontoSequence).toBe(12)
    expect(buildRestoreSnapshot(backup, {}, [year('k18', 2025)]).settings?.kontoSequence).toBe(18)
    expect(buildRestoreSnapshot(backup, { accountNumbers: { k20: '20' } }).settings?.kontoSequence).toBe(20)
    backup.settings = { organization: { ...organization(), rules: [{ id: 'old', konto: 'k25', categoryId: 'gone', area: 'I' }] } }
    expect(buildRestoreSnapshot(backup, {}).settings?.kontoSequence).toBe(25)
  })
})
