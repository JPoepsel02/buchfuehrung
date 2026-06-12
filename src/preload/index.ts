import { contextBridge, ipcRenderer } from 'electron'

interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
  assetName?: string
  assetUrl?: string
  notes?: string
}

/** Schmale, typisierte Brücke zwischen Renderer und Main-Prozess. */
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:check'),
  installUpdate: (info: UpdateInfo): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('update:install', info),
  onUpdateProgress: (cb: (p: { received: number; total: number }) => void): (() => void) => {
    const listener = (_e: unknown, p: { received: number; total: number }) => cb(p)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  listYears: (): Promise<number[]> => ipcRenderer.invoke('years:list'),
  loadYear: (year: number): Promise<unknown | null> => ipcRenderer.invoke('years:load', year),
  saveYear: (year: number, data: unknown): Promise<void> => ipcRenderer.invoke('years:save', year, data),
  deleteYear: (year: number): Promise<void> => ipcRenderer.invoke('years:delete', year),
  loadSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:load'),
  saveSettings: (data: unknown): Promise<void> => ipcRenderer.invoke('settings:save', data),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('data:openFolder'),
  openCloudFolder: (): Promise<void> => ipcRenderer.invoke('data:openCloudFolder'),
  selectCloudFolder: (): Promise<string | null> => ipcRenderer.invoke('data:selectCloudFolder'),
  openCsv: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('csv:open'),
  saveTextFile: (suggestedName: string, content: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:saveText', suggestedName, content),
  openTextFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('file:openText'),
  exportPdf: (
    html: string,
    suggestedName: string,
    options?: { landscape?: boolean },
  ): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke('pdf:export', html, suggestedName, options),
}

export type KassenwartApi = typeof api

contextBridge.exposeInMainWorld('kassenwart', api)
