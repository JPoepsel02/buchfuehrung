import { app, ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FinTSClient, FinTSConfig } from 'lib-fints'
import type { BankingInformation, ClientResponse, StatementResponse } from 'lib-fints'
import { loadSettings } from './storage'
import type { BankAccountChoice, BankFetchOptions, BankFetchResult, BankFetchedRow } from '../shared/bank'
import type { BankAccountConfig } from '../shared/types'

/**
 * Online-Banking-Abruf über FinTS 3.0 (PIN/TAN) im Main-Prozess.
 *
 * Sicherheit:
 * - Die PIN wird ausschließlich über safeStorage (macOS-Schlüsselbund bzw.
 *   Windows DPAPI) verschlüsselt abgelegt – nie im Klartext.
 * - Bank-Stammdaten (BPD/UPD, systemId) landen in einem eigenen Ordner
 *   außerhalb des Daten-Ordners und werden nicht in die Cloud gespiegelt.
 *
 * Ablauf: startFetch() synchronisiert bei Bedarf (TAN-Methode bevorzugt
 * "decoupled", z. B. VR SecureGo plus), verlangt einmalig die Kontoauswahl
 * und ruft dann die Umsätze ab. Muss der Nutzer freigeben, bleibt der
 * FinTS-Dialog als Session offen; continueFetch() setzt ihn fort.
 */

/** Unregistrierte Standard-Produktkennung; in den Einstellungen überschreibbar. */
const DEFAULT_PRODUCT_ID = 'Buchfuehrung'

interface StoredBankInfo {
  bankingInformation: BankingInformation
  tanMethodId?: number
  tanMediaName?: string
}

interface BankSession {
  account: BankAccountConfig
  client: FinTSClient
  phase: 'sync' | 'statements'
  tanReference: string
  challenge: string
  decoupled: boolean
  from?: Date
}

const sessions = new Map<string, BankSession>()

function bankDir(): string {
  const dir = join(app.getPath('userData'), 'bank')
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---------- PIN-Speicherung (verschlüsselt über den Schlüsselbund) ----------

function pinsFile(): string {
  return join(bankDir(), 'pins.json')
}

function loadPins(): Record<string, string> {
  if (!existsSync(pinsFile())) return {}
  try {
    return JSON.parse(readFileSync(pinsFile(), 'utf-8'))
  } catch {
    return {}
  }
}

function writePins(pins: Record<string, string>): void {
  const tmp = pinsFile() + '.tmp'
  writeFileSync(tmp, JSON.stringify(pins), { encoding: 'utf-8', mode: 0o600 })
  renameSync(tmp, pinsFile())
}

function savePin(accountId: string, pin: string): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const pins = loadPins()
  pins[accountId] = safeStorage.encryptString(pin).toString('base64')
  writePins(pins)
}

function loadPin(accountId: string): string | null {
  const encrypted = loadPins()[accountId]
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
}

function deletePin(accountId: string): void {
  const pins = loadPins()
  if (accountId in pins) {
    delete pins[accountId]
    writePins(pins)
  }
}

// ---------- Bank-Stammdaten (BPD/UPD/systemId) je Konto ----------

function infoFile(accountId: string): string {
  return join(bankDir(), `fints-${accountId}.json`)
}

function loadBankInfo(accountId: string): StoredBankInfo | null {
  if (!existsSync(infoFile(accountId))) return null
  try {
    const parsed = JSON.parse(readFileSync(infoFile(accountId), 'utf-8')) as StoredBankInfo
    return parsed?.bankingInformation ? parsed : null
  } catch {
    return null
  }
}

function persistBankInfo(accountId: string, client: FinTSClient): void {
  const info: StoredBankInfo = {
    bankingInformation: client.config.bankingInformation,
    tanMethodId: client.config.tanMethodId,
    tanMediaName: client.config.tanMediaName,
  }
  const tmp = infoFile(accountId) + '.tmp'
  writeFileSync(tmp, JSON.stringify(info), 'utf-8')
  renameSync(tmp, infoFile(accountId))
}

