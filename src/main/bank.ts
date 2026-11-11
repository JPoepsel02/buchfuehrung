import { app, ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FinTSClient, FinTSConfig } from 'lib-fints'
import type { BankingInformation, ClientResponse, StatementResponse } from 'lib-fints'
import { loadSettings } from './storage'
import { bankDescription } from '../shared/csv'
import type { BankAccountChoice, BankFetchOptions, BankFetchResult, BankFetchedRow, BankPinStatus } from '../shared/bank'
import type { AppSettings, BankAccountConfig } from '../shared/types'
import { assertBankAccountConfig, assertBankAccountId, assertBankFetchOptions, assertBankSessionId, assertBankTan, bankInfoFilename } from '../shared/bankValidation'
import { bankConnectionIdentity, sameBankEndpoint } from '../shared/bankIdentity'

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
  version: 1
  connection: string
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
  pinToSave?: { pin: string; token: symbol }
}

const sessions = new Map<string, BankSession>()
const pinSaveTokens = new Map<string, symbol>()
const expiredSession = { status: 'error', message: 'Die Abruf-Sitzung ist abgelaufen. Bitte erneut abrufen.' } as const

function bankDir(): string {
  const dir = join(app.getPath('userData'), 'bank')
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---------- PIN-Speicherung (verschlüsselt über den Schlüsselbund) ----------

function pinsFile(): string {
  return join(bankDir(), 'pins.json')
}

function loadPins(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(pinsFile(), 'utf-8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
  }
  throw new Error('Der lokale PIN-Speicher konnte nicht gelesen werden.')
}

function writePins(pins: Record<string, unknown>): void {
  const file = pinsFile()
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(pins), { encoding: 'utf-8', mode: 0o600 })
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
}

function saveFetchedPin({ account, pinToSave }: BankSession): boolean {
  if (!pinToSave || pinSaveTokens.get(account.id) !== pinToSave.token) return true
  pinSaveTokens.delete(account.id)
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    const payload = JSON.stringify({ version: 1, connection: bankConnectionIdentity(account), pin: pinToSave.pin })
    const encrypted = safeStorage.encryptString(payload).toString('base64')
    writePins({ ...loadPins(), [account.id]: { version: 1, encrypted } })
    return true
  } catch {
    return false
  }
}

