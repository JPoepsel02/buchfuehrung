import { beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyYearFile } from '@shared/defaults'
import type { BankAccountConfig, YearFile } from '@shared/types'
import { api } from '../api'
import { runStartupBankFetch } from '../autoFetch'

vi.mock('../api', () => ({ api: {
  bankPinExists: vi.fn(), bankFetch: vi.fn(), bankCancel: vi.fn(), listYears: vi.fn(),
  saveYear: vi.fn(), loadYear: vi.fn(),
} }))

const account: BankAccountConfig = { id: 'test', konto: 'zweit', label: 'Testkonto', blz: '12345678',
  fintsUrl: 'https://bank.example.test/fints', userId: 'test', accountNumber: '12345' }
const row = { date: '2026-02-01', amount: 1200, name: 'Mitglied', description: 'Beitrag' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.bankPinExists).mockResolvedValue(true)
  vi.mocked(api.listYears).mockResolvedValue([2026, 2025])
  vi.mocked(api.bankFetch).mockResolvedValue({ status: 'ok', rows: [row] })
  vi.mocked(api.bankCancel).mockResolvedValue(undefined)
})

describe('startup bank fetch', () => {
  test('updates the current store snapshot of an inactive account without writing around the store', async () => {
    let current: YearFile = { ...emptyYearFile(2026), konto: 'zweit', treasurerName: 'Neu bearbeitet' }
    const applyToAccount = vi.fn(async (_konto, _year, mutate: (file: YearFile) => YearFile) => { current = mutate(current) })
    const result = await runStartupBankFetch({ accounts: [account], applyToAccount })
    expect(applyToAccount).toHaveBeenCalledWith('zweit', 2026, expect.any(Function), account.id)
    expect(current.treasurerName).toBe('Neu bearbeitet')
    expect(current.importDraft?.rows).toHaveLength(1)
    expect(current.importDraft?.rows[0]).toMatchObject({ bankText: row.description, amount: row.amount })
    expect(api.loadYear).not.toHaveBeenCalled()
    expect(api.saveYear).not.toHaveBeenCalled()
    expect(result).toContain('Testkonto: 1 neue Umsätze')
    current = { ...current, importDraft: { ...current.importDraft!, rows: current.importDraft!.rows.map((entry) => ({ ...entry, name: 'Individuell zugeordnet' })) } }
    expect(await runStartupBankFetch({ accounts: [account], applyToAccount })).toBeNull()
    expect(current.importDraft?.rows[0].name).toBe('Individuell zugeordnet')
    expect(current.importDraft?.rows).toHaveLength(1)
  })

  test('skips accounts without a saved PIN or selected account and cancels TAN sessions', async () => {
    const applyToAccount = vi.fn()
    vi.mocked(api.bankPinExists).mockResolvedValueOnce(false)
    expect(await runStartupBankFetch({ accounts: [{ ...account, accountNumber: undefined }, account], applyToAccount })).toBeNull()
    expect(api.bankFetch).not.toHaveBeenCalled()
    vi.mocked(api.bankFetch).mockResolvedValue({ status: 'tanPending', sessionId: 'session', challenge: '', decoupled: true })
    expect(await runStartupBankFetch({ accounts: [account], applyToAccount })).toBeNull()
    expect(api.bankCancel).toHaveBeenCalledWith('session')
    expect(applyToAccount).not.toHaveBeenCalled()
  })

  test('reports persistence failures and continues independent accounts without claiming a saved import', async () => {
    const onError = vi.fn()
    const applyToAccount = vi.fn().mockRejectedValueOnce(new Error('Datenträger voll')).mockResolvedValue(undefined)
    expect(await runStartupBankFetch({ accounts: [account, { ...account, id: 'second' }], applyToAccount, onError })).toBeNull()
    expect(onError).toHaveBeenCalledWith('Testkonto', expect.objectContaining({ message: 'Datenträger voll' }))
    expect(applyToAccount).toHaveBeenCalledTimes(2)
  })

  test('skips missing years, empty responses and interactive account selection', async () => {
    const applyToAccount = vi.fn()
    vi.mocked(api.listYears).mockResolvedValue([])
    expect(await runStartupBankFetch({ accounts: [account], applyToAccount })).toBeNull()
    expect(api.bankPinExists).not.toHaveBeenCalled()
    expect(api.bankFetch).not.toHaveBeenCalled()
    vi.mocked(api.listYears).mockResolvedValue([2026])
    vi.mocked(api.bankFetch).mockResolvedValueOnce({ status: 'ok', rows: [] }).mockResolvedValueOnce({ status: 'chooseAccount', accounts: [] })
    await runStartupBankFetch({ accounts: [account, account], applyToAccount })
    expect(applyToAccount).not.toHaveBeenCalled()
  })
})
