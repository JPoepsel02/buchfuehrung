import type { SnapshotPayload } from '@shared/snapshot'
import type { BankPinStatus } from '@shared/bank'
import { validateSettings, validateSnapshot } from '@shared/snapshot'
import { isLocalExperiment } from '@shared/runtime'
import { commitBrowserSnapshot, recoverBrowserSnapshot } from './browserPersistence'

/**
 * Zugriff auf den Main-Prozess. Läuft die App im Browser (Vorschau/Tests),
 * springt ein localStorage-Fallback ein, damit alle Ansichten bedienbar sind.
 */

export interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
  assetName?: string
  assetUrl?: string
  notes?: string
}

export interface CloudSyncStatus {
  enabled: boolean
  lastSuccessAt?: string
  lastError?: string
  fileCount?: number
}

export interface Api {
  onAppCommand(cb: (command: 'search' | 'sidebar' | 'settings' | 'reports') => void): () => void
  listKontos(): Promise<string[]>
  listYears(konto: string): Promise<number[]>
  loadYear(konto: string, year: number): Promise<unknown | null>
  saveYear(konto: string, year: number, data: unknown): Promise<void>
  deleteYear(konto: string, year: number): Promise<void>
  loadSettings(): Promise<unknown>
  saveSettings(data: unknown): Promise<void>
  commitSnapshot(payload: SnapshotPayload): Promise<void>
  openDataFolder(): Promise<void>
  openCloudFolder(): Promise<void>
  selectCloudFolder(): Promise<string | null>
  cloudSyncStatus(): Promise<CloudSyncStatus>
  syncCloudNow(): Promise<CloudSyncStatus>
  openCsv(): Promise<{ name: string; content: string } | null>
  saveTextFile(suggestedName: string, content: string): Promise<{ ok: boolean; path?: string }>
  savePptx(suggestedName: string, content: Uint8Array): Promise<{ ok: boolean; path?: string }>
  openTextFile(): Promise<{ name: string; content: string } | null>
  exportPdf(
    html: string,
    suggestedName: string,
    options?: { landscape?: boolean; slideFormat?: '16:9' },
  ): Promise<{ ok: boolean; path?: string }>
  getVersion(): Promise<string>
  checkForUpdate(): Promise<UpdateInfo>
  installUpdate(info: UpdateInfo): Promise<{ ok: boolean; error?: string }>
  onUpdateProgress(cb: (p: { received: number; total: number }) => void): () => void
  bankFetch(account: unknown, opts: unknown): Promise<unknown>
  bankContinue(sessionId: string, tan?: string): Promise<unknown>
  bankCancel(sessionId: string): Promise<void>
  bankPinExists(accountId: string): Promise<boolean>
  bankPinStatus(accountId: string): Promise<BankPinStatus>
  bankPinDelete(accountId: string): Promise<void>
  bankForget(accountId: string): Promise<void>
}

declare global {
  interface Window {
    kassenwart?: Api
  }
}

/** Schlüssel je Buch: haupt "vereinszentrale-lokal:jahr:", zweit "vereinszentrale-lokal:k2:", weitere "vereinszentrale-lokal:k3:" … */
const storagePrefix = isLocalExperiment ? 'vereinszentrale-lokal:' : 'kassenwart:'
const keyFor = (konto: string) => {
  if (konto === 'haupt' || !konto) return `${storagePrefix}jahr:`
  return `${storagePrefix}${konto === 'zweit' ? 'k2' : konto}:`
}
const browserStorage = () => { recoverBrowserSnapshot(localStorage, storagePrefix); return localStorage }
const browserSettings = (): unknown => {
  try {
    const raw = browserStorage().getItem(`${storagePrefix}einstellungen`)
    const data: unknown = raw === null ? {} : JSON.parse(raw)
    if (validateSettings(data).length) throw new Error('Invalid settings')
    return data
  } catch { throw new Error('Die Einstellungen konnten nicht gelesen werden und wurden nicht überschrieben. Bitte eine Sicherung wiederherstellen.') }
}

