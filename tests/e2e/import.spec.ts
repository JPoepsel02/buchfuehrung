import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { rowHash } from '../../src/shared/csv'
import type { AppSettings, Booking, ImportDraftRow, YearFile } from '../../src/shared/types'
import type { OrganizationConfig } from '../../src/shared/organization'

function draftRow(text: string, date: string, amount: number): ImportDraftRow {
  return {
    date, amount, bankText: text, hash: rowHash(date, amount, text), legacyHashes: [],
    name: 'Test GmbH', description: '', selected: true, categoryId: '',
    isUmsatz: false, receiptStatus: 'offen', receiptAvailable: false,
  }
}

function fixture(konto = 'haupt', refNo = 7): YearFile {
  const existing = draftRow('Bereits erfasst', '2026-01-01', -500)
  const booking: Booking = {
    id: 'bestehend', seq: 1, refNo, categoryId: 'm', date: existing.date,
    description: 'Bestehende Rechnung', name: 'Test GmbH', amount: 500, type: 'ausgabe',
    isUmsatz: false, nonUmsatzAmount: 0, note: existing.bankText, source: 'import',
    importHash: existing.hash, importHashVersion: 3, receiptStatus: 'vorhanden', receiptAvailable: true,
  }
  return {
    schemaVersion: 1, year: 2026, konto, clubName: 'Testverein', treasurerName: 'Test', openingBalance: 0,
    categories: [
      { id: 'm', name: 'Maskenball', code: 'M', active: true, sortOrder: 1 },
      { id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 2 },
    ],
    bookings: [booking],
    importDraft: { fileName: 'Testauszug.csv', skipped: 0, rows: [
      existing, draftRow('Erster neuer Umsatz', '2026-06-01', -1000),
      draftRow('Zweiter neuer Umsatz', '2026-06-02', -1200),
    ] },
  }
}

function setup(main = fixture(), bank = false, settingsPatch: Partial<AppSettings> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(main))
  writeFileSync(join(data, 'kassenbuch-k2-2026.json'), JSON.stringify(fixture('zweit', 30)))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell',
    ...(bank ? { bankAccounts: [{ id: 'testbank', konto: 'haupt', label: 'Testbank',
      blz: '12345678', userId: 'Test', accountNumber: '123', fintsUrl: 'https://example.invalid' }] } : {}),
    ...settingsPatch,
  }))
  return { root, data }
}

async function launch(root: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve('tests/e2e/bootstrap.cjs')],
    env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root },
  })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'kassenwart'))
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: 'Vereinsübersicht', exact: true })).toBeVisible()
    await page.getByLabel('Konto wählen', { exact: true }).selectOption('haupt')
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /Umsätze importieren/ }).click()
    await expect(page.getByRole('heading', { name: 'Umsätze importieren' })).toBeVisible()
    return { app, page }
  } catch (error) {
    await app.close()
    throw error
  }
}

const readYear = (data: string) => JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')) as YearFile
const rows = (page: Page) => page.locator('tbody > tr').filter({ has: page.getByLabel('Umsatz importieren', { exact: true }) })
const organizationForImport = (): OrganizationConfig => ({
  name: 'Testverein', treasurerName: 'Test', assignments: {}, transfers: [], rules: [
    { id: 'maskenball', konto: 'haupt', categoryId: 'm', area: 'W' },
    { id: 'beitraege', konto: 'haupt', categoryId: 'b', area: 'I' },
  ],
})
const readOrganization = (data: string) => (JSON.parse(readFileSync(join(data, 'einstellungen.json'), 'utf8')) as AppSettings & { organization: OrganizationConfig }).organization
const assignmentFor = (data: string, bookingId: string) => readOrganization(data).assignments[JSON.stringify(['haupt', 2026, bookingId])]

