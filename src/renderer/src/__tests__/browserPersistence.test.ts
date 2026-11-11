import { describe, expect, test } from 'vitest'
import { commitBrowserSnapshot, recoverBrowserSnapshot } from '../browserPersistence'

class MemoryStorage {
  data = new Map<string, string>()
  fail = ''
  getItem(key: string) { return this.data.get(key) ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) {
    if (key === this.fail) throw new Error('Storage unavailable')
    this.data.set(key, value)
  }
}

describe('browser snapshot persistence', () => {
  test('rolls back a partial write and recovers after reopening storage', () => {
    const storage = new MemoryStorage()
    storage.setItem('local:settings', 'old settings'); storage.setItem('local:year', 'old draft')
    storage.fail = 'local:year'
    expect(() => commitBrowserSnapshot(storage, 'local:', [['local:settings', 'new settings'], ['local:year', 'new bookings']])).toThrow()
    storage.fail = ''
    recoverBrowserSnapshot(storage, 'local:')
    expect(storage.getItem('local:settings')).toBe('old settings')
    expect(storage.getItem('local:year')).toBe('old draft')
    commitBrowserSnapshot(storage, 'local:', [['local:settings', 'new settings'], ['local:year', 'new bookings']])
    expect(storage.getItem('local:settings')).toBe('new settings')
    expect(storage.getItem('local:year')).toBe('new bookings')
  })
  test('refuses a malformed journal instead of silently discarding it or editing another namespace', () => {
    const storage = new MemoryStorage()
    storage.setItem('local:pending-snapshot', JSON.stringify({ phase: 'pending', entries: [['production:settings', 'bad']] }))
    expect(() => recoverBrowserSnapshot(storage, 'local:')).toThrow('Speicherstand')
    expect(storage.getItem('local:pending-snapshot')).not.toBeNull()
  })
  test('rejects duplicate snapshot targets before writing a journal', () => {
    const storage = new MemoryStorage()
    expect(() => commitBrowserSnapshot(storage, 'local:', [['local:year', 'one'], ['local:year', 'two']])).toThrow('Ungültiger Speicherstand')
    expect(storage.getItem('local:pending-snapshot')).toBeNull()
    expect(storage.getItem('local:year')).toBeNull()
  })
})
