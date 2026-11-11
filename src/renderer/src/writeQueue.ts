export class PersistenceQueue {
  private tail: Promise<void> = Promise.resolve()
  private failure: Error | null = null

  constructor(private readonly onFailure: (error: Error) => void) {}

  enqueue(write: () => Promise<void>): Promise<void> { return this.schedule(write, false) }
  retry(write: () => Promise<void>): Promise<void> { return this.schedule(write, true) }

  async flush(): Promise<void> {
    await this.tail
    if (this.failure) throw this.failure
  }

  private schedule(write: () => Promise<void>, recovery: boolean): Promise<void> {
    const pending = this.tail.then(async () => {
      if (this.failure && !recovery) throw this.failure
      try { await write() }
      catch (failure) { throw failure instanceof Error ? failure : new Error('Speichern fehlgeschlagen.') }
      if (recovery) this.failure = null
    })
    this.tail = pending.catch((error: Error) => { this.failure = error; this.onFailure(error) })
    return pending
  }
}
