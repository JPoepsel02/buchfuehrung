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

export interface Api {
  listYears(): Promise<number[]>
  loadYear(year: number): Promise<unknown | null>
  saveYear(year: number, data: unknown): Promise<void>
  deleteYear(year: number): Promise<void>
  loadSettings(): Promise<unknown>
  saveSettings(data: unknown): Promise<void>
  openDataFolder(): Promise<void>
  openCloudFolder(): Promise<void>
  selectCloudFolder(): Promise<string | null>
  openCsv(): Promise<{ name: string; content: string } | null>
  saveTextFile(suggestedName: string, content: string): Promise<{ ok: boolean; path?: string }>
  openTextFile(): Promise<{ name: string; content: string } | null>
  exportPdf(
    html: string,
    suggestedName: string,
    options?: { landscape?: boolean },
  ): Promise<{ ok: boolean; path?: string }>
  getVersion(): Promise<string>
  checkForUpdate(): Promise<UpdateInfo>
  installUpdate(info: UpdateInfo): Promise<{ ok: boolean; error?: string }>
  onUpdateProgress(cb: (p: { received: number; total: number }) => void): () => void
}

declare global {
  interface Window {
    kassenwart?: Api
  }
}

const PREFIX = 'kassenwart:jahr:'

const webFallback: Api = {
  async listYears() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => Number(k.slice(PREFIX.length)))
      .sort((a, b) => b - a)
  },
  async loadYear(year) {
    const raw = localStorage.getItem(PREFIX + year)
    return raw ? JSON.parse(raw) : null
  },
  async saveYear(year, data) {
    localStorage.setItem(PREFIX + year, JSON.stringify(data))
  },
  async deleteYear(year) {
    localStorage.removeItem(PREFIX + year)
  },
  async loadSettings() {
    const raw = localStorage.getItem('kassenwart:einstellungen')
    return raw ? JSON.parse(raw) : {}
  },
  async saveSettings(data) {
    localStorage.setItem('kassenwart:einstellungen', JSON.stringify(data))
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
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    a.click()
    URL.revokeObjectURL(url)
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
}

export const api: Api = window.kassenwart ?? webFallback

export const isElectron = Boolean(window.kassenwart)