function loadPin(account: BankAccountConfig, pins?: Record<string, unknown>): string | null {
  assertBankAccountId(account.id)
  try {
    const entry = (pins ?? loadPins())[account.id] as { version?: unknown; encrypted?: unknown } | undefined
    // Old PIN-only ciphertext has no provable login identity and requires re-entry.
    if (!entry || typeof entry !== 'object' || entry.version !== 1 || typeof entry.encrypted !== 'string'
      || !entry.encrypted || !safeStorage.isEncryptionAvailable()) return null
    const value = JSON.parse(safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64')))
    return value?.version === 1 && value.connection === bankConnectionIdentity(account)
      && typeof value.pin === 'string' && value.pin.length > 0 && value.pin.length <= 1024 ? value.pin : null
  } catch {
    return null
  }
}

function deletePin(accountId: string): void {
  assertBankAccountId(accountId)
  pinSaveTokens.delete(accountId)
  const pins = loadPins()
  if (Object.hasOwn(pins, accountId)) {
    writePins(Object.fromEntries(Object.entries(pins).filter(([id]) => id !== accountId)))
  }
}

function pinStatus(accountId: string): BankPinStatus {
  const pins = loadPins()
  if (!Object.hasOwn(pins, accountId)) return 'missing'
  const account = (loadSettings() as AppSettings).bankAccounts?.find((entry) => entry.id === accountId)
  return account && loadPin(account, pins) !== null ? 'saved' : 'unusable'
}

// ---------- Bank-Stammdaten (BPD/UPD/systemId) je Konto ----------

function infoFile(accountId: string): string {
  return join(bankDir(), bankInfoFilename(accountId))
}

function loadBankInfo(account: BankAccountConfig): StoredBankInfo | null {
  if (!existsSync(infoFile(account.id))) return null
  try {
    const parsed = JSON.parse(readFileSync(infoFile(account.id), 'utf-8')) as StoredBankInfo
    return parsed?.version === 1 && parsed.connection === bankConnectionIdentity(account)
      && sameBankEndpoint(account, parsed.bankingInformation?.bpd?.url, parsed.bankingInformation?.bpd?.bankId) ? parsed : null
  } catch {
    return null
  }
}

function persistBankInfo(account: BankAccountConfig, client: FinTSClient): void {
  assertClientConnection(account, client)
  const info: StoredBankInfo = {
    version: 1,
    connection: bankConnectionIdentity(account),
    bankingInformation: client.config.bankingInformation,
    tanMethodId: client.config.tanMethodId,
    tanMediaName: client.config.tanMediaName,
  }
  const tmp = `${infoFile(account.id)}.${randomUUID()}.tmp`
  writeFileSync(tmp, JSON.stringify(info), 'utf-8')
  renameSync(tmp, infoFile(account.id))
}

function forgetAccount(accountId: string): void {
  deletePin(accountId)
  rmSync(infoFile(accountId), { force: true })
  for (const [id, session] of sessions) if (session.account.id === accountId) sessions.delete(id)
}

function assertClientConnection(account: BankAccountConfig, client: FinTSClient): void {
  const { bankingUrl, bankId, userId } = client.config
  if (bankId !== account.blz) throw new Error('Die gemeldete Bankleitzahl weicht ab. Prüfe die Bankleitzahl und die FinTS-Zugangsadresse unter „Bearbeiten“.')
  if (userId !== account.userId) throw new Error('Der Anmeldename im Bankdialog weicht von der gespeicherten Bankverbindung ab.')
  if (sameBankEndpoint(account, bankingUrl, bankId)) return
  const configuredHost = new URL(account.fintsUrl).hostname
  const reportedHost = URL.canParse(bankingUrl) ? new URL(bankingUrl).hostname : ''
  const detail = reportedHost && reportedHost !== configuredHost
    ? `Die Bank meldet den FinTS-Server „${reportedHost}“. Eingetragen ist „${configuredHost}“.`
    : 'Die gemeldete FinTS-Zugangsadresse weicht von der eingetragenen Adresse ab.'
  throw new Error(`${detail} Prüfe die FinTS-Zugangsadresse deiner Bank unter „Bearbeiten“.`)
}

// ---------- FinTS-Abruf ----------

function productId(): string {
  const settings = loadSettings() as { fintsProductId?: string | null }
  const configured = typeof settings.fintsProductId === 'string' ? settings.fintsProductId.trim() : ''
  return configured || DEFAULT_PRODUCT_ID
}

/** FinTS begrenzt productVersion (HKVVB) auf 5 Zeichen – die App-Version passt oft nicht hinein. */
function productVersion(): string {
  return app.getVersion().slice(0, 5)
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
      description: bankDescription(
        t.purpose ?? t.additionalInformation ?? '',
        t.bookingText ?? '',
      ),
    })),
  )
}

/** Nach erfolgreicher Synchronisation: Kontoauswahl prüfen, dann Umsätze abrufen. */
async function fetchStatements(session: BankSession, sessionId?: string): Promise<BankFetchResult> {
  const { account, client } = session
  assertClientConnection(account, client)
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
    persistBankInfo(account, client)
    return { status: 'chooseAccount', accounts: choices }
  }
  session.phase = 'statements'
  const response = await client.getAccountStatements(account.accountNumber, session.from)
  if (sessionId && sessions.get(sessionId) !== session) return expiredSession
  return handleStatementsResponse(session, response)
}

function handleStatementsResponse(session: BankSession, response: StatementResponse): BankFetchResult {
  assertClientConnection(session.account, session.client)
  if (response.requiresTan) return tanResult(session, response, false)
  if (!response.success) return errorFromResponse(response, 'Der Umsatzabruf ist fehlgeschlagen.')
  persistBankInfo(session.account, session.client)
  const rows = mapStatements(response)
  return saveFetchedPin(session) ? { status: 'ok', rows } : { status: 'ok', rows, pinSaveFailed: true }
}

function closeSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session?.pinToSave && pinSaveTokens.get(session.account.id) === session.pinToSave.token) {
    pinSaveTokens.delete(session.account.id)
  }
  sessions.delete(sessionId)
}

