const { app, ipcMain } = require('electron')
const { existsSync, realpathSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, isAbsolute, join, relative, resolve } = require('node:path')
globalThis.__readinessFs = require('node:fs')

const supplied = process.env.BUCHFUEHRUNG_TEST_ROOT
if (!supplied || !basename(supplied).startsWith('buchfuehrung-e2e-') || !existsSync(supplied)) {
  throw new Error('Produktionsmodus-Tests benötigen einen eigenen bestehenden temporären Datenordner.')
}
const root = realpathSync(supplied)
const suffix = relative(realpathSync(tmpdir()), root)
if (!suffix || suffix.startsWith('..') || isAbsolute(suffix)) throw new Error('Testdaten müssen unter dem temporären Systemordner liegen.')

// Vor dem Laden des Produktionscodes festlegen: niemals echte Benutzerdaten öffnen.
app.setPath('appData', root)
process.env.BUCHFUEHRUNG_TEST_ROOT = root
delete process.env.ELECTRON_RENDERER_URL
// Auch Main-Prozess-Bibliotheken dürfen in diesem Testprofil keine echten
// Banken, Update-Server oder andere HTTP-Dienste kontaktieren.
for (const protocol of ['node:http', 'node:https']) {
  const client = require(protocol)
  client.request = client.get = () => { throw new Error('Netzwerkzugriffe sind im isolierten Produktionsbuild-Test gesperrt.') }
}
globalThis.__productionNetworkRequests = []
globalThis.fetch = async (url) => {
  globalThis.__productionNetworkRequests.push(String(url))
  throw new Error('Netzwerkzugriffe sind im isolierten Produktionsbuild-Test gesperrt.')
}
const registerHandler = ipcMain.handle.bind(ipcMain)
globalThis.__productionBankCalls = []
globalThis.__productionYearLoads = []
globalThis.__productionHoldYearLoads = false
let pendingYearLoads = []
globalThis.__productionReleaseYearLoads = () => {
  globalThis.__productionHoldYearLoads = false
  const pending = pendingYearLoads
  pendingYearLoads = []
  for (const release of pending) release()
}
let holdBankFetch = process.env.BUCHFUEHRUNG_TEST_BANK_DELAY === '1'
let releaseBankFetch
globalThis.__productionReleaseBankFetch = () => {
  holdBankFetch = false
  releaseBankFetch?.()
}
ipcMain.handle = (channel, listener) => {
  if (channel === 'years:load') return registerHandler(channel, async (event, konto, year) => {
    globalThis.__productionYearLoads.push({ konto, year })
    const result = listener(event, konto, year)
    if (globalThis.__productionHoldYearLoads) await new Promise((release) => pendingYearLoads.push(release))
    return result
  })
  if (!channel.startsWith('bank:')) return registerHandler(channel, listener)
  return registerHandler(channel, async (_event, account) => {
    if (process.env.BUCHFUEHRUNG_TEST_BANK !== '1') throw new Error('Bankzugriffe sind in diesem Testprofil gesperrt.')
    if (channel === 'bank:pin:has') return account === 'startup-test'
    if (channel === 'bank:fetch' && account?.id === 'startup-test' && account?.konto === 'zweit') {
      globalThis.__productionBankCalls.push({ id: account.id, konto: account.konto })
      if (holdBankFetch) await new Promise((release) => { releaseBankFetch = release })
      return { status: 'ok', rows: [{ date: '2026-11-08', amount: 2450, name: 'Testmitglied', description: 'Automatischer Testumsatz' }] }
    }
    throw new Error('Nur der ausdrücklich angelegte Testbankabruf ist zulässig.')
  })
}
app.on('browser-window-created', (_, window) => window.hide())
app.on('web-contents-created', (_, contents) => {
  contents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }))
})

let entry = resolve(__dirname, '../../.production-out/main/index.js')
if (process.env.BUCHFUEHRUNG_TEST_ARCHIVE) {
  entry = realpathSync(process.env.BUCHFUEHRUNG_TEST_ARCHIVE)
  const archiveSuffix = relative(root, entry)
  if (archiveSuffix.startsWith('..') || isAbsolute(archiveSuffix) || basename(entry) !== 'app.asar') {
    throw new Error('Nur ein Testarchiv innerhalb des temporären Datenordners ist zulässig.')
  }
}
if (!existsSync(entry)) throw new Error('Produktionsbuild fehlt. Zuerst npm run build:production ausführen.')
require(entry)