function forgetAccount(accountId: string): void {
  deletePin(accountId)
  rmSync(infoFile(accountId), { force: true })
}

// ---------- FinTS-Abruf ----------

function productId(): string {
  const settings = loadSettings() as { fintsProductId?: string | null }
  const configured = typeof settings.fintsProductId === 'string' ? settings.fintsProductId.trim() : ''
  return configured || DEFAULT_PRODUCT_ID
}

function errorFromResponse(response: ClientResponse, fallback: string): BankFetchResult {
  const message = response.bankAnswers
    .filter((a) => a.code >= 9000)
    .map((a) => `${a.text} (${a.code})`)
    .join(' · ')
  return { status: 'error', message: message || fallback }
}

/** Bevorzugt eine decoupled-Methode (Freigabe per Banking-App, z. B. SecureGo plus). */
function pickTanMethod(client: FinTSClient): boolean {
  const methods = client.config.availableTanMethods
  if (methods.length === 0) return false
  const method = methods.find((m) => m.isDecoupled) ?? methods.find((m) => /securego|push/i.test(m.name)) ?? methods[0]
  client.selectTanMethod(method.id)
  if (method.activeTanMedia.length > 0) {
    client.selectTanMedia(method.activeTanMedia[0])
  }
  return true
}

function tanResult(session: BankSession, response: ClientResponse, pending: boolean): BankFetchResult {
  session.tanReference = response.tanReference ?? session.tanReference
  session.challenge = response.tanChallenge?.trim() || session.challenge || 'Bitte die Freigabe in der Banking-App bestätigen.'
  const sessionId = findSessionId(session) ?? registerSession(session)
  return {
    status: pending ? 'tanPending' : 'tan',
    sessionId,
    challenge: session.challenge,
    decoupled: session.decoupled,
  }
}

function registerSession(session: BankSession): string {
  const id = randomUUID()
  sessions.set(id, session)
  return id
}

function findSessionId(session: BankSession): string | null {
  for (const [id, s] of sessions) if (s === session) return id
  return null
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function mapStatements(response: StatementResponse): BankFetchedRow[] {
  return response.statements.flatMap((statement) =>
    statement.transactions.map((t) => ({
      date: isoDate(t.valueDate),
      // Beträge kommen als Euro-Gleitkommazahl, vorzeichenbehaftet (Soll negativ)
      amount: Math.round(t.amount * 100),
      name: (t.remoteName ?? '').trim(),
      description: [t.bookingText, t.purpose ?? t.additionalInformation]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' · '),
    })),
  )
}

/** Nach erfolgreicher Synchronisation: Kontoauswahl prüfen, dann Umsätze abrufen. */
async function fetchStatements(session: BankSession): Promise<BankFetchResult> {
  const { account, client } = session
  if (!account.accountNumber) {
    const accounts = client.config.bankingInformation.upd?.bankAccounts ?? []
    const choices: BankAccountChoice[] = accounts
      .filter((a) => client.canGetAccountStatements(a.accountNumber))
      .map((a) => ({ accountNumber: a.accountNumber, iban: a.iban, product: a.product, holder: a.holder1 }))
    if (choices.length === 0) {
      return {
        status: 'error',
        message: 'Die Bank hat keine Konten mit Umsatzabruf gemeldet. Bitte Zugangsdaten prüfen.',
      }
    }
    persistBankInfo(account.id, client)
    return { status: 'chooseAccount', accounts: choices }
  }
  session.phase = 'statements'
  const response = await client.getAccountStatements(account.accountNumber, session.from)
  return handleStatementsResponse(session, response)
}

function handleStatementsResponse(session: BankSession, response: StatementResponse): BankFetchResult {
  if (response.requiresTan) return tanResult(session, response, false)
  if (!response.success) return errorFromResponse(response, 'Der Umsatzabruf ist fehlgeschlagen.')
  persistBankInfo(session.account.id, session.client)
  cleanupSession(session)
  return { status: 'ok', rows: mapStatements(response) }
}

