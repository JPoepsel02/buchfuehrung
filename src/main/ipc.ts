import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDirPath, deleteYear, listYears, loadYear, saveYear } from './storage'

export function registerIpc(): void {
  ipcMain.handle('years:list', () => listYears())
  ipcMain.handle('years:load', (_e, year: number) => loadYear(year))
  ipcMain.handle('years:save', (_e, year: number, data: unknown) => saveYear(year, data))
  ipcMain.handle('years:delete', (_e, year: number) => deleteYear(year))

  ipcMain.handle('data:openFolder', () => shell.openPath(dataDirPath()))

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

  /** Fertiges Bericht-HTML als PDF exportieren (Druckvorlage für die Kassenprüfung). */
  ipcMain.handle('pdf:export', async (e, html: string, suggestedName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false }
    const target = await dialog.showSaveDialog(win, {
      title: 'Prüfbericht als PDF speichern',
      defaultPath: join(app.getPath('documents'), suggestedName),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (target.canceled || !target.filePath) return { ok: false }

    const tmpFile = join(tmpdir(), `kassenwart-bericht-${Date.now()}.html`)
    writeFileSync(tmpFile, html, 'utf-8')
    const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await printWin.loadFile(tmpFile)
      const pdf = await printWin.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.5, bottom: 0.5, left: 0.4, right: 0.4 },
      })
      writeFileSync(target.filePath, pdf)
      shell.showItemInFolder(target.filePath)
      return { ok: true, path: target.filePath }
    } finally {
      printWin.destroy()
    }
  })
}

/** Sparkassen-Exporte sind häufig ISO-8859-1; sonst UTF-8. */
function decode(buffer: Buffer): string {
  const utf8 = buffer.toString('utf-8')
  if (!utf8.includes('�')) return utf8
  return buffer.toString('latin1')
}
