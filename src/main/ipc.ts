import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerBankIpc } from './bank'
import { cloudSyncStatus, commitSnapshot, dataDirPath, deleteYear, listKontos, listYears, loadSettings, loadYear, saveSettings, saveYear, syncCloudNow } from './storage'
import { allowedMirrorPath, experimentExportDirectory, isLocalExperiment, mirrorRoot } from './experiment'
import type { AppSettings } from '../shared/types'
import { validateSettings, validateSnapshot } from '../shared/snapshot'
import type { SnapshotPayload } from '../shared/snapshot'
import { checkForUpdate, downloadAndInstall } from './updater'

/** Setzt das hochgeladene Vereinslogo als Dock-/Fenster-Symbol. */
export function applyLogo(logoDataUrl?: string | null): void {
  if (!logoDataUrl) return
  try {
    const img = nativeImage.createFromDataURL(logoDataUrl)
    if (img.isEmpty()) return
    if (process.platform === 'darwin') app.dock?.setIcon(img)
    else for (const win of BrowserWindow.getAllWindows()) win.setIcon(img)
  } catch {
    // Ein defektes Logo darf die App nie beeinträchtigen
  }
}

export function currentLogo(): string | null {
  const settings = loadSettings() as { logoDataUrl?: string | null }
  return settings?.logoDataUrl ?? null
}

function assertSettings(data: unknown): asserts data is AppSettings {
  const errors = validateSettings(data)
  if (errors.length) throw new Error(errors[0])
  const settings = data as AppSettings
  if (settings.cloudBackupEnabled && (!settings.cloudBackupDir || !allowedMirrorPath(settings.cloudBackupDir))) {
    throw new Error(isLocalExperiment ? `Für lokale Sicherungen einen Ordner unter ${mirrorRoot} wählen.` : 'Der Sicherungsordner darf nicht im Daten- oder Programmordner liegen.')
  }
}