function cleanupSession(session: BankSession): void {
  const id = findSessionId(session)
  if (id) sessions.delete(id)
}

async function startFetch(account: BankAccountConfig, opts: BankFetchOptions): Promise<BankFetchResult> {
  const pin = opts.pin?.trim() || loadPin(account.id)
  if (!pin) return { status: 'needPin' }
  if (opts.pin?.trim() && opts.savePin) savePin(account.id, opts.pin.trim())

  const stored = loadBankInfo(account.id)
  const config = stored
    ? FinTSConfig.fromBankingInformation(
        productId(),
        app.getVersion(),
        stored.bankingInformation,
        account.userId,
        pin,
        stored.tanMethodId,
        stored.tanMediaName,
      )
    : FinTSConfig.forFirstTimeUse(productId(), app.getVersion(), account.fintsUrl, account.blz, account.userId, pin)
  const client = new FinTSClient(config)
  const session: BankSession = {
    account,
    client,
    phase: 'sync',
    tanReference: '',
    challenge: '',
    decoupled: false,
    from: opts.from ? new Date(opts.from) : undefined,
  }

  if (!stored) {
    // Erstkontakt: Erst Bank-Parameter holen, dann mit TAN-Methode synchronisieren
    const first = await client.synchronize()
    if (!pickTanMethod(client)) {
      return errorFromResponse(first, 'Die Bank hat keine TAN-Verfahren gemeldet. Bitte Zugangsdaten prüfen.')
    }
    session.decoupled = client.config.selectedTanMethod?.isDecoupled ?? false
    const second = await client.synchronize()
    if (second.requiresTan) return tanResult(session, second, false)
    if (!second.success) return errorFromResponse(second, 'Die Anmeldung bei der Bank ist fehlgeschlagen.')
    persistBankInfo(account.id, client)
  } else {
    session.decoupled = client.config.selectedTanMethod?.isDecoupled ?? false
  }

  return fetchStatements(session)
}

async function continueFetch(sessionId: string, tan?: string): Promise<BankFetchResult> {
  const session = sessions.get(sessionId)
  if (!session) return { status: 'error', message: 'Die Abruf-Sitzung ist abgelaufen. Bitte erneut abrufen.' }
  const { client } = session
  if (session.phase === 'sync') {
    const response = await client.synchronizeWithTan(session.tanReference, tan)
    if (response.requiresTan) return tanResult(session, response, true)
    if (!response.success) {
      cleanupSession(session)
      return errorFromResponse(response, 'Die Anmeldung bei der Bank ist fehlgeschlagen.')
    }
    persistBankInfo(session.account.id, client)
    return fetchStatements(session)
  }
  const response = await client.getAccountStatementsWithTan(session.tanReference, tan)
  if (response.requiresTan) return tanResult(session, response, true)
  if (!response.success) {
    cleanupSession(session)
    return errorFromResponse(response, 'Der Umsatzabruf ist fehlgeschlagen.')
  }
  return handleStatementsResponse(session, response)
}

/** Netz-/Protokollfehler in eine verständliche Meldung übersetzen. */
async function guarded(run: () => Promise<BankFetchResult>): Promise<BankFetchResult> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'error', message: `Verbindung zur Bank fehlgeschlagen: ${message}` }
  }
}

export function registerBankIpc(): void {
  ipcMain.handle('bank:fetch', (_e, account: BankAccountConfig, opts: BankFetchOptions) =>
    guarded(() => startFetch(account, opts ?? {})),
  )
  ipcMain.handle('bank:continue', (_e, sessionId: string, tan?: string) => guarded(() => continueFetch(sessionId, tan)))
  ipcMain.handle('bank:cancel', (_e, sessionId: string) => {
    sessions.delete(sessionId)
  })
  ipcMain.handle('bank:pin:has', (_e, accountId: string) => loadPin(accountId) !== null)
  ipcMain.handle('bank:pin:delete', (_e, accountId: string) => deletePin(accountId))
  ipcMain.handle('bank:forget', (_e, accountId: string) => forgetAccount(accountId))
}