const webFallback: Api = {
  onAppCommand() { return () => {} },
  async listKontos() {
    const found = new Set<string>(['haupt'])
    for (const key of Object.keys(browserStorage())) {
      const m = /^(k\d+):\d{4}$/.exec(key.startsWith(storagePrefix) ? key.slice(storagePrefix.length) : '')
      if (m) found.add(m[1] === 'k2' ? 'zweit' : m[1])
    }
    const num = (k: string) => (k === 'zweit' ? 2 : Number(k.slice(1)))
    return ['haupt', ...[...found].filter((k) => k !== 'haupt').sort((a, b) => num(a) - num(b))]
  },
  async listYears(konto) {
    const prefix = keyFor(konto)
    return Object.keys(browserStorage())
      .filter((k) => k.startsWith(prefix))
      .filter((k) => /^\d{4}$/.test(k.slice(prefix.length)))
      .map((k) => Number(k.slice(prefix.length)))
      .sort((a, b) => b - a)
  },
  async loadYear(konto, year) {
    const raw = browserStorage().getItem(keyFor(konto) + year)
    return raw ? JSON.parse(raw) : null
  },
  async saveYear(konto, year, data) {
    const errors = validateSnapshot({ years: [{ konto, year, data }] })
    if (errors.length) throw new Error(errors[0])
    browserSettings()
    commitBrowserSnapshot(localStorage, storagePrefix, [[keyFor(konto) + year, JSON.stringify(data)]])
  },
  async deleteYear(konto, year) {
    browserSettings()
    browserStorage().removeItem(keyFor(konto) + year)
  },
  async loadSettings() {
    return browserSettings()
  },
  async saveSettings(data) {
    const errors = validateSettings(data)
    if (errors.length) throw new Error(errors[0])
    browserSettings()
    commitBrowserSnapshot(localStorage, storagePrefix, [[`${storagePrefix}einstellungen`, JSON.stringify(data)]])
  },
  async commitSnapshot(payload) {
    const errors = validateSnapshot(payload)
    if (errors.length) throw new Error(errors[0])
    browserSettings()
    const entries: Array<[string, string]> = [
      ...(payload.settings === undefined ? [] : [[`${storagePrefix}einstellungen`, JSON.stringify(payload.settings)] as [string, string]]),
      ...payload.years.map((entry): [string, string] => [keyFor(entry.konto) + entry.year, JSON.stringify(entry.data)]),
    ]
    commitBrowserSnapshot(localStorage, storagePrefix, entries)
  },
  async openDataFolder() {
    alert('Im Browser-Modus werden die Daten im localStorage gespeichert.')
  },
  async openCloudFolder() {
    alert('Ordner öffnen ist nur in der installierten App verfügbar.')
  },
  async selectCloudFolder() {
    alert('Cloud-Sicherung ist nur in der installierten App verfügbar.')
    return null
  },
  async cloudSyncStatus() {
    return { enabled: false }
  },
  async syncCloudNow() {
    return { enabled: false }
  },
  openCsv() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.csv,.txt'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, content: String(reader.result ?? '') })
        reader.readAsText(file)
      }
      input.oncancel = () => resolve(null)
      input.click()
    })
  },
  async saveTextFile(suggestedName, content) {
    const type = suggestedName.toLowerCase().endsWith('.csv') ? 'text/csv;charset=utf-8' : 'application/json'
    const url = URL.createObjectURL(new Blob([content], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    a.click()
    URL.revokeObjectURL(url)
    return { ok: true }
  },
  async savePptx(suggestedName, content) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(content)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
    const link = document.createElement('a')
    link.href = url
    link.download = suggestedName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return { ok: true }
  },
  openTextFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, content: String(reader.result ?? '') })
        reader.readAsText(file)
      }
      input.oncancel = () => resolve(null)
      input.click()
    })
  },
  async exportPdf(html) {
    const win = window.open('', '_blank')
    if (!win) return { ok: false }
    win.document.write(html)
    win.document.close()
    win.print()
    return { ok: true }
  },
  async getVersion() {
    return 'Browser-Vorschau'
  },
  async checkForUpdate() {
    return { current: 'Browser-Vorschau', latest: '', hasUpdate: false }
  },
  async installUpdate() {
    return { ok: false, error: 'Updates nur in der installierten App.' }
  },
  onUpdateProgress() {
    return () => {}
  },
  async bankFetch() {
    return { status: 'error', message: 'Der Bank-Abruf ist nur in der installierten App verfügbar.' }
  },
  async bankContinue() {
    return { status: 'error', message: 'Der Bank-Abruf ist nur in der installierten App verfügbar.' }
  },
  async bankCancel() {},
  async bankPinExists() {
    return false
  },
  async bankPinStatus() {
    return 'missing'
  },
  async bankPinDelete() {},
  async bankForget() {},
}

export const api: Api = window.kassenwart ?? webFallback

export const isElectron = Boolean(window.kassenwart)
