import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyYearFile } from '@shared/defaults'
import type { Api } from '../api'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
let api: Api, storage: MemoryStorage
const prefix = 'vereinszentrale-lokal:'
beforeAll(async () => { vi.stubGlobal('window', {}); api = (await import('../api')).api })
beforeEach(() => { storage = new MemoryStorage(); vi.stubGlobal('localStorage', storage) })
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('window', {}) })

describe('browser persistence API', () => {
  test.each(['{broken', JSON.stringify({ organization: {} })])('keeps damaged shared settings untouched: %s', async (damaged) => {
    storage.setItem(`${prefix}einstellungen`, damaged)
    await expect(api.loadSettings()).rejects.toThrow(/Einstellungen/)
    await expect(api.saveSettings({ theme: 'hell' })).rejects.toThrow(/Einstellungen/)
    await expect(api.commitSnapshot({ settings: { theme: 'hell' }, years: [{ konto: 'haupt', year: 2026, data: emptyYearFile(2026) }] })).rejects.toThrow(/Einstellungen/)
    expect(storage.getItem(`${prefix}einstellungen`)).toBe(damaged)
    expect(storage.getItem(`${prefix}jahr:2026`)).toBeNull()
  })
  test('validates single-file settings and saves a valid snapshot in the isolated namespace', async () => {
    await expect(api.saveSettings({ theme: 'invalid' })).rejects.toThrow()
    await api.saveSettings({ theme: 'hell' })
    expect(await api.loadSettings()).toEqual({ theme: 'hell' })
    const year = emptyYearFile(2026)
    await api.saveYear('haupt', 2026, year)
    expect(await api.loadYear('haupt', 2026)).toEqual(year)
    expect(storage.getItem(`${prefix}pending-snapshot`)).toBeNull()
    expect(storage.getItem('kassenwart:einstellungen')).toBeNull()
  })
})
