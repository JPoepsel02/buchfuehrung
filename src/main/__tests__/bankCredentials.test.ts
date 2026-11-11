import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BankAccountConfig } from '../../shared/types'

const runtime = vi.hoisted(() => ({
  directory: '', accounts: [] as BankAccountConfig[], encryptionAvailable: true,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  first: vi.fn(), cached: vi.fn(), created: vi.fn(), decrypt: vi.fn(), statements: vi.fn(),
  nextSyncUrl: undefined as string | undefined,
}))

vi.mock('electron', () => ({
  app: { getPath: () => runtime.directory, getVersion: () => '1.17.0' },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => runtime.handlers.set(name, handler) },
  safeStorage: {
    isEncryptionAvailable: () => runtime.encryptionAvailable,
    encryptString: (text: string) => Buffer.from(`test-encrypted:${text}`),
    decryptString: (value: Buffer) => { runtime.decrypt(); const text = value.toString(); if (!text.startsWith('test-encrypted:')) throw new Error('Invalid ciphertext'); return text.slice(15) },
  },
}))
vi.mock('../storage', () => ({ loadSettings: () => ({ bankAccounts: runtime.accounts }) }))
vi.mock('lib-fints', () => {
  const methods = [{ id: 999, name: 'Banking-App', isDecoupled: true, activeTanMedia: [] }]
  const config = (url: string, blz: string, userId: string, pin: string, bankingInformation?: unknown) => ({
    userId, pin, bankingInformation: bankingInformation ?? { systemId: 'test', bankMessages: [], bpd: { url, bankId: blz } },
    availableTanMethods: methods, selectedTanMethod: methods[0],
    get bankingUrl() { return (this.bankingInformation as { bpd: { url: string } }).bpd.url },
    get bankId() { return (this.bankingInformation as { bpd: { bankId: string } }).bpd.bankId },
  })
  return {
    FinTSConfig: {
      forFirstTimeUse: (...args: string[]) => { runtime.first(...args); return config(args[2], args[3], args[4], args[5]) },
      fromBankingInformation: (...args: unknown[]) => { runtime.cached(...args); return config('', '', args[3] as string, args[4] as string, args[2]) },
    },
    FinTSClient: class {
      config: ReturnType<typeof config>
      constructor(value: ReturnType<typeof config>) { this.config = value; runtime.created(value) }
      selectTanMethod() {}
      selectTanMedia() {}
      async synchronize() {
        if (runtime.nextSyncUrl) (this.config.bankingInformation as { bpd: { url: string } }).bpd.url = runtime.nextSyncUrl
        return { success: true, requiresTan: false, bankAnswers: [] }
      }
      async getAccountStatements() { return runtime.statements() }
      async getAccountStatementsWithTan() { return runtime.statements() }
    },
  }
})

import { registerBankIpc } from '../bank'

const account: BankAccountConfig = { id: 'bank-test', konto: 'haupt', label: 'Testbank',
  fintsUrl: 'https://bank.example.test/fints', blz: '12345678', userId: 'test-user', accountNumber: '12345' }
const invoke = (name: string, ...args: unknown[]) => runtime.handlers.get(name)!({}, ...args)
const fetch = (value = account, opts = {}) => invoke('bank:fetch', value, opts) as Promise<{ status: string }>
const pinsFile = () => join(runtime.directory, 'bank', 'pins.json')
const infoFile = () => join(runtime.directory, 'bank', 'fints-bank-test.json')

beforeEach(() => {
  runtime.directory = mkdtempSync(join(tmpdir(), 'buchfuehrung-bank-identity-'))
  runtime.accounts = [{ ...account }]
  runtime.encryptionAvailable = true
  runtime.nextSyncUrl = undefined
  runtime.handlers.clear()
  vi.clearAllMocks()
  runtime.statements.mockReset().mockResolvedValue({ success: true, requiresTan: false, statements: [] })
  registerBankIpc()
})
afterEach(() => rmSync(runtime.directory, { recursive: true, force: true }))

