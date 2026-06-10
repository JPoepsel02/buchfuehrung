import { contextBridge, ipcRenderer } from 'electron'

/** Schmale, typisierte Brücke zwischen Renderer und Main-Prozess. */
const api = {
  listYears: (): Promise<number[]> => ipcRenderer.invoke('years:list'),
  loadYear: (year: number): Promise<unknown | null> => ipcRenderer.invoke('years:load', year),
  saveYear: (year: number, data: unknown): Promise<void> => ipcRenderer.invoke('years:save', year, data),
  deleteYear: (year: number): Promise<void> => ipcRenderer.invoke('years:delete', year),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('data:openFolder'),
  openCsv: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('csv:open'),
  exportPdf: (html: string, suggestedName: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('pdf:export', html, suggestedName),
}

export type KassenwartApi = typeof api

contextBridge.exposeInMainWorld('kassenwart', api)
