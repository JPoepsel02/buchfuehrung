type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Entry = [key: string, value: string | null]

export function recoverBrowserSnapshot(storage: BrowserStorage, prefix: string): void {
  const key = `${prefix}pending-snapshot`
  const raw = storage.getItem(key)
  if (raw === null) return
  let journal: { phase: string; entries: Entry[] }
  try {
    journal = JSON.parse(raw)
    if (!journal || !['pending', 'committed'].includes(journal.phase) || !Array.isArray(journal.entries)
      || journal.entries.length > 1000 || new Set(journal.entries.map((entry) => Array.isArray(entry) ? entry[0] : null)).size !== journal.entries.length
      || journal.entries.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
        || !entry[0].startsWith(prefix) || entry[0] === key || (entry[1] !== null && typeof entry[1] !== 'string'))) throw new Error('Invalid journal')
  } catch { throw new Error('Ein unterbrochener Speicherstand konnte nicht gelesen werden.') }
  if (journal.phase === 'pending') {
    for (const [name] of journal.entries) storage.removeItem(name)
    for (const [name, value] of journal.entries) if (value !== null) storage.setItem(name, value)
  }
  storage.removeItem(key)
}

export function commitBrowserSnapshot(storage: BrowserStorage, prefix: string, entries: Array<[string, string]>): void {
  recoverBrowserSnapshot(storage, prefix)
  if (entries.length > 1000 || new Set(entries.map(([key]) => key)).size !== entries.length
    || entries.some(([key]) => !key.startsWith(prefix) || key === `${prefix}pending-snapshot`)) throw new Error('Ungültiger Speicherstand.')
  const before: Entry[] = entries.map(([key]) => [key, storage.getItem(key)])
  const key = `${prefix}pending-snapshot`
  storage.setItem(key, JSON.stringify({ phase: 'pending', entries: before }))
  try {
    for (const [name, value] of entries) storage.setItem(name, value)
    storage.setItem(key, JSON.stringify({ phase: 'committed', entries: [] }))
    storage.removeItem(key)
  } catch (failure) {
    try { recoverBrowserSnapshot(storage, prefix) }
    catch { throw new Error('Speichern fehlgeschlagen. Der vorige Stand wird beim nächsten Öffnen wiederhergestellt.') }
    throw failure
  }
}