async function failWrites(app: ElectronApplication, target: string, remaining = 1) {
  await app.evaluate(async (_electron, fault) => {
    const fs = (globalThis as typeof globalThis & { __readinessFs: typeof import('node:fs') }).__readinessFs
    const original = fs.writeFileSync
    const state = { remaining: fault.remaining, failures: 0, yearWrites: 0 }
    const runtime = globalThis as typeof globalThis & {
      __readinessWriteFault?: typeof state
      __restoreReadinessWrites?: () => void
    }
    runtime.__readinessWriteFault = state
    runtime.__restoreReadinessWrites = () => { fs.writeFileSync = original }
    fs.writeFileSync = ((file: unknown, ...args: unknown[]) => {
      const name = String(file).split(/[\\/]/).pop() ?? ''
      if (/^kassenbuch-2026\.json\.[^.]+\.tmp$/.test(name)) state.yearWrites++
      if (name.startsWith(`${fault.target}.`) && name.endsWith('.tmp') && state.remaining > 0) {
        state.remaining--; state.failures++
        throw new Error('Simulierter Speicherfehler im Importtest')
      }
      return Reflect.apply(original, fs, [file, ...args])
    }) as typeof fs.writeFileSync
  }, { target, remaining })
}

async function faultState(app: ElectronApplication) {
  return app.evaluate(() => (globalThis as typeof globalThis & {
    __readinessWriteFault: { remaining: number; failures: number; yearWrites: number }
  }).__readinessWriteFault)
}

async function restoreWrites(app: ElectronApplication) {
  await app.evaluate(() => (globalThis as typeof globalThis & { __restoreReadinessWrites(): void }).__restoreReadinessWrites())
}

async function prepareAssignedImport(page: Page, data: string, description: string) {
  const first = rows(page).first()
  await first.getByLabel('Umsatz importieren', { exact: true }).check()
  await first.getByLabel('Eigener Verwendungszweck', { exact: true }).fill(description)
  await first.getByLabel('Kategorie', { exact: true }).selectOption('m')
  await first.getByLabel('Tätigkeitsbereich', { exact: true }).selectOption('Z')
  await expect.poll(() => readYear(data).importDraft?.rows[1].allocations).toEqual([{ area: 'Z', amount: 1000 }])
}

