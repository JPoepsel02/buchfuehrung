import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDirPath, deleteYear, listYears, loadSettings, loadYear, saveSettings, saveYear } from './storage'
import { checkForUpdate, downloadAndInstall } from './updater'
import type { UpdateInfo } from './updater'

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

export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:install', (e, info: UpdateInfo) =>
    downloadAndInstall(BrowserWindow.fromWebContents(e.sender), info),
  )
  ipcMain.handle('years:list', () => listYears())
  ipcMain.handle('years:load', (_e, year: number) => loadYear(year))
  ipcMain.handle('years:save', (_e, year: number, data: unknown) => saveYear(year, data))
  ipcMain.handle('years:delete', (_e, year: number) => deleteYear(year))

  ipcMain.handle('settings:load', () => loadSettings())
  ipcMain.handle('settings:save', (_e, data: { logoDataUrl?: string | null }) => {
    saveSettings(data)
    applyLogo(data?.logoDataUrl)
  })

  ipcMain.handle('data:openFolder', () => shell.openPath(dataDirPath()))
  ipcMain.handle('data:openCloudFolder', () => {
    const settings = loadSettings() as { cloudBackupDir?: string | null }
    if (!settings.cloudBackupDir) return
    return shell.openPath(settings.cloudBackupDir)
  })
  ipcMain.handle('data:selectCloudFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Cloud-Ordner für Datensicherung auswählen',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  /** Textdatei speichern (z. B. Sicherungs-Export) – Vorschlag: Downloads-Ordner. */
  ipcMain.handle('file:saveText', async (e, suggestedName: string, content: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false }
    const target = await dialog.showSaveDialog(win, {
      title: 'Sicherung speichern',
      defaultPath: join(app.getPath('downloads'), suggestedName),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (target.canceled || !target.filePath) return { ok: false }
    writeFileSync(target.filePath, content, 'utf-8')
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
    async (e, html: string, suggestedName: string, options?: { landscape?: boolean }) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return { ok: false }
      const target = await dialog.showSaveDialog(win, {
        title: 'Als PDF speichern',
        defaultPath: join(app.getPath('documents'), suggestedName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (target.canceled || !target.filePath) return { ok: false }

      const tmpFile = join(tmpdir(), `buchfuehrung-bericht-${Date.now()}.html`)
      writeFileSync(tmpFile, html, 'utf-8')
      const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        await printWin.loadFile(tmpFile)
        const landscape = options?.landscape === true
        const pdf = await printWin.webContents.printToPDF({
          pageSize: 'A4',
          landscape,
          printBackground: true,
          // Folien sind randlos gestaltet, der Bericht behält Druckränder
          margins: landscape
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
