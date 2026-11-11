import { describe, expect, test } from 'vitest'
import { PersistenceQueue } from '../writeQueue'

describe('PersistenceQueue', () => {
  test('blocks queued and later writes after a failure until a complete recovery succeeds', async () => {
    const errors: string[] = [], writes: string[] = []
    const queue = new PersistenceQueue((error) => errors.push(error.message))
    const first = queue.enqueue(async () => { throw new Error('Disk unavailable') })
    const later = queue.enqueue(async () => { writes.push('year') })
    await expect(first).rejects.toThrow('Disk unavailable')
    await expect(later).rejects.toThrow('Disk unavailable')
    await expect(queue.retry(async () => { throw new Error('Still unavailable') })).rejects.toThrow('Still unavailable')
    await expect(queue.flush()).rejects.toThrow('Still unavailable')
    expect(writes).toEqual([])
    await queue.retry(async () => { writes.push('complete snapshot') })
    await queue.enqueue(async () => { writes.push('next edit') })
    await expect(queue.flush()).resolves.toBeUndefined()
    expect(writes).toEqual(['complete snapshot', 'next edit'])
    expect(errors).toContain('Disk unavailable')
  })

  test('serializes recovery and edits made while recovery is in flight', async () => {
    const queue = new PersistenceQueue(() => {})
    const writes: string[] = []
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const retry = queue.retry(async () => { await wait; writes.push('recovered') })
    const next = queue.enqueue(async () => { writes.push('edited') })
    expect(writes).toEqual([])
    release(); await retry; await next
    expect(writes).toEqual(['recovered', 'edited'])
  })

  test('normalizes unknown failures without silently enabling later writes', async () => {
    const queue = new PersistenceQueue(() => {})
    await expect(queue.enqueue(async () => { throw null })).rejects.toThrow('Speichern fehlgeschlagen')
    await expect(queue.flush()).rejects.toThrow('Speichern fehlgeschlagen')
  })

  test('applies deletion cache changes before a later bank update enters its write callback', async () => {
    const queue = new PersistenceQueue(() => {})
    let cachedYearExists = true, recreatedYear = false
    let release!: () => void
    const diskDelete = new Promise<void>((resolve) => { release = resolve })
    const deletion = (async () => {
      await queue.enqueue(async () => { await diskDelete })
      cachedYearExists = false
    })()
    const bankUpdate = queue.enqueue(async () => {
      if (cachedYearExists) recreatedYear = true
    })
    release()
    await Promise.all([deletion, bankUpdate])
    expect(recreatedYear).toBe(false)
  })
})