for (const target of ['einstellungen.json', 'kassenbuch-2026.json']) {
  test(`erhält bei einem Schreibfehler von ${target} den vollständigen Importentwurf nach Neustart`, async () => {
    const base = fixture()
    const { root, data } = setup(base, false, { organization: organizationForImport() })
    let { app, page } = await launch(root)
    try {
      await prepareAssignedImport(page, data, 'Ausfallsicher zugeordnet')
      const before = readYear(data)
      await failWrites(app, target)
      await page.getByRole('button', { name: '1 Buchungen übernehmen', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Simulierter Speicherfehler' }).first()).toBeVisible()
      expect(readYear(data)).toEqual(before)
      await app.close()
      ;({ app, page } = await launch(root))
      expect(readYear(data).bookings).toEqual(base.bookings)
      expect(readYear(data).importDraft?.rows[1]).toMatchObject({ description: 'Ausfallsicher zugeordnet', allocations: [{ area: 'Z', amount: 1000 }] })
      await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
      await page.getByRole('button', { name: '1 Buchungen übernehmen', exact: true }).click()
      await expect.poll(() => readYear(data).bookings.length).toBe(2)
      const imported = readYear(data).bookings.find((booking) => booking.description === 'Ausfallsicher zugeordnet')!
      await expect.poll(() => assignmentFor(data, imported.id)?.allocations).toEqual([{ area: 'Z', amount: 1000 }])
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
  })
}

test('behält nach wiederholtem Speicherfehler Entwurf und Zuordnung und blockiert folgende Jahresschreibvorgänge bis zum Retry', async () => {
  const { root, data } = setup(fixture(), false, { organization: organizationForImport() })
  let { app, page } = await launch(root)
  try {
    await prepareAssignedImport(page, data, 'Wiederholbar zugeordnet')
    const before = readYear(data)
    await failWrites(app, 'einstellungen.json', Number.MAX_SAFE_INTEGER)
    await page.getByRole('button', { name: '1 Buchungen übernehmen', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Simulierter Speicherfehler' }).first()).toBeVisible()
    expect(readYear(data)).toEqual(before)

    const writesBeforeEdit = (await faultState(app)).yearWrites
    await expect(rows(page)).toHaveCount(1)
    const remainingRow = rows(page).first()
    await expect(remainingRow).toBeVisible()
    const selectRemaining = remainingRow.getByLabel('Umsatz importieren', { exact: true })
    await expect(selectRemaining).toBeEnabled()
    await selectRemaining.check()
    const remainingDescription = remainingRow.getByLabel('Eigener Verwendungszweck', { exact: true })
    await expect(remainingDescription).toBeEnabled()
    await remainingDescription.fill('Nach Fehler weiterbearbeitet')
    await page.evaluate(() => window.kassenwart!.getVersion())
    expect((await faultState(app)).yearWrites).toBe(writesBeforeEdit)
    expect(readYear(data)).toEqual(before)

    const failures = (await faultState(app)).failures
    await page.getByRole('button', { name: 'Erneut speichern', exact: true }).click()
    await expect.poll(async () => (await faultState(app)).failures).toBeGreaterThan(failures)
    expect(readYear(data)).toEqual(before)
    expect(Object.keys(readOrganization(data).assignments)).toHaveLength(0)

    await restoreWrites(app)
    await page.getByRole('button', { name: 'Erneut speichern', exact: true }).click()
    await expect.poll(() => readYear(data).bookings.length).toBe(2)
    await expect(page.locator('.org-global-error')).toHaveCount(0)
    const imported = readYear(data).bookings.find((booking) => booking.description === 'Wiederholbar zugeordnet')!
    expect(assignmentFor(data, imported.id)?.allocations).toEqual([{ area: 'Z', amount: 1000 }])
    expect(readYear(data).importDraft?.rows.find((row) => row.bankText === 'Zweiter neuer Umsatz')?.description).toBe('Nach Fehler weiterbearbeitet')
    await app.close()
    ;({ app, page } = await launch(root))
    expect(readYear(data).bookings).toHaveLength(2)
    expect(assignmentFor(data, imported.id)?.allocations).toEqual([{ area: 'Z', amount: 1000 }])
    await expect(rows(page).first().getByLabel('Eigener Verwendungszweck', { exact: true })).toHaveValue('Nach Fehler weiterbearbeitet')
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

test('startet ohne Auswahl und übernimmt exakt die zuvor angezeigten Nummern', async ({}, testInfo) => {
  const { root, data } = setup()
  const originalBooking = fixture().bookings[0]
  const { app, page } = await launch(root)
  try {
    await expect(page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(rows(page)).toHaveCount(2)
    await expect(page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)

    const first = rows(page).nth(0)
    const second = rows(page).nth(1)
    await first.getByLabel('Umsatz importieren', { exact: true }).check()
    await first.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await first.getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8')
    await first.getByLabel('Eigener Verwendungszweck').fill('Erste Rechnung')

    await second.getByLabel('Umsatz importieren', { exact: true }).check()
    await second.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await second.getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(second.getByRole('status')).toHaveText('Beleg-Nr. M9')
    await second.getByLabel('Eigener Verwendungszweck').fill('Zweite Rechnung')
    await first.getByLabel('Umsatz importieren', { exact: true }).uncheck()
    await second.getByRole('status').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('feste-belegnummern.png'), fullPage: true })
    await page.getByRole('button', { name: '1 Buchungen übernehmen', exact: true }).click()

    await expect.poll(() => readYear(data).bookings.length).toBe(2)
    expect(readYear(data).bookings[0]).toEqual(originalBooking)
    expect(readYear(data).bookings[1].refNo).toBe(9)
    await expect(rows(page).first().getByRole('status')).toHaveText('Beleg-Nr. M8')

    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await page.getByRole('button', { name: /^Übersicht/ }).click()
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /Umsätze importieren/ }).click()
    await expect(page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)
    await expect(rows(page).first().getByRole('status')).toHaveText('Beleg-Nr. M8')
    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await page.getByRole('button', { name: '1 Buchungen übernehmen', exact: true }).click()
    await expect.poll(() => readYear(data).bookings.length).toBe(3)
    expect(readYear(data).bookings.map((b) => b.refNo)).toEqual([7, 9, 8])
    expect(readYear(data).bookings[0]).toEqual(originalBooking)

    await expect(page.getByRole('button', { name: /CSV-Kontoauszug/ })).toBeVisible()
    await page.getByLabel('Konto wählen', { exact: true }).selectOption('zweit')
    await expect(page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)
    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await rows(page).first().getByLabel('Kategorie', { exact: true }).selectOption('m')
    await rows(page).first().getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(rows(page).first().getByRole('status')).toHaveText('Beleg-Nr. M31')
    await expect.poll(() => JSON.parse(readFileSync(join(data, 'kassenbuch-k2-2026.json'), 'utf8')).refNoCounters.m).toBe(31)
  } finally {
    await app.close()
  }

  const restarted = await launch(root)
  try {
    await restarted.page.getByLabel('Konto wählen', { exact: true }).selectOption('zweit')
    await expect(restarted.page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(restarted.page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)
    await expect(rows(restarted.page).first().getByRole('status')).toHaveText('Beleg-Nr. M31')
  } finally {
    await restarted.app.close()
  }
})

test('zeigt bei Aufteilungen jede endgültige Belegnummer sofort an', async () => {
  const { root, data } = setup()
  const { app, page } = await launch(root)
  try {
    const first = rows(page).first()
    await first.getByLabel('Umsatz importieren', { exact: true }).check()
    await first.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await first.getByLabel('Eigener Verwendungszweck').fill('Geteilte Rechnung')
    await first.getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8')
    await first.getByRole('button', { name: 'Aufteilen', exact: true }).click()
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8 · M9')
    await page.getByLabel('Split-Verwendungszweck').nth(1).fill('Zweiter Teil')
    await page.getByLabel('Split-Kategorie').nth(1).selectOption('b')
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8 · B1')
    await page.getByRole('button', { name: '2 Buchungen übernehmen', exact: true }).click()
    await expect.poll(() => readYear(data).bookings.length).toBe(3)
    expect(readYear(data).bookings.map((b) => [b.categoryId, b.refNo])).toEqual([['m', 7], ['m', 8], ['b', 1]])
  } finally {
    await app.close()
  }
})

test('zählt in Übersicht, Seitenleiste und Importliste ausschließlich neue Umsätze', async () => {
  const main = fixture()
  const soft = draftRow('Manuell bereits erfasst', '2026-05-01', -700)
  main.bookings = [...main.bookings, { ...main.bookings[0], id: 'manuell', source: 'manuell',
    importHash: undefined, refNo: 6, date: soft.date, amount: 700 }]
  main.importDraft!.rows = [main.importDraft!.rows[0], soft, main.importDraft!.rows[1],
    { ...main.importDraft!.rows[1] }, main.importDraft!.rows[2]]
  const { root, data } = setup(main)
  const { app, page } = await launch(root)
  try {
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
    await expect(nav.getByRole('button', { name: /Umsätze importieren/ }).getByText('2', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Testauszug.csv · 2 neue Umsätze/ })).toBeVisible()
    await expect(rows(page)).toHaveCount(2)
    await expect(page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(page.getByText('Bereits erfasst', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Manuell bereits erfasst', { exact: true })).toHaveCount(0)
    await nav.getByRole('button', { name: /^Übersicht/ }).click()
    await expect(page.getByRole('button', { name: /Import weiterführen/ })).toContainText('2 Umsätze warten auf Zuweisung')
    await page.getByRole('button', { name: /Import weiterführen/ }).click()
    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await rows(page).first().getByLabel('Eigener Verwendungszweck').fill('Nur die neue Zeile')
    await expect.poll(() => readYear(data).importDraft!.rows[2].description).toBe('Nur die neue Zeile')
    expect(readYear(data).importDraft!.rows[0].description).toBe(main.importDraft!.rows[0].description)
    expect(readYear(data).bookings).toEqual(main.bookings)
  } finally {
    await app.close()
  }
})

test('zeigt nach Bankabrufen nur neue Umsätze und lässt einen erledigten Entwurf erneut abrufen', async () => {
  const main = fixture()
  main.importDraft!.rows = [main.importDraft!.rows[0]]
  const { root } = setup(main, true)
  const { app, page } = await launch(root)
  try {
    const fetched = (r: ImportDraftRow) => ({ date: r.date, amount: r.amount, name: r.name, description: r.bankText })
    const old = fetched(main.importDraft!.rows[0])
    const first = fetched(draftRow('Neuer Bankumsatz A', '2026-06-01', -1000))
    const second = fetched(draftRow('Neuer Bankumsatz B', '2026-06-02', -1200))
    await app.evaluate(({ ipcMain }, responses) => {
      let index = 0
      ipcMain.removeHandler('bank:fetch')
      ipcMain.handle('bank:fetch', () => ({ status: 'ok', rows: responses[Math.min(index++, responses.length - 1)] }))
    }, [[old], [old, first, { ...first }, second]])
    const dialogs: string[] = []
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss() })
    await expect(page.getByRole('button', { name: /CSV-Kontoauszug/ })).toBeVisible()
    await page.getByRole('button', { name: /^Online-Banking/ }).click()
    await page.getByRole('button', { name: 'Umsätze abrufen', exact: true }).click()
    await expect(page.getByText('Keine neuen Umsätze vorhanden.', { exact: true })).toBeVisible()
    expect(dialogs).toEqual([])
    await page.getByRole('button', { name: 'Umsätze abrufen', exact: true }).click()
    await expect(rows(page)).toHaveCount(2)
    await expect(page.getByRole('heading', { name: /2 neue Umsätze/ })).toBeVisible()
    await expect(page.getByText('2 neue Umsätze abgerufen – unten zuweisen und übernehmen.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(page.getByText('Bereits erfasst', { exact: true })).toHaveCount(0)
  } finally {
    await app.close()
  }
})


test('wählt Umsätze über freie Zeilenflächen und lässt Eingaben und feste Nummern unberührt', async () => {
  const { root, data } = setup()
  const { app, page } = await launch(root)
  try {
    const first = rows(page).first()
    const selected = first.getByLabel('Umsatz importieren', { exact: true })
    await expect(selected).not.toBeChecked()
    await first.locator('.bank-clamp').click()
    await expect(selected).toBeChecked()
    await first.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await expect(selected).toBeChecked()
    await first.getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(selected).toBeChecked()
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8')
    await first.getByLabel('Name', { exact: true }).click()
    await first.getByLabel('Name', { exact: true }).fill('Testperson')
    await first.getByLabel('Eigener Verwendungszweck').fill('Testrechnung')
    await expect(selected).toBeChecked()
    await first.getByLabel('Zählt als Umsatz', { exact: true }).check()
    await expect(selected).toBeChecked()
    await first.getByRole('button', { name: 'Aufteilen', exact: true }).click()
    await expect(selected).toBeChecked()
    const splitCheck = page.locator('.split-editor__check').first()
    await splitCheck.click()
    await expect(selected).toBeChecked()
    await page.getByRole('button', { name: 'Split entfernen', exact: true }).click()
    await expect(selected).toBeChecked()
    await first.getByRole('cell').nth(1).click()
    await expect(selected).not.toBeChecked()
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8')
    await selected.check()
    await expect(selected).toBeChecked()
    await selected.uncheck()
    await expect(selected).not.toBeChecked()
    await first.getByRole('cell').nth(5).click()
    await expect(selected).toBeChecked()
    // Rendering is immediate; the local file is deliberately saved after a short debounce.
    await expect.poll(() => readYear(data).importDraft!.rows[1].receiptRef).toEqual({ categoryId: 'm', refNo: 8 })
    expect(readYear(data).bookings).toEqual(fixture().bookings)
    expect(readYear(data).importDraft!.rows[0].selected).toBe(false)
  } finally { await app.close() }
})

test('behält im Einzelreview Vorbelegung, manuelle Bereiche, Zurück, Überspringen und Schließen bis zum abschließenden Import', async () => {
  test.setTimeout(90_000)
  const base = fixture()
  const main = { ...base, importDraft: { ...base.importDraft!, rows: [
    ...base.importDraft!.rows, draftRow('Dritter neuer Umsatz', '2026-06-03', 750),
  ] } }
  const { root, data } = setup(main, false, { organization: organizationForImport() })
  let { app, page } = await launch(root)
  const review = () => page.getByRole('dialog', { name: 'Umsätze einzeln zuordnen', exact: true })
  try {
    await page.getByRole('button', { name: 'Einzeln zuordnen', exact: true }).first().click()
    await expect(review()).toBeVisible()
    await expect(review().getByText('Umsatz 1 von 3', { exact: true })).toBeVisible()
    await expect(review().getByRole('button', { name: 'Zurück', exact: true })).toBeDisabled()
    await expect(review().getByRole('button', { name: 'Weiter', exact: true })).toBeDisabled()
    await expect(review()).toContainText('Erster neuer Umsatz')
    await expect(review()).not.toContainText('Bereits erfasst')
    await review().getByLabel('Name', { exact: true }).fill('Neue Person')
    await review().getByLabel('Eigener Verwendungszweck', { exact: true }).fill('Review Rechnung')
    await review().getByLabel('Kategorie', { exact: true }).selectOption('m')
    await expect(review().getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('W')
    await expect(review().getByLabel('Teilbetrag 1 in Euro', { exact: true })).toHaveValue('10,00')
    await review().getByLabel('Belegstatus', { exact: true }).selectOption('vorhanden')
    await expect(review().getByRole('status').filter({ hasText: 'Beleg-Nr.' })).toHaveText('Beleg-Nr. M8')
    await review().getByLabel('Tätigkeitsbereich 1', { exact: true }).selectOption('Z')
    await review().getByLabel('Kategorie', { exact: true }).selectOption('b')
    await expect(review().getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('Z')
    await expect(review().getByRole('status').filter({ hasText: 'Beleg-Nr.' })).toHaveText('Beleg-Nr. B1')
    await review().getByLabel('Zählt als Umsatz', { exact: true }).check()
    await review().getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(review().getByText('Umsatz 2 von 3', { exact: true })).toBeVisible()
    await expect.poll(() => readYear(data).importDraft!.rows[1].selected).toBe(true)
    await review().getByLabel('Eigener Verwendungszweck', { exact: true }).fill('Übersprungener Umsatz bleibt erhalten')
    await review().getByLabel('Kategorie', { exact: true }).selectOption('b')
    await review().getByLabel('Tätigkeitsbereich 1', { exact: true }).selectOption('V')
    await review().getByRole('button', { name: 'Überspringen', exact: true }).click()
    await expect(review().getByText('Umsatz 3 von 3', { exact: true })).toBeVisible()
    await expect.poll(() => readYear(data).importDraft!.rows[2].selected).toBe(false)
    await review().getByRole('button', { name: 'Zurück', exact: true }).click()
    await expect(review().getByLabel('Eigener Verwendungszweck', { exact: true })).toHaveValue('Übersprungener Umsatz bleibt erhalten')
    await expect(review().getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('V')
    await review().getByRole('button', { name: 'Zurück', exact: true }).click()
    await expect(review().getByLabel('Name', { exact: true })).toHaveValue('Neue Person')
    await expect(review().getByLabel('Eigener Verwendungszweck', { exact: true })).toHaveValue('Review Rechnung')
    await expect(review().getByLabel('Kategorie', { exact: true })).toHaveValue('b')
    await expect(review().getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('Z')
    await review().getByRole('button', { name: 'Schließen', exact: true }).click()
    await expect(review()).toHaveCount(0)
    await expect.poll(() => readYear(data).importDraft!.rows[1].allocations).toEqual([{ area: 'Z', amount: 1000 }])
    expect(readYear(data).bookings).toEqual(base.bookings)
    expect(readOrganization(data).assignments).toEqual({})

    await app.close()
    ;({ app, page } = await launch(root))
    await expect(page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)
    expect(readYear(data).bookings).toEqual(base.bookings)
    await page.getByRole('button', { name: 'Einzeln zuordnen', exact: true }).first().click()
    await expect(review().getByLabel('Name', { exact: true })).toHaveValue('Neue Person')
    await expect(review().getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('Z')
    await expect(review().getByRole('status').filter({ hasText: 'Beleg-Nr.' })).toHaveText('Beleg-Nr. B1')
    await review().getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(review().getByLabel('Eigener Verwendungszweck', { exact: true })).toHaveValue('Übersprungener Umsatz bleibt erhalten')
    await expect(review().getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('V')
    await review().getByRole('button', { name: 'Überspringen', exact: true }).click()
    await review().getByLabel('Name', { exact: true }).fill('Abschluss Person')
    await review().getByLabel('Eigener Verwendungszweck', { exact: true }).fill('Letzter Umsatz')
    await review().getByLabel('Kategorie', { exact: true }).selectOption('m')
    await expect(review().getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('W')
    await review().getByLabel('Tätigkeitsbereich 1', { exact: true }).selectOption('I')
    await review().getByLabel('Belegstatus', { exact: true }).selectOption('vorhanden')
    await expect(review().getByRole('status').filter({ hasText: 'Beleg-Nr.' })).toHaveText('Beleg-Nr. M9')
    await review().getByRole('button', { name: 'Zur Übersicht', exact: true }).click()
    await expect(review()).toHaveCount(0)
    expect(readYear(data).bookings).toEqual(base.bookings)
    await expect(page.getByRole('button', { name: '2 Buchungen übernehmen', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '2 Buchungen übernehmen', exact: true }).click()
    await expect.poll(() => readYear(data).bookings.length).toBe(3)
    const imported = readYear(data).bookings
    expect(imported[0]).toEqual(base.bookings[0])
    const first = imported.find((booking) => booking.description === 'Review Rechnung')!
    const last = imported.find((booking) => booking.description === 'Letzter Umsatz')!
    expect(first).toMatchObject({ name: 'Neue Person', categoryId: 'b', refNo: 1, amount: 1000, isUmsatz: true, type: 'ausgabe', source: 'import' })
    expect(last).toMatchObject({ name: 'Abschluss Person', categoryId: 'm', refNo: 9, amount: 750, type: 'einnahme', source: 'import' })
    await expect.poll(() => assignmentFor(data, first.id)?.allocations).toEqual([{ area: 'Z', amount: 1000 }])
    await expect.poll(() => assignmentFor(data, last.id)?.allocations).toEqual([{ area: 'I', amount: 750 }])
    expect(imported.some((booking) => booking.description === 'Übersprungener Umsatz bleibt erhalten')).toBe(false)
    expect(readYear(data).importDraft!.rows.find((row) => row.bankText === 'Zweiter neuer Umsatz')).toMatchObject({
      description: 'Übersprungener Umsatz bleibt erhalten', selected: false, allocations: [{ area: 'V', amount: 1200 }],
    })
    await app.close()
    ;({ app, page } = await launch(root))
    expect(readYear(data).bookings).toHaveLength(3)
    expect(assignmentFor(data, first.id).allocations).toEqual([{ area: 'Z', amount: 1000 }])
    expect(assignmentFor(data, last.id).allocations).toEqual([{ area: 'I', amount: 750 }])
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

test('übernimmt im Einzelreview finanzielle Splits mit eigenen Tätigkeitsaufteilungen und exakt reservierten Belegnummern', async () => {
  const base = fixture()
  const { root, data } = setup(base, false, { organization: organizationForImport() })
  const { app, page } = await launch(root)
  try {
    await rows(page).first().getByRole('button', { name: 'Einzeln zuordnen', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Umsätze einzeln zuordnen', exact: true })
    await dialog.getByLabel('Eigener Verwendungszweck', { exact: true }).fill('Aufgeteilte Rechnung')
    await dialog.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await dialog.getByLabel('Belegstatus', { exact: true }).selectOption('vorhanden')
    await dialog.getByRole('button', { name: 'Auf mehrere Buchungen aufteilen', exact: true }).click()
    const first = dialog.getByRole('region', { name: 'Buchung 1', exact: true })
    const second = dialog.getByRole('region', { name: 'Buchung 2', exact: true })
    await first.getByLabel('Verwendungszweck Buchung 1', { exact: true }).fill('Split Anteil A')
    await second.getByLabel('Verwendungszweck Buchung 2', { exact: true }).fill('Split Anteil B')
    await expect(first.getByLabel('Betrag Buchung 1', { exact: true })).toHaveValue('5,00')
    await expect(second.getByLabel('Betrag Buchung 2', { exact: true })).toHaveValue('5,00')
    await first.getByLabel('Tätigkeitsbereich 1', { exact: true }).selectOption('Z')
    await first.getByRole('button', { name: 'Aufteilen', exact: true }).click()
    await first.getByLabel('Tätigkeitsbereich 2', { exact: true }).selectOption('W')
    await first.getByLabel('Teilbetrag 1 in Euro', { exact: true }).fill('3,00')
    await first.getByLabel('Teilbetrag 2 in Euro', { exact: true }).fill('1,99')
    await expect(dialog.getByRole('button', { name: 'Weiter', exact: true })).toBeDisabled()
    await first.getByLabel('Teilbetrag 2 in Euro', { exact: true }).fill('2,00')
    await second.getByLabel('Kategorie Buchung 2', { exact: true }).selectOption('b')
    await expect(second.getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('I')
    await expect(first.getByRole('status').filter({ hasText: 'Beleg-Nr.' })).toHaveText('Beleg-Nr. M8')
    await expect(second.getByRole('status').filter({ hasText: 'Beleg-Nr.' })).toHaveText('Beleg-Nr. B1')
    await dialog.getByRole('button', { name: 'Weiter', exact: true }).click()
    await dialog.getByRole('button', { name: 'Überspringen', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(readYear(data).bookings).toEqual(base.bookings)
    await page.getByRole('button', { name: '2 Buchungen übernehmen', exact: true }).click()
    await expect.poll(() => readYear(data).bookings.length).toBe(3)
    const imported = readYear(data).bookings
    const partA = imported.find((booking) => booking.description === 'Split Anteil A')!
    const partB = imported.find((booking) => booking.description === 'Split Anteil B')!
    expect(partA).toMatchObject({ categoryId: 'm', refNo: 8, amount: 500 })
    expect(partB).toMatchObject({ categoryId: 'b', refNo: 1, amount: 500 })
    expect(partA.amount + partB.amount).toBe(1000)
    expect(imported[0]).toEqual(base.bookings[0])
    await expect.poll(() => assignmentFor(data, partA.id)?.allocations).toEqual([{ area: 'Z', amount: 300 }, { area: 'W', amount: 200 }])
    await expect.poll(() => assignmentFor(data, partB.id)?.allocations).toEqual([{ area: 'I', amount: 500 }])
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})