export function registerIpc(): void {
  registerBankIpc()
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:check', () => isLocalExperiment
    ? { current: app.getVersion(), latest: app.getVersion(), hasUpdate: false, notes: 'Lokale Entwicklungsversion.' } : checkForUpdate())
  ipcMain.handle('update:install', async (event, info) => {
    if (isLocalExperiment) return { ok: false, error: 'Updates sind in der lokalen Entwicklungsversion deaktiviert.' }
    try {
      const verified = await checkForUpdate()
      if (!verified.hasUpdate || !info || info.latest !== verified.latest) return { ok: false, error: 'Bitte erneut nach Updates suchen.' }
      return await downloadAndInstall(BrowserWindow.fromWebContents(event.sender), verified)
    } catch (failure) {
      return { ok: false, error: failure instanceof Error ? failure.message : 'Updateprüfung fehlgeschlagen.' }
    }
  })
  ipcMain.handle('kontos:list', () => listKontos())
  ipcMain.handle('years:list', (_e, konto: string) => listYears(konto ?? 'haupt'))
  ipcMain.handle('years:load', (_e, konto: string, year: number) => loadYear(konto ?? 'haupt', year))
  ipcMain.handle('years:save', (_e, konto: string, year: number, data: unknown) =>
    saveYear(konto ?? 'haupt', year, data),
  )
  ipcMain.handle('years:delete', (_e, konto: string, year: number) => deleteYear(konto ?? 'haupt', year))

  ipcMain.handle('settings:load', () => loadSettings())
  ipcMain.handle('settings:save', (_e, data: AppSettings) => {
    assertSettings(data)
    saveSettings(data)
    applyLogo(data?.logoDataUrl)
  })
  ipcMain.handle('data:commit', (_event, payload: SnapshotPayload) => {
    const errors = validateSnapshot(payload)
    if (errors.length) throw new Error(errors[0])
    if (payload.settings !== undefined) assertSettings(payload.settings)
    commitSnapshot(payload)
    if (payload.settings !== undefined) applyLogo(payload.settings.logoDataUrl)
  })

  ipcMain.handle('data:openFolder', () => shell.openPath(dataDirPath()))
  ipcMain.handle('data:openCloudFolder', () => {
    const settings = loadSettings() as { cloudBackupDir?: string | null }
    if (!settings.cloudBackupDir || !allowedMirrorPath(settings.cloudBackupDir)) return
    return shell.openPath(settings.cloudBackupDir)
  })
  ipcMain.handle('data:cloudStatus', () => cloudSyncStatus())
  ipcMain.handle('data:syncCloudNow', () => syncCloudNow())
  ipcMain.handle('data:selectCloudFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Cloud-Ordner für Datensicherung auswählen',
      defaultPath: mirrorRoot,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    if (!allowedMirrorPath(result.filePaths[0])) throw new Error(isLocalExperiment ? `Für lokale Sicherungen einen Ordner unter ${mirrorRoot} wählen.` : 'Der Sicherungsordner darf nicht im Daten- oder Programmordner liegen.')
    return result.filePaths[0]
  })

  /** Textdatei speichern (z. B. Sicherung oder Buchungs-CSV) – Vorschlag: Downloads-Ordner. */
  ipcMain.handle('file:saveText', async (e, suggestedName: string, content: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false }
    const isCsv = suggestedName.toLowerCase().endsWith('.csv')
    const target = await dialog.showSaveDialog(win, {
      title: 'Datei speichern',
      defaultPath: join(experimentExportDirectory(), suggestedName.replace(/[\\/]/g, '_')),
      filters: [isCsv ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }],
    })
    if (target.canceled || !target.filePath) return { ok: false }
    writeFileSync(target.filePath, content, 'utf-8')
    shell.showItemInFolder(target.filePath)
    return { ok: true, path: target.filePath }
  })

  ipcMain.handle('file:savePptx', async (e, suggestedName: unknown, content: unknown) => {
    if (typeof suggestedName !== 'string' || suggestedName.length > 200 || !/\.pptx$/i.test(suggestedName)
      || /[\x00-\x1f]/.test(suggestedName) || !(content instanceof Uint8Array)
      || content.byteLength < 4 || content.byteLength > 32_000_000
      || content[0] !== 0x50 || content[1] !== 0x4b || content[2] !== 0x03 || content[3] !== 0x04) {
      throw new Error('Die PowerPoint-Datei konnte nicht gespeichert werden: ungültige Exportdaten.')
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false }
    const target = await dialog.showSaveDialog(win, {
      title: 'PowerPoint speichern',
      defaultPath: join(experimentExportDirectory(), suggestedName.replace(/[\\/]/g, '_')),
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
    })
    if (target.canceled || !target.filePath) return { ok: false }
    writeFileSync(target.filePath, content)
    shell.showItemInFolder(target.filePath)
    return { ok: true, path: target.filePath }
  })

  /** Textdatei öffnen (z. B. Sicherungs-Import). */
  ipcMain.handle('file:openText', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Sicherung auswählen',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return {
      name: result.filePaths[0].split(/[\\/]/).pop() ?? 'sicherung.json',
      content: readFileSync(result.filePaths[0], 'utf-8'),
    }
  })

  /** CSV-Kontoauszug wählen und einlesen (Encoding-Erkennung UTF-8/Latin-1). */
  ipcMain.handle('csv:open', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Kontoauszug (CSV) auswählen',
      filters: [{ name: 'CSV-Dateien', extensions: ['csv', 'txt'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const buffer = readFileSync(result.filePaths[0])
    return { name: result.filePaths[0].split(/[\\/]/).pop() ?? 'kontoauszug.csv', content: decode(buffer) }
  })

  /** Fertiges Bericht-HTML als PDF exportieren (Hochformat-Bericht oder Querformat-Folien). */
  ipcMain.handle(
    'pdf:export',
    async (e, html: string, suggestedName: string, options?: { landscape?: boolean; slideFormat?: '16:9' }) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return { ok: false }
      const target = await dialog.showSaveDialog(win, {
        title: 'Als PDF speichern',
        defaultPath: join(experimentExportDirectory(), suggestedName.replace(/[\\/]/g, '_')),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (target.canceled || !target.filePath) return { ok: false }

      const tmpFile = join(tmpdir(), `buchfuehrung-bericht-${Date.now()}.html`)
      writeFileSync(tmpFile, html, 'utf-8')
      const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        await printWin.loadFile(tmpFile)
        const landscape = options?.landscape === true
        const slides = options?.slideFormat === '16:9'
        const pdf = await printWin.webContents.printToPDF({
          pageSize: slides ? { width: 13.333333, height: 7.5 } : 'A4',
          landscape: slides ? false : landscape,
          preferCSSPageSize: slides,
          printBackground: true,
          // Folien sind randlos gestaltet, der Bericht behält Druckränder
          margins: landscape || slides
            ? { top: 0, bottom: 0, left: 0, right: 0 }
            : { top: 0.5, bottom: 0.5, left: 0.4, right: 0.4 },
        })
        writeFileSync(target.filePath, pdf)
        shell.showItemInFolder(target.filePath)
        return { ok: true, path: target.filePath }
      } finally {
        printWin.destroy()
      }
    },
  )
}

/** Sparkassen-Exporte sind häufig ISO-8859-1; sonst UTF-8. */
function decode(buffer: Buffer): string {
  const utf8 = buffer.toString('utf-8')
  if (!utf8.includes('�')) return utf8
  return buffer.toString('latin1')
}
