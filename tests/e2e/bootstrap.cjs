const { app } = require('electron')
const { basename, resolve } = require('node:path')

const root = process.env.BUCHFUEHRUNG_TEST_ROOT
if (!root || !basename(root).startsWith('buchfuehrung-e2e-')) {
  throw new Error('E2E-Tests benötigen einen eigenen temporären Datenordner.')
}
// main/index.ts leitet userData aus appData ab. Niemals die echten Bücher laden.
app.setPath('appData', resolve(root))
app.on('browser-window-created', (_, window) => window.hide())
require('../../out/main/index.js')
