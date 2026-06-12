import { BrowserWindow, app, shell } from 'electron'
import { join } from 'node:path'
import { applyLogo, currentLogo, registerIpc } from './ipc'

// Datenordner explizit festnageln: bleibt „kassenwart“, egal wie die App
// nach außen heißt – sonst verlören Bestandsnutzer beim Umbenennen ihre Daten.
app.setPath('userData', join(app.getPath('appData'), 'kassenwart'))
app.setName('Buchführung')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Buchführung',
    backgroundColor: '#eef2ee',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  applyLogo(currentLogo())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