describe('bank credential identity', () => {
  test('encrypts the connection binding with the PIN and reuses it only for the same connection', async () => {
    expect(await fetch(account, { pin: 'test-pin', savePin: true })).toMatchObject({ status: 'ok' })
    expect(readFileSync(pinsFile(), 'utf8')).not.toContain('test-pin')
    expect(invoke('bank:pin:has', account.id)).toBe(true)
    vi.clearAllMocks()
    expect(await fetch({ ...account, label: 'Umbenannt', accountNumber: '67890' })).toMatchObject({ status: 'ok' })
    expect(runtime.first).not.toHaveBeenCalled()
    expect(runtime.cached).toHaveBeenCalledOnce()
    expect(runtime.cached.mock.calls[0][4]).toBe('test-pin')
  })

  test.each([
    { fintsUrl: 'https://other.example.test/fints' },
    { fintsUrl: 'https://bank.example.test/another' },
    { blz: '87654321' },
    { userId: 'other-user' },
  ])('does not send a stored PIN after connection changes: %j', async (patch) => {
    await fetch(account, { pin: 'test-pin', savePin: true })
    const changed = { ...account, ...patch }
    runtime.accounts = [changed]
    vi.clearAllMocks()
    expect(invoke('bank:pin:has', account.id)).toBe(false)
    expect(await fetch(changed)).toMatchObject({ status: 'needPin' })
    expect(runtime.created).not.toHaveBeenCalled()
    expect(runtime.cached).not.toHaveBeenCalled()
    expect(await fetch(changed, { pin: 'new-pin' })).toMatchObject({ status: 'ok' })
    expect(runtime.first.mock.calls[0].slice(2, 6)).toEqual([changed.fintsUrl, changed.blz, changed.userId, 'new-pin'])
    expect(runtime.cached).not.toHaveBeenCalled()
  })

  test('normalizes equivalent URL spellings without weakening path, query or username binding', async () => {
    await fetch(account, { pin: 'test-pin', savePin: true })
    vi.clearAllMocks()
    expect(await fetch({ ...account, fintsUrl: 'https://BANK.EXAMPLE.TEST:443/fints' })).toMatchObject({ status: 'ok' })
    expect(runtime.cached).toHaveBeenCalledOnce()
  })

  test('never silently migrates a legacy PIN or legacy bank information without a provable login identity', async () => {
    mkdirSync(join(runtime.directory, 'bank'), { recursive: true })
    writeFileSync(pinsFile(), JSON.stringify({ [account.id]: Buffer.from('test-encrypted:legacy-pin').toString('base64') }))
    writeFileSync(infoFile(), JSON.stringify({ bankingInformation: { systemId: 'legacy', bankMessages: [], bpd: { url: account.fintsUrl, bankId: account.blz } } }))
    expect(invoke('bank:pin:has', account.id)).toBe(false)
    expect(await fetch()).toMatchObject({ status: 'needPin' })
    expect(runtime.decrypt).not.toHaveBeenCalled()
    expect(runtime.created).not.toHaveBeenCalled()
    expect(await fetch(account, { pin: 'explicit-new-pin', savePin: true })).toMatchObject({ status: 'ok' })
    expect(runtime.cached).not.toHaveBeenCalled()
    expect(invoke('bank:pin:has', account.id)).toBe(true)
  })

  test('does not trust a stale endpoint inside otherwise identity-matching bank information', async () => {
    await fetch(account, { pin: 'test-pin', savePin: true })
    const info = JSON.parse(readFileSync(infoFile(), 'utf8'))
    info.bankingInformation.bpd.url = 'https://other.example.test/fints'
    writeFileSync(infoFile(), JSON.stringify(info))
    vi.clearAllMocks()
    expect(await fetch()).toMatchObject({ status: 'ok' })
    expect(runtime.cached).not.toHaveBeenCalled()
    expect(runtime.first.mock.calls[0][2]).toBe(account.fintsUrl)
  })

  test('stops if bank parameters attempt to change the configured endpoint during synchronization', async () => {
    runtime.nextSyncUrl = 'https://other.example.test/fints'
    expect(await fetch(account, { pin: 'test-pin' })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('Die Bank meldet den FinTS-Server „other.example.test“. Eingetragen ist „bank.example.test“.'),
    })
    expect(existsSync(infoFile())).toBe(false)
  })

  test('handles unavailable encryption without retaining a PIN and removes a saved PIN on request', async () => {
    runtime.encryptionAvailable = false
    expect(await fetch(account, { pin: 'test-pin', savePin: true })).toMatchObject({ status: 'ok', pinSaveFailed: true })
    expect(existsSync(pinsFile())).toBe(false)
    expect(invoke('bank:pin:has', account.id)).toBe(false)
    runtime.encryptionAvailable = true
    await fetch(account, { pin: 'test-pin', savePin: true })
    invoke('bank:pin:delete', account.id)
    expect(invoke('bank:pin:has', account.id)).toBe(false)
  })

  test('replaces a saved PIN only after a successful bank response', async () => {
    await fetch(account, { pin: 'previous-pin', savePin: true })
    const previous = readFileSync(pinsFile(), 'utf8')
    runtime.statements.mockResolvedValueOnce({ success: false, requiresTan: false, bankAnswers: [{ code: 9942, text: 'PIN falsch' }] })
    expect(await fetch(account, { pin: 'rejected-pin', savePin: true })).toMatchObject({ status: 'error' })
    expect(readFileSync(pinsFile(), 'utf8')).toBe(previous)
    expect(await fetch(account, { pin: 'new-pin', savePin: true })).toMatchObject({ status: 'ok' })
    await fetch()
    expect(runtime.cached.mock.lastCall?.[4]).toBe('new-pin')
  })

  test('removal during a pending TAN prevents the completed fetch from resaving the PIN', async () => {
    runtime.statements.mockResolvedValueOnce({ success: false, requiresTan: true, tanReference: 'test-tan' })
    const result = await fetch(account, { pin: 'new-pin', savePin: true })
    expect(result).toMatchObject({ status: 'tan' })
    expect(invoke('bank:pin:status', account.id)).toBe('missing')
    invoke('bank:pin:delete', account.id)
    const { sessionId } = result as { status: string; sessionId: string }
    expect(await invoke('bank:continue', sessionId)).toMatchObject({ status: 'ok' })
    expect(await fetch()).toMatchObject({ status: 'needPin' })
  })

  test('does not save the PIN after cancellation while a TAN response is in flight', async () => {
    runtime.statements.mockResolvedValueOnce({ success: false, requiresTan: true, tanReference: 'test-tan' })
    const result = await fetch(account, { pin: 'new-pin', savePin: true }) as { status: string; sessionId: string }
    let finish!: (response: unknown) => void
    runtime.statements.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = invoke('bank:continue', result.sessionId)
    invoke('bank:cancel', result.sessionId)
    finish({ success: true, requiresTan: false, statements: [] })
    expect(await pending).toMatchObject({ status: 'error' })
    expect(invoke('bank:pin:status', account.id)).toBe('missing')
  })

  test('closes a failed TAN session so it cannot later save a PIN', async () => {
    runtime.statements.mockResolvedValueOnce({ success: false, requiresTan: true, tanReference: 'test-tan' })
    const result = await fetch(account, { pin: 'new-pin', savePin: true }) as { status: string; sessionId: string }
    runtime.statements.mockRejectedValueOnce(new Error('Testverbindung abgebrochen'))
    expect(await invoke('bank:continue', result.sessionId)).toMatchObject({ status: 'error' })
    expect(await invoke('bank:continue', result.sessionId)).toMatchObject({ status: 'error' })
    expect(invoke('bank:pin:status', account.id)).toBe('missing')
  })

  test('reports an unusable local entry and allows removing it without clearing bank metadata', async () => {
    await fetch(account, { pin: 'test-pin', savePin: true })
    expect(invoke('bank:pin:status', account.id)).toBe('saved')
    const previousInfo = readFileSync(infoFile(), 'utf8')
    runtime.encryptionAvailable = false
    expect(invoke('bank:pin:status', account.id)).toBe('unusable')
    expect(invoke('bank:pin:has', account.id)).toBe(false)
    invoke('bank:pin:delete', account.id)
    expect(invoke('bank:pin:status', account.id)).toBe('missing')
    expect(readFileSync(infoFile(), 'utf8')).toBe(previousInfo)
  })
})
