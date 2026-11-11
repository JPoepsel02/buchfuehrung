import { contextBridge, ipcRenderer } from 'electron'
import type { SnapshotPayload } from '../shared/snapshot'

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
  onAppCommand: (cb: (command: 'search' | 'sidebar' | 'settings' | 'reports') => void): (() => void) => {
    const search = () => cb('search')
    const sidebar = () => cb('sidebar')
    const settings = () => cb('settings')
    const reports = () => cb('reports')
    ipcRenderer.on('view:search', search)
    ipcRenderer.on('view:sidebar', sidebar)
    ipcRenderer.on('view:settings', settings)
    ipcRenderer.on('view:reports', reports)
    return () => {
      ipcRenderer.removeListener('view:search', search)
      ipcRenderer.removeListener('view:sidebar', sidebar)
      ipcRenderer.removeListener('view:settings', settings)
      ipcRenderer.removeListener('view:reports', reports)
    }
  },
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:check'),
  installUpdate: (info: UpdateInfo): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('update:install', info),
  onUpdateProgress: (cb: (p: { received: number; total: number }) => void): (() => void) => {
    const listener = (_e: unknown, p: { received: number; total: number }) => cb(p)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  listKontos: (): Promise<string[]> => ipcRenderer.invoke('kontos:list'),
  listYears: (konto: string): Promise<number[]> => ipcRenderer.invoke('years:list', konto),
  loadYear: (konto: string, year: number): Promise<unknown | null> => ipcRenderer.invoke('years:load', konto, year),
  saveYear: (konto: string, year: number, data: unknown): Promise<void> =>
    ipcRenderer.invoke('years:save', konto, year, data),
  deleteYear: (konto: string, year: number): Promise<void> => ipcRenderer.invoke('years:delete', konto, year),
  loadSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:load'),
  saveSettings: (data: unknown): Promise<void> => ipcRenderer.invoke('settings:save', data),
  commitSnapshot: (payload: SnapshotPayload): Promise<void> => ipcRenderer.invoke('data:commit', payload),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('data:openFolder'),
  openCloudFolder: (): Promise<void> => ipcRenderer.invoke('data:openCloudFolder'),
  selectCloudFolder: (): Promise<string | null> => ipcRenderer.invoke('data:selectCloudFolder'),
  cloudSyncStatus: (): Promise<{ enabled: boolean; lastSuccessAt?: string; lastError?: string; fileCount?: number }> =>
    ipcRenderer.invoke('data:cloudStatus'),
  syncCloudNow: (): Promise<{ enabled: boolean; lastSuccessAt?: string; lastError?: string; fileCount?: number }> =>
    ipcRenderer.invoke('data:syncCloudNow'),
  openCsv: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('csv:open'),
  saveTextFile: (suggestedName: string, content: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:saveText', suggestedName, content),
  savePptx: (suggestedName: string, content: Uint8Array): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:savePptx', suggestedName, content),
  openTextFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('file:openText'),
  exportPdf: (
    html: string,
    suggestedName: string,
    options?: { landscape?: boolean; slideFormat?: '16:9' },
  ): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke('pdf:export', html, suggestedName, options),
  bankFetch: (account: unknown, opts: unknown): Promise<unknown> => ipcRenderer.invoke('bank:fetch', account, opts),
  bankContinue: (sessionId: string, tan?: string): Promise<unknown> =>
    ipcRenderer.invoke('bank:continue', sessionId, tan),
  bankCancel: (sessionId: string): Promise<void> => ipcRenderer.invoke('bank:cancel', sessionId),
  bankPinExists: (accountId: string): Promise<boolean> => ipcRenderer.invoke('bank:pin:has', accountId),
  bankPinDelete: (accountId: string): Promise<void> => ipcRenderer.invoke('bank:pin:delete', accountId),
  bankForget: (accountId: string): Promise<void> => ipcRenderer.invoke('bank:forget', accountId),
}

export type KassenwartApi = typeof api

contextBridge.exposeInMainWorld('kassenwart', api)