async function startFetch(account: BankAccountConfig, opts: BankFetchOptions): Promise<BankFetchResult> {
  const enteredPin = opts.pin?.trim()
  const pin = enteredPin || loadPin(account)
  if (!pin) return { status: 'needPin' }
  const pinToSave = enteredPin && opts.savePin ? { pin: enteredPin, token: Symbol() } : undefined
  if (pinToSave) pinSaveTokens.set(account.id, pinToSave.token)

  const stored = loadBankInfo(account)
  const config = stored
    ? FinTSConfig.fromBankingInformation(
        productId(),
        productVersion(),
        stored.bankingInformation,
        account.userId,
        pin,
        stored.tanMethodId,
        stored.tanMediaName,
      )
    : FinTSConfig.forFirstTimeUse(productId(), productVersion(), account.fintsUrl, account.blz, account.userId, pin)
  const client = new FinTSClient(config)
  assertClientConnection(account, client)
  const session: BankSession = {
    account: { ...account },
    client,
    phase: 'sync',
    tanReference: '',
    challenge: '',
    decoupled: false,
    from: opts.from ? new Date(opts.from) : undefined,
    pinToSave,
  }

  if (!stored) {
    // Erstkontakt: Erst Bank-Parameter holen, dann mit TAN-Methode synchronisieren
    const first = await client.synchronize()
    assertClientConnection(account, client)
    if (!pickTanMethod(client)) {
      return errorFromResponse(first, 'Die Bank hat keine TAN-Verfahren gemeldet. Bitte Zugangsdaten prüfen.')
    }
    session.decoupled = client.config.selectedTanMethod?.isDecoupled ?? false
    const second = await client.synchronize()
    assertClientConnection(account, client)
    if (second.requiresTan) return tanResult(session, second, false)
    if (!second.success) return errorFromResponse(second, 'Die Anmeldung bei der Bank ist fehlgeschlagen.')
    persistBankInfo(account, client)
  } else {
    session.decoupled = client.config.selectedTanMethod?.isDecoupled ?? false
  }

  return fetchStatements(session)
}

async function continueFetch(sessionId: string, tan?: string): Promise<BankFetchResult> {
  const session = sessions.get(sessionId)
  if (!session) return expiredSession
  let needsTan = false
  try {
    const result = await resumeSession(sessionId, session, tan)
    needsTan = result.status === 'tan' || result.status === 'tanPending'
    return result
  } finally {
    if (!needsTan) closeSession(sessionId)
  }
}

async function resumeSession(sessionId: string, session: BankSession, tan?: string): Promise<BankFetchResult> {
  const { client } = session
  assertClientConnection(session.account, client)
  if (session.phase === 'sync') {
    const response = await client.synchronizeWithTan(session.tanReference, tan)
    if (sessions.get(sessionId) !== session) return expiredSession
    assertClientConnection(session.account, client)
    if (response.requiresTan) return tanResult(session, response, true)
    if (!response.success) return errorFromResponse(response, 'Die Anmeldung bei der Bank ist fehlgeschlagen.')
    persistBankInfo(session.account, client)
    return fetchStatements(session, sessionId)
  }
  const response = await client.getAccountStatementsWithTan(session.tanReference, tan)
  if (sessions.get(sessionId) !== session) return expiredSession
  assertClientConnection(session.account, client)
  if (response.requiresTan) return tanResult(session, response, true)
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
  ipcMain.handle('bank:fetch', (_e, account: unknown, opts: unknown) => guarded(async () => {
    assertBankAccountConfig(account)
    const options = opts ?? {}
    assertBankFetchOptions(options)
    return startFetch(account, options)
  }))
  ipcMain.handle('bank:continue', (_e, sessionId: unknown, tan?: unknown) => guarded(async () => {
    assertBankSessionId(sessionId)
    assertBankTan(tan)
    return continueFetch(sessionId, tan)
  }))
  ipcMain.handle('bank:cancel', (_e, sessionId: unknown) => {
    assertBankSessionId(sessionId)
    closeSession(sessionId)
  })
  ipcMain.handle('bank:pin:has', (_e, accountId: unknown) => {
    assertBankAccountId(accountId)
    return pinStatus(accountId) === 'saved'
  })
  ipcMain.handle('bank:pin:status', (_e, accountId: unknown) => {
    assertBankAccountId(accountId)
    return pinStatus(accountId)
  })
  ipcMain.handle('bank:pin:delete', (_e, accountId: unknown) => {
    assertBankAccountId(accountId)
    deletePin(accountId)
  })
  ipcMain.handle('bank:forget', (_e, accountId: unknown) => {
    assertBankAccountId(accountId)
    forgetAccount(accountId)
  })
}
