import { BrowserWindow, Menu, app, shell } from 'electron'
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
    backgroundColor: '#f5f6f8',
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'Bearbeiten', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Ansicht', submenu: [
      { id: 'toggle-sidebar', label: 'Seitenleiste ein-/ausblenden', accelerator: 'CmdOrCtrl+Shift+L', click: () => BrowserWindow.getFocusedWindow()?.webContents.send('view:sidebar') },
      { id: 'search-bookings', label: 'Buchungen suchen', accelerator: 'CmdOrCtrl+F', click: () => BrowserWindow.getFocusedWindow()?.webContents.send('view:search') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]))
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
