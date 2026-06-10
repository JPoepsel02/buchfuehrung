/**
 * Zugriff auf den Main-Prozess. Läuft die App im Browser (Vorschau/Tests),
 * springt ein localStorage-Fallback ein, damit alle Ansichten bedienbar sind.
 */

export interface Api {
  listYears(): Promise<number[]>
  loadYear(year: number): Promise<unknown | null>
  saveYear(year: number, data: unknown): Promise<void>
  openDataFolder(): Promise<void>
  openCsv(): Promise<{ name: string; content: string } | null>
  exportPdf(html: string, suggestedName: string): Promise<{ ok: boolean; path?: string }>
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
  async openDataFolder() {
    alert('Im Browser-Modus werden die Daten im localStorage gespeichert.')
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
  async exportPdf(html) {
    const win = window.open('', '_blank')
    if (!win) return { ok: false }
    win.document.write(html)
    win.document.close()
    win.print()
    return { ok: true }
  },
}

export const api: Api = window.kassenwart ?? webFallback

export const isElectron = Boolean(window.kassenwart)
