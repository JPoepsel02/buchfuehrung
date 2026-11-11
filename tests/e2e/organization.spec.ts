import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppSettings, YearFile } from '../../src/shared/types'
import type { BookingReference, OrganizationConfig } from '../../src/shared/organization'
import { makeAssignment } from '../../src/shared/organization'

const requireDemo = createRequire(resolve('package.json'))
const { buildDemoData } = requireDemo(resolve('scripts/demo-data.cjs')) as {
  buildDemoData(): { files: YearFile[]; settings: AppSettings & { organization: OrganizationConfig }; references: Record<string, BookingReference> }
}
type DemoData = ReturnType<typeof buildDemoData>
const readSettings = (directory: string) => JSON.parse(readFileSync(join(directory, 'einstellungen.json'), 'utf8')) as AppSettings & { organization: OrganizationConfig }
const keyFor = (reference: BookingReference) => JSON.stringify([reference.konto, reference.year, reference.bookingId])
const yearFilename = (file: YearFile) => `kassenbuch${file.konto === 'zweit' ? '-k2' : file.konto && file.konto !== 'haupt' ? `-${file.konto}` : ''}-${file.year}.json`
const money = (amount: string) => `${amount} €`
const organizationNav = (page: Page) => page.getByRole('navigation', { name: 'Verein', exact: true })

function completeDemo(demo: DemoData): DemoData {
  const organization = demo.settings.organization
  const transfers = new Set(organization.transfers.flatMap((transfer) => [keyFor(transfer.from), keyFor(transfer.to)]))
  const additions = Object.fromEntries(demo.files.flatMap((file) => file.bookings.flatMap((booking) => {
    const key = keyFor({ konto: file.konto ?? 'haupt', year: file.year, bookingId: booking.id })
    return organization.assignments[key] || transfers.has(key) ? [] : [[key, makeAssignment(booking, [{ area: 'I', amount: booking.amount }])]]
  })))
  return { ...demo, settings: { ...demo.settings, organization: { ...organization,
    assignments: { ...organization.assignments, ...additions },
  } } }
}

async function startAt(root: string) {
  const app = await electron.launch({
    args: [resolve('tests/e2e/bootstrap.cjs')],
    env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root },
  })
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { level: 1, name: 'Vereinsübersicht', exact: true })).toBeVisible()
  return { app, page }
}

async function launch(prepare?: (demo: DemoData) => DemoData) {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-organization-'))
  const data = join(root, 'kassenwart', 'daten')
  const output = join(root, 'exports')
  mkdirSync(data, { recursive: true })
  mkdirSync(output)
  const originalDemo = buildDemoData()
  const demo = prepare ? prepare(originalDemo) : originalDemo
  for (const file of demo.files) writeFileSync(join(data, yearFilename(file)), JSON.stringify(file))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ ...demo.settings, theme: 'hell' }))
  try {
    return { ...await startAt(root), root, data, output, demo }
  } catch (failure) {
    rmSync(root, { recursive: true, force: true })
    throw failure
  }
}

async function close(app: ElectronApplication, root: string) {
  try { await app.close() } finally { rmSync(root, { recursive: true, force: true }) }
}

async function expectTotals(page: Page, expected = ['36.700,00', '49.700,00', '26.000,00', '23.700,00']) {
  const values = page.locator('.org-stats .stat__value')
  await expect(values).toHaveCount(4)
  for (let index = 0; index < expected.length; index++) await expect(values.nth(index)).toContainText(money(expected[index]))
}

async function stubSaveDialogs(app: ElectronApplication, output: string) {
  await app.evaluate(({ dialog, shell }, directory) => {
    let exportIndex = 0
    dialog.showSaveDialog = async (...args: unknown[]) => {
      const options = args[args.length - 1] as { defaultPath?: string }
      const name = (options.defaultPath ?? 'export').split(/[\\/]/).pop()!
      return { canceled: false, filePath: `${directory}/${++exportIndex}-${name}` }
    }
    shell.showItemInFolder = () => {}
  }, output)
}

async function exportNewFile(page: Page, output: string, buttonName: string | RegExp, extension: string) {
  const before = new Set(readdirSync(output))
  await page.getByRole('button', { name: buttonName, exact: typeof buttonName === 'string' }).click()
  const newFiles = () => readdirSync(output).filter((name) => !before.has(name) && name.endsWith(extension))
  await expect.poll(() => newFiles().length).toBe(1)
  return join(output, newFiles()[0])
}

test('konsolidiert Bankkonten und Barkasse über zwei Kassenjahre ohne doppelte Anfangsbestände', async () => {
  const { app, page, root } = await launch()
  try {
    await expectTotals(page)
    await expect(page.locator('.org-account-card')).toHaveCount(3)
    await expect(page.locator('.org-account-card').filter({ hasText: 'Hauptkonto' })).toContainText(money('22.980,00'))
    await expect(page.locator('.org-account-card').filter({ hasText: 'Karnevalskonto' })).toContainText(money('12.100,00'))
    await expect(page.locator('.org-account-card').filter({ hasText: 'Barkasse' })).toContainText(money('1.620,00'))
    await expect(page.locator('.org-open-count')).toHaveText('3')
    await expect(page.locator('.org-card-footer')).toContainText('2 Umbuchungen')
    await expect(page.locator('.org-card-footer')).toContainText(money('2.500,00'))
    await expect(page.getByText(/Einzeln weiterarbeiten|Einmal pflegen|Ein Verein\. Ein Überblick/i)).toHaveCount(0)
  } finally { await close(app, root) }
})

test('speichert eine centgenaue Aufteilung und lädt sie nach einem App-Neustart wieder', async () => {
  const harness = await launch()
  let { app, page } = harness
  const { data, root, demo } = harness
  try {
    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await page.getByRole('tab', { name: /Buchungen prüfen/ }).click()
    const row = page.getByRole('row').filter({ hasText: 'Gemeinschaftliche Anschaffung' })
    await row.getByRole('button', { name: 'Zuordnen', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Buchung zuordnen', exact: true })
    await dialog.getByLabel('Tätigkeitsbereich auswählen', { exact: true }).selectOption('Z')
    await dialog.getByRole('button', { name: 'Aufteilen', exact: true }).click()
    await dialog.getByLabel('Tätigkeitsbereich 2', { exact: true }).selectOption('W')
    await dialog.getByLabel('Teilbetrag 1 in Euro', { exact: true }).fill('1439,99')
    await dialog.getByLabel('Teilbetrag 2 in Euro', { exact: true }).fill('960,00')
    await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled()
    await dialog.getByLabel('Teilbetrag 1 in Euro', { exact: true }).fill('1440,00')
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const assignmentKey = keyFor(demo.references.b09)
    await expect.poll(() => readSettings(data).organization.assignments[assignmentKey]?.allocations).toEqual([
      { area: 'Z', amount: 144000 }, { area: 'W', amount: 96000 },
    ])
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')).bookings.find((booking: { id: string }) => booking.id === 'b09').amount).toBe(240000)
    await app.close()
    ;({ app, page } = await startAt(root))
    await expectTotals(page)
    await expect(page.locator('.org-open-count')).toHaveText('2')
    const summary = page.locator('.org-overview-grid .ledger')
    await expect(summary.getByRole('row').filter({ hasText: 'Zweckbetrieb' })).toContainText(money('460,00'))
    await expect(summary.getByRole('row').filter({ hasText: 'Wirtschaftlicher Geschäftsbetrieb' })).toContainText(money('7.260,00'))
    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await page.getByRole('tab', { name: 'Alle Buchungen', exact: true }).click()
    await page.getByRole('row').filter({ hasText: 'Gemeinschaftliche Anschaffung' }).getByRole('button', { name: 'Bearbeiten', exact: true }).click()
    await expect(page.getByLabel('Teilbetrag 1 in Euro', { exact: true })).toHaveValue('1.440,00')
    await expect(page.getByLabel('Teilbetrag 2 in Euro', { exact: true })).toHaveValue('960,00')
  } finally { await close(app, root) }
})

test('hebt eine Transferverknüpfung auf und neutralisiert dieselben Bewegungen nach erneuter Bestätigung', async () => {
  const { app, page, data, root } = await launch()
  try {
    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await page.getByRole('tab', { name: 'Umbuchungen', exact: true }).click()
    await page.locator('.org-transfer-pair').filter({ hasText: 'Karnevalskonto' }).getByRole('button', { name: 'Verknüpfung entfernen', exact: true }).click()
    await expect.poll(() => readSettings(data).organization.transfers.length).toBe(1)
    await organizationNav(page).getByRole('button', { name: 'Vereinsübersicht', exact: true }).click()
    await expectTotals(page, ['36.700,00', '51.700,00', '28.000,00', '23.700,00'])
    await expect(page.locator('.org-open-count')).toHaveText('5')
    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await page.getByRole('tab', { name: 'Umbuchungen', exact: true }).click()
    const outgoing = page.getByLabel('Abgang der Umbuchung', { exact: true })
    const outgoingValue = await outgoing.locator('option').filter({ hasText: 'Umbuchung Karnevalskonto' }).getAttribute('value')
    await outgoing.selectOption(outgoingValue!)
    const incoming = page.getByLabel('Zugang der Umbuchung', { exact: true })
    const incomingValue = await incoming.locator('option').filter({ hasText: 'Umbuchung vom Hauptkonto' }).getAttribute('value')
    await incoming.selectOption(incomingValue!)
    await page.getByRole('button', { name: 'Verknüpfen', exact: true }).click()
    await expect.poll(() => readSettings(data).organization.transfers.some((transfer) => transfer.from.bookingId === 'b17' && transfer.to.bookingId === 'b18')).toBe(true)
    await organizationNav(page).getByRole('button', { name: 'Vereinsübersicht', exact: true }).click()
    await expectTotals(page)
    await expect(page.locator('.org-open-count')).toHaveText('3')
  } finally { await close(app, root) }
})

test('exportiert alle neuen Berichtsarten als echte PDF und CSV und berücksichtigt Zeitraum und Kontenauswahl', async () => {
  test.setTimeout(90_000)
  const { app, page, output, root } = await launch(completeDemo)
  try {
    await stubSaveDialogs(app, output)
    await organizationNav(page).getByRole('button', { name: 'Berichte', exact: true }).click()
    for (const title of ['Einnahmenüberschussrechnung (EÜR)', 'Buchungsübersicht', 'Veranstaltungsauswertung']) {
      await page.getByRole('button', { name: title, exact: true }).click()
      const preview = page.frameLocator('iframe').locator('body')
      await expect(preview.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
      const pdf = await exportNewFile(page, output, 'PDF exportieren', '.pdf')
      expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
      expect(readFileSync(pdf).byteLength).toBeGreaterThan(1000)
      if (title === 'Einnahmenüberschussrechnung (EÜR)') {
        mkdirSync(resolve('.validation'), { recursive: true })
        copyFileSync(pdf, resolve('.validation/EUER-aktuell.pdf'))
      }
      const csv = await exportNewFile(page, output, 'CSV', '.csv')
      const text = readFileSync(csv, 'utf8')
      expect(text).toContain(title)
      expect(text).toContain('01.01.2026')
      expect(text).toContain('31.12.2026')
      if (title === 'Einnahmenüberschussrechnung (EÜR)') {
        expect(text).not.toMatch(/Hauptkonto|Karnevalskonto|Barkasse|Noch zuzuordnen|Offene Zuordnungen|Zuordnung vollständig|Vorläufig/)
        await expect(preview).not.toContainText(/Hauptkonto|Karnevalskonto|Barkasse|Noch zuzuordnen|Offene Zuordnungen|Zuordnung vollständig|Vorläufig/)
      } else {
        expect(text).toContain('Karnevalskonto')
        expect(text).toContain('Barkasse')
      }
      await page.getByRole('button', { name: 'Alle Berichte', exact: true }).click()
      await expect(page.getByRole('navigation', { name: 'Berichtsarten', exact: true }).getByRole('button')).toHaveCount(5)
    }
    await page.getByRole('button', { name: 'Einnahmenüberschussrechnung (EÜR)', exact: true }).click()
    await page.getByLabel('Von', { exact: true }).fill('2026-02-01')
    await page.getByLabel('Bis', { exact: true }).fill('2026-02-28')
    await page.getByRole('checkbox', { name: 'Barkasse', exact: true }).uncheck()
    await expect(page.getByRole('checkbox', { name: 'Barkasse', exact: true })).not.toBeChecked()
    await expect(page.locator('iframe')).toHaveAttribute('srcdoc', /21\.800,00/)
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('header')).toContainText('01.02.2026 bis 28.02.2026')
    await expect(frame.locator('header')).not.toContainText('Barkasse')
    await expect(frame.getByRole('region', { name: 'Abstimmung', exact: true })).toContainText(money('21.800,00'))
    const csv = await exportNewFile(page, output, 'CSV', '.csv')
    const filtered = readFileSync(csv, 'utf8')
    expect(filtered).toContain('01.02.2026')
    expect(filtered).toContain('28.02.2026')
    expect(filtered).not.toContain('Barkasse')
  } finally { await close(app, root) }
})

test('sperrt EÜR-Exporte bei offenen Zuordnungen und gibt nur vollständig zugeordnete Auswahl frei', async () => {
  test.setTimeout(90_000)
  const { app, page, output, root } = await launch()
  try {
    await stubSaveDialogs(app, output)
    await organizationNav(page).getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('button', { name: 'Einnahmenüberschussrechnung (EÜR)', exact: true }).click()
    const pdf = page.getByRole('button', { name: 'PDF exportieren', exact: true })
    const csv = page.getByRole('button', { name: 'CSV', exact: true })
    await expect(pdf).toBeDisabled()
    await expect(csv).toBeDisabled()
    await expect(page.locator('.org-report-options')).toContainText('3 Zuordnungen offen')
    const preview = page.frameLocator('iframe').locator('body')
    await expect(preview.getByRole('heading', { level: 1, name: 'Einnahmenüberschussrechnung (EÜR)', exact: true })).toBeVisible()
    await expect(preview).not.toContainText(/Noch zuzuordnen|Offene Zuordnungen|Zuordnung vollständig|Vorläufig|Hauptkonto|Karnevalskonto|Barkasse/)
    expect(readdirSync(output)).toHaveLength(0)

    await page.getByLabel('Bis', { exact: true }).fill('2026-02-28')
    await expect(pdf).toBeEnabled()
    await expect(csv).toBeEnabled()
    await page.getByLabel('Bis', { exact: true }).fill('2026-12-31')
    await expect(pdf).toBeDisabled()
    await page.getByRole('checkbox', { name: 'Hauptkonto', exact: true }).uncheck()
    await expect(pdf).toBeEnabled()
    await expect(csv).toBeEnabled()
    await page.getByRole('checkbox', { name: 'Karnevalskonto', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: 'Barkasse', exact: true }).uncheck()
    await expect(pdf).toBeDisabled()
    await expect(csv).toBeDisabled()
    await page.getByRole('checkbox', { name: 'Hauptkonto', exact: true }).check()
    await expect(pdf).toBeDisabled()

    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await page.getByRole('tab', { name: /Buchungen prüfen/ }).click()
    for (const description of ['Gemeinschaftliche Anschaffung', 'Erstattung', 'Software']) {
      await page.getByRole('row').filter({ hasText: description }).getByRole('button', { name: 'Zuordnen', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Buchung zuordnen', exact: true })
      await dialog.getByLabel('Tätigkeitsbereich auswählen', { exact: true }).selectOption('I')
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    await organizationNav(page).getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('button', { name: 'Einnahmenüberschussrechnung (EÜR)', exact: true }).click()
    await expect(pdf).toBeEnabled()
    await expect(csv).toBeEnabled()
    const exported = await exportNewFile(page, output, 'CSV', '.csv')
    expect(readFileSync(exported, 'utf8')).not.toMatch(/Hauptkonto|Karnevalskonto|Barkasse|Noch zuzuordnen|Offene Zuordnungen|Zuordnung vollständig|Vorläufig/)
  } finally { await close(app, root) }
})

test('sperrt EÜR auch bei einer nachträglich ungültig gewordenen Zuordnung', async () => {
  const { app, page, root } = await launch((demo) => {
    const complete = completeDemo(demo)
    return { ...complete, files: complete.files.map((file) => file.konto !== 'haupt' ? file : {
      ...file, bookings: file.bookings.map((booking) => booking.id !== 'b01' ? booking : { ...booking, amount: booking.amount + 1 }),
    }) }
  })
  try {
    await organizationNav(page).getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('button', { name: 'Einnahmenüberschussrechnung (EÜR)', exact: true }).click()
    await expect(page.getByRole('button', { name: 'PDF exportieren', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeDisabled()
    await expect(page.locator('.org-report-options')).toContainText('Abgleich erforderlich')
    await page.getByRole('button', { name: 'Alle Berichte', exact: true }).click()
    await page.getByRole('button', { name: 'Buchungsübersicht', exact: true }).click()
    await expect(page.getByRole('button', { name: 'PDF exportieren', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeEnabled()
  } finally { await close(app, root) }
})

test('behält Kassenprüfbericht und Jahrespräsentation auf der gemeinsamen Berichtseite erreichbar', async () => {
  test.setTimeout(90_000)
  const { app, page, output, root } = await launch()
  try {
    await stubSaveDialogs(app, output)
    await organizationNav(page).getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('button', { name: 'Kassenprüfbericht', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Berichte', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Kassenprüfbericht 2026', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Berichtsarten', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Alle Berichte', exact: true })).toBeVisible()
    const report = await exportNewFile(page, output, 'Prüfbericht als PDF …', '.pdf')
    expect(readFileSync(report).subarray(0, 5).toString()).toBe('%PDF-')
    const presentation = await exportNewFile(page, output, 'Jahres-Präsentation (PDF) …', '.pdf')
    expect(readFileSync(presentation).subarray(0, 5).toString()).toBe('%PDF-')
    await page.getByRole('button', { name: 'Alle Berichte', exact: true }).click()
    await page.getByRole('navigation', { name: 'Berichtsarten', exact: true }).getByRole('button', { name: 'Jahrespräsentation', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Berichte', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Jahrespräsentation 2026', exact: true })).toBeVisible()
    const presentationViewExport = await exportNewFile(page, output, 'PDF exportieren', '.pdf')
    expect(readFileSync(presentationViewExport).subarray(0, 5).toString()).toBe('%PDF-')
    await expect(page.getByRole('navigation', { name: 'Berichtsarten', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Alle Berichte', exact: true })).toBeVisible()
    await page.getByLabel('Konto wählen', { exact: true }).selectOption('haupt')
    await page.getByRole('navigation', { name: 'Hauptnavigation', exact: true }).getByRole('button', { name: 'Chronologisch', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: /Chronologisch/ })).toBeVisible()
  } finally { await close(app, root) }
})

test('speichert gemeinsame Stammdaten und ändert alte Buchungen beim Zuordnen einer Kategorie nicht automatisch', async () => {
  const harness = await launch()
  let { app, page } = harness
  const { data, root, demo } = harness
  try {
    await organizationNav(page).getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await expect(page.getByLabel(/Berichtstitel|Titel des Bereichsberichts|Berichtsname/i)).toHaveCount(0)
    await page.getByLabel('Vereinsname', { exact: true }).fill('Lokaler Testverein')
    await page.getByLabel('Kassenwart:in', { exact: true }).fill('Kassenperson Test')
    await page.locator('form').filter({ has: page.getByLabel('Vereinsname', { exact: true }) }).getByRole('button', { name: 'Speichern', exact: true }).click()
    await expect.poll(() => readSettings(data).organization.name).toBe('Lokaler Testverein')
    expect(readSettings(data).organization.treasurerName).toBe('Kassenperson Test')
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')).clubName).toBe(demo.files[0].clubName)
    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Kategorien zuordnen', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByLabel('Tätigkeitsbereich für Allgemein (Hauptkonto)', { exact: true }).selectOption('V')
    await expect.poll(() => readSettings(data).organization.rules.some((rule) => rule.konto === 'haupt' && rule.categoryId === 'allgemein' && rule.area === 'V')).toBe(true)
    expect(readSettings(data).organization.assignments[keyFor(demo.references.b09)]).toBeUndefined()
    expect(readSettings(data).organization.assignments[keyFor(demo.references.b05)].allocations).toEqual([{ area: 'I', amount: 12000 }])
    await page.getByRole('tab', { name: /Buchungen prüfen/ }).click()
    await expect(page.getByRole('row').filter({ hasText: 'Gemeinschaftliche Anschaffung' })).toContainText('Vorschlag: Vermögensverwaltung')
    await app.close()
    ;({ app, page } = await startAt(root))
    await expect(page.locator('.org-open-count')).toHaveText('3')
    await organizationNav(page).getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await expect(page.getByLabel('Vereinsname', { exact: true })).toHaveValue('Lokaler Testverein')
    await expect(page.getByLabel('Kassenwart:in', { exact: true })).toHaveValue('Kassenperson Test')
  } finally { await close(app, root) }
})

test('zeigt alle Kategorien einschließlich unbenutzter Kontokategorien und speichert die Inline-Zuordnung', async () => {
  const harness = await launch()
  let { app, page } = harness
  const { data, root, demo } = harness
  const expectedKeys = [...new Set(demo.files.flatMap((file) => file.categories.map((category) => JSON.stringify([file.konto ?? 'haupt', category.id]))))].sort()
  const assignmentSnapshot = readSettings(data).organization.assignments
  try {
    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Kategorien zuordnen', exact: true })).toHaveAttribute('aria-selected', 'true')
    let categoryRows = page.locator('[data-category-key]')
    await expect(categoryRows).toHaveCount(expectedKeys.length)
    expect((await categoryRows.evaluateAll((items) => items.map((item) => item.getAttribute('data-category-key')!))).sort()).toEqual(expectedKeys)
    await expect(page.getByLabel('Kategorien nach Konto filtern', { exact: true })).toHaveValue('')
    await page.getByLabel('Kategorien nach Konto filtern', { exact: true }).selectOption('haupt')
    await expect(categoryRows).toHaveCount(5)
    await expect(categoryRows.filter({ hasText: 'Karneval' })).toHaveCount(1)
    await expect(categoryRows.filter({ hasText: 'Karneval' })).toContainText('Hauptkonto')
    await page.getByLabel('Kategorien nach Zuordnung filtern', { exact: true }).selectOption('unassigned')
    await expect(categoryRows).toHaveCount(2)
    await page.getByLabel('Tätigkeitsbereich für Karneval (Hauptkonto)', { exact: true }).selectOption('W')
    await expect.poll(() => readSettings(data).organization.rules.find((rule) => rule.konto === 'haupt' && rule.categoryId === 'karneval')?.area).toBe('W')
    await expect(categoryRows).toHaveCount(1)
    expect(readSettings(data).organization.assignments).toEqual(assignmentSnapshot)
    await page.getByLabel('Kategorien nach Konto filtern', { exact: true }).selectOption('zweit')
    await expect(categoryRows).toHaveCount(5)
    await expect(categoryRows.filter({ has: page.getByText('Karneval', { exact: true }) })).toContainText('Karnevalskonto')
    await app.close()
    ;({ app, page } = await startAt(root))
    categoryRows = page.locator('[data-category-key]')
    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await expect(categoryRows).toHaveCount(expectedKeys.length)
    await expect(page.getByLabel('Tätigkeitsbereich für Karneval (Hauptkonto)', { exact: true })).toHaveValue('W')
    expect(readSettings(data).organization.assignments).toEqual(assignmentSnapshot)
  } finally { await close(app, root) }
})

test('übernimmt Kategorie-Vorgaben erst nach Vorschau und schützt manuelle, geteilte und ungültige Altzuordnungen', async () => {
  const { app, page, data, root, demo } = await launch((source) => {
    const shared = source.files[0].bookings.find((booking) => booking.id === 'b09')!
    const invalid = source.files[0].bookings.find((booking) => booking.id === 'b16')!
    const assignment = (booking: typeof shared, allocations: Array<{ area: 'I' | 'V' | 'Z' | 'W'; amount: number }>) => ({
      amount: booking.amount, type: booking.type, date: booking.date, categoryId: booking.categoryId, allocations,
    })
    return { ...source, settings: { ...source.settings, organization: { ...source.settings.organization,
      assignments: { ...source.settings.organization.assignments,
        [keyFor(source.references.b09)]: assignment(shared, [{ area: 'Z', amount: 144000 }, { area: 'W', amount: 96000 }]),
        [keyFor(source.references.b16)]: assignment({ ...invalid, amount: 35000 }, [{ area: 'W', amount: 35000 }]),
      },
    } } }
  })
  try {
    const before = readSettings(data).organization.assignments
    await organizationNav(page).getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await page.getByLabel('Tätigkeitsbereich für Allgemein (Hauptkonto)', { exact: true }).selectOption('V')
    await expect.poll(() => readSettings(data).organization.rules.find((rule) => rule.konto === 'haupt' && rule.categoryId === 'allgemein')?.area).toBe('V')
    expect(readSettings(data).organization.assignments).toEqual(before)
    await page.getByRole('button', { name: 'Bestehende Buchungen zuordnen', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Bestehende Buchungen zuordnen', exact: true })
    await expect(preview.getByRole('row').filter({ hasText: 'Erstattung' })).toHaveCount(1)
    for (const protectedBooking of ['Gemeinschaftliche Anschaffung', 'Software', 'Versicherung', 'Bankgebühren', 'Bargeldabhebung', 'Umbuchung Karnevalskonto']) {
      await expect(preview.getByRole('row').filter({ hasText: protectedBooking })).toHaveCount(0)
    }
    expect(readSettings(data).organization.assignments).toEqual(before)
    await preview.getByRole('button', { name: 'Abbrechen', exact: true }).click()
    expect(readSettings(data).organization.assignments).toEqual(before)
    await page.getByRole('button', { name: 'Bestehende Buchungen zuordnen', exact: true }).click()
    await preview.getByRole('button', { name: 'Zuordnung übernehmen', exact: true }).click()
    await expect(preview).toHaveCount(0)
    const newKey = keyFor(demo.references.b15)
    await expect.poll(() => readSettings(data).organization.assignments[newKey]?.allocations).toEqual([{ area: 'V', amount: 18000 }])
    const after = readSettings(data).organization.assignments
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), newKey].sort())
    for (const [key, value] of Object.entries(before)) expect(after[key]).toEqual(value)
    expect(after[keyFor(demo.references.b17)]).toBeUndefined()
    expect(after[keyFor(demo.references.b19)]).toBeUndefined()
  } finally { await close(app, root) }
})

test('verlangt beim Kategorie-Anlegen einen Bereich und übernimmt ihn für neue Buchungen mit änderbaren Splits', async () => {
  const { app, page, data, root } = await launch()
  const readMain = () => JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')) as YearFile
  try {
    await page.getByLabel('Konto wählen', { exact: true }).selectOption('haupt')
    const accountNav = page.getByRole('navigation', { name: 'Hauptnavigation', exact: true })
    await accountNav.getByRole('button', { name: 'Kontoeinstellungen', exact: true }).click()
    const categorySection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Veranstaltungen / Kategorien', exact: true }) })
    await categorySection.getByLabel('Name der neuen Kategorie', { exact: true }).fill('Fortbildung')
    await categorySection.getByLabel('Kürzel der neuen Kategorie', { exact: true }).fill('FB')
    const initialCount = readMain().categories.length
    const addCategory = categorySection.getByRole('button', { name: 'Hinzufügen', exact: true })
    if (await addCategory.isEnabled()) await addCategory.click()
    expect(readMain().categories).toHaveLength(initialCount)
    await categorySection.getByLabel('Tätigkeitsbereich der neuen Kategorie', { exact: true }).selectOption('Z')
    await addCategory.click()
    await expect.poll(() => readMain().categories.find((category) => category.name === 'Fortbildung')?.id).toBeTruthy()
    const categoryId = readMain().categories.find((category) => category.name === 'Fortbildung')!.id
    await expect.poll(() => readSettings(data).organization.rules.find((rule) => rule.konto === 'haupt' && rule.categoryId === categoryId)?.area).toBe('Z')
    await accountNav.getByRole('button', { name: 'Buchungen', exact: true }).click()
    const form = page.locator('form.booking-form')
    await form.locator('#b-date').fill('2026-11-03')
    await form.locator('#b-cat').selectOption(categoryId)
    await form.locator('#b-amount').fill('123,45')
    await form.getByLabel('Name', { exact: true }).fill('Fortbildung Testperson')
    await form.locator('#b-desc').fill('Automatisch zugeordnete Fortbildung')
    await expect(form.getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('Z')
    await expect(form.getByLabel('Teilbetrag 1 in Euro', { exact: true })).toHaveValue('123,45')
    await form.locator('#b-amount').fill('225,50')
    await expect(form.getByLabel('Teilbetrag 1 in Euro', { exact: true })).toHaveValue('225,50')
    await form.getByRole('button', { name: 'Buchung hinzufügen', exact: true }).click()
    await expect.poll(() => readMain().bookings.find((booking) => booking.description === 'Automatisch zugeordnete Fortbildung')?.id).toBeTruthy()
    const automatic = readMain().bookings.find((booking) => booking.description === 'Automatisch zugeordnete Fortbildung')!
    await expect.poll(() => readSettings(data).organization.assignments[keyFor({ konto: 'haupt', year: 2026, bookingId: automatic.id })]?.allocations).toEqual([{ area: 'Z', amount: 22550 }])

    await form.locator('#b-date').fill('2026-11-03')
    await form.locator('#b-cat').selectOption(categoryId)
    await form.locator('#b-amount').fill('200,01')
    await form.getByLabel('Name', { exact: true }).fill('Fortbildung Testperson')
    await form.locator('#b-desc').fill('Manuell aufgeteilte Fortbildung')
    await form.getByLabel('Tätigkeitsbereich 1', { exact: true }).selectOption('V')
    await form.locator('#b-cat').selectOption('spenden')
    await expect(form.getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('V')
    await form.getByRole('button', { name: 'Aufteilen', exact: true }).click()
    await form.getByLabel('Tätigkeitsbereich 2', { exact: true }).selectOption('I')
    await form.getByLabel('Teilbetrag 1 in Euro', { exact: true }).fill('120,01')
    await form.getByLabel('Teilbetrag 2 in Euro', { exact: true }).fill('80,00')
    await form.locator('#b-cat').selectOption('freizeit')
    await expect(form.getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('V')
    await expect(form.getByLabel('Tätigkeitsbereich 2', { exact: true })).toHaveValue('I')
    await expect(form.getByLabel('Teilbetrag 1 in Euro', { exact: true })).toHaveValue('120,01')
    await expect(form.getByLabel('Teilbetrag 2 in Euro', { exact: true })).toHaveValue('80,00')
    await form.getByRole('button', { name: 'Kategorie-Vorgabe verwenden', exact: true }).click()
    await expect(form.getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('Z')
    await expect(form.getByLabel('Tätigkeitsbereich 2', { exact: true })).toHaveCount(0)
    await expect(form.getByLabel('Teilbetrag 1 in Euro', { exact: true })).toHaveValue('200,01')
    await form.getByLabel('Tätigkeitsbereich 1', { exact: true }).selectOption('V')
    await form.getByRole('button', { name: 'Aufteilen', exact: true }).click()
    await form.getByLabel('Tätigkeitsbereich 2', { exact: true }).selectOption('I')
    await form.getByLabel('Teilbetrag 1 in Euro', { exact: true }).fill('120,01')
    await form.getByLabel('Teilbetrag 2 in Euro', { exact: true }).fill('80,00')
    await form.getByRole('button', { name: 'Buchung hinzufügen', exact: true }).click()
    await expect.poll(() => readMain().bookings.find((booking) => booking.description === 'Manuell aufgeteilte Fortbildung')?.id).toBeTruthy()
    const manual = readMain().bookings.find((booking) => booking.description === 'Manuell aufgeteilte Fortbildung')!
    expect(manual.categoryId).toBe('freizeit')
    expect(manual.amount).toBe(20001)
    await expect.poll(() => readSettings(data).organization.assignments[keyFor({ konto: 'haupt', year: 2026, bookingId: manual.id })]?.allocations).toEqual([{ area: 'V', amount: 12001 }, { area: 'I', amount: 8000 }])
  } finally { await close(app, root) }
})

test('speichert Kontonummern jahresübergreifend und erhält eine Prüfberichtsauswahl ohne Hauptkonto nach dem Neustart', async () => {
  test.setTimeout(90_000)
  const harness = await launch()
  let { app, page } = harness
  const { data, output, root } = harness
  const mainNumber = 'DE89 3704 0044 0532 0130 00'
  const secondNumber = '1234567890'
  const secondName = 'Veranstaltungskonto'
  const openAccountSettings = async (id: string) => {
    await page.getByLabel('Konto wählen', { exact: true }).selectOption(id)
    await page.getByRole('navigation', { name: 'Hauptnavigation', exact: true }).getByRole('button', { name: 'Kontoeinstellungen', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Kontoeinstellungen', exact: true })).toBeVisible()
  }
  const openAudit = async () => {
    await organizationNav(page).getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('navigation', { name: 'Berichtsarten', exact: true }).getByRole('button', { name: 'Kassenprüfbericht', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Kassenprüfbericht 2026', exact: true })).toBeVisible()
  }
  try {
    await openAccountSettings('haupt')
    await page.getByLabel('IBAN / Kontonummer', { exact: true }).fill(mainNumber)
    await page.getByLabel('IBAN / Kontonummer', { exact: true }).blur()
    await expect.poll(() => readSettings(data).accountNumbers?.haupt).toBe(mainNumber)
    await openAccountSettings('zweit')
    await page.getByLabel('IBAN / Kontonummer', { exact: true }).fill(secondNumber)
    await page.getByLabel('IBAN / Kontonummer', { exact: true }).blur()
    await expect.poll(() => readSettings(data).accountNumbers?.zweit).toBe(secondNumber)
    await page.getByLabel('Jahr wählen', { exact: true }).selectOption('2025')
    await expect(page.getByLabel('IBAN / Kontonummer', { exact: true })).toHaveValue(secondNumber)
    await page.getByLabel('Jahr wählen', { exact: true }).selectOption('2026')
    await expect(page.getByLabel('IBAN / Kontonummer', { exact: true })).toHaveValue(secondNumber)
    await page.getByLabel('Konto-Name', { exact: true }).fill(secondName)
    await page.getByLabel('Konto-Name', { exact: true }).blur()
    await expect.poll(() => (JSON.parse(readFileSync(join(data, 'kassenbuch-k2-2026.json'), 'utf8')) as YearFile).kontoName).toBe(secondName)

    await openAudit()
    await expect(page.getByLabel('Geprüftes Konto 1', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Geprüftes Konto 2 (optional)', { exact: true })).toHaveCount(0)
    const preview = () => page.frameLocator('iframe[title="Vorschau Prüfbericht"]')
    await expect(preview().locator('.account-title')).toHaveText([
      `1. Bericht Hauptkonto ${mainNumber}`, `2. Bericht ${secondName} ${secondNumber}`, '3. Bericht Barkasse',
    ])
    await expect(preview().locator('.konto-head')).toHaveText([
      `Geprüft wurde das Konto Hauptkonto ${mainNumber}`,
      `Geprüft wurde das Konto ${secondName} ${secondNumber}`,
      'Geprüft wurde das Konto Barkasse',
    ])
    await page.getByRole('checkbox', { name: 'Hauptkonto im Bericht', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: 'Barkasse im Bericht', exact: true }).uncheck()
    await expect(page.getByRole('checkbox', { name: `${secondName} im Bericht`, exact: true })).toBeChecked()
    await expect(preview().locator('.account-title')).toHaveText([`1. Bericht ${secondName} ${secondNumber}`])
    await expect(preview().locator('.konto-head')).toHaveText([`Geprüft wurde das Konto ${secondName} ${secondNumber}`])
    await expect(preview().locator('body')).not.toContainText(`Hauptkonto ${mainNumber}`)
    const excluded = () => (JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')) as YearFile).reportExcludedKontos
    await expect.poll(() => [...(excluded() ?? [])].sort()).toEqual(['haupt', 'k3'])

    await app.close()
    ;({ app, page } = await startAt(root))
    await openAccountSettings('zweit')
    await expect(page.getByLabel('Konto wählen', { exact: true }).locator('option[value="zweit"]')).toHaveText(secondName)
    await expect(page.getByLabel('IBAN / Kontonummer', { exact: true })).toHaveValue(secondNumber)
    await page.getByLabel('Jahr wählen', { exact: true }).selectOption('2025')
    await expect(page.getByLabel('IBAN / Kontonummer', { exact: true })).toHaveValue(secondNumber)
    expect(readSettings(data).accountNumbers?.haupt).toBe(mainNumber)
    expect(readSettings(data).accountNumbers?.zweit).toBe(secondNumber)
    await openAudit()
    await expect(page.getByRole('checkbox', { name: 'Hauptkonto im Bericht', exact: true })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Barkasse im Bericht', exact: true })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: `${secondName} im Bericht`, exact: true })).toBeChecked()
    await expect(preview().locator('.account-title')).toHaveText([`1. Bericht ${secondName} ${secondNumber}`])
    await expect(preview().locator('.konto-head')).toHaveText([`Geprüft wurde das Konto ${secondName} ${secondNumber}`])
    await page.getByRole('checkbox', { name: `${secondName} im Bericht`, exact: true }).uncheck()
    await expect(page.getByRole('button', { name: 'Prüfbericht als PDF …', exact: true })).toBeDisabled()
    await expect(page.locator('iframe[title="Vorschau Prüfbericht"]')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Bitte mindestens ein Konto auswählen.' })).toBeVisible()
    await page.getByRole('checkbox', { name: `${secondName} im Bericht`, exact: true }).check()
    await expect(page.getByRole('button', { name: 'Prüfbericht als PDF …', exact: true })).toBeEnabled()
    await expect(preview().locator('.account-title')).toHaveText([`1. Bericht ${secondName} ${secondNumber}`])
    await stubSaveDialogs(app, output)
    const pdf = await exportNewFile(page, output, 'Prüfbericht als PDF …', '.pdf')
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
    expect(readFileSync(pdf).byteLength).toBeGreaterThan(1000)
  } finally { await close(app, root) }
})

test('erfasst eine neue Kontobuchung mit Bereich und erhält Buchung und Zuordnung beim Neustart', async () => {
  const harness = await launch()
  let { app, page } = harness
  const { data, root } = harness
  try {
    await page.locator('.org-account-card').filter({ hasText: 'Hauptkonto' }).click()
    await page.getByRole('navigation', { name: 'Hauptnavigation', exact: true }).getByRole('button', { name: 'Buchungen', exact: true }).click()
    await page.getByLabel('Datum', { exact: true }).fill('2026-11-03')
    await page.getByLabel('Veranstaltung / Kategorie', { exact: true }).selectOption('beitrag')
    await page.getByLabel('Art', { exact: true }).selectOption('einnahme')
    await page.getByLabel('Betrag (€)', { exact: true }).fill('125,00')
    await page.getByLabel('Name', { exact: true }).fill('Mitglied Test')
    await page.getByLabel('Verwendungszweck', { exact: true }).fill('Zusätzlicher Testbeitrag')
    await expect(page.getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('I')
    await page.getByRole('button', { name: 'Buchung hinzufügen', exact: true }).click()
    const mainFile = () => JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')) as YearFile
    await expect.poll(() => mainFile().bookings.some((booking) => booking.description === 'Zusätzlicher Testbeitrag')).toBe(true)
    const booking = mainFile().bookings.find((entry) => entry.description === 'Zusätzlicher Testbeitrag')!
    expect(booking.amount).toBe(12500)
    expect(booking.type).toBe('einnahme')
    await expect.poll(() => readSettings(data).organization.assignments[keyFor({ konto: 'haupt', year: 2026, bookingId: booking.id })]?.allocations).toEqual([{ area: 'I', amount: 12500 }])
    await app.close()
    ;({ app, page } = await startAt(root))
    await expectTotals(page, ['36.825,00', '49.825,00', '26.000,00', '23.825,00'])
    await expect(page.locator('.org-open-count')).toHaveText('3')
  } finally { await close(app, root) }
})

test('ordnet eine alte Buchung beim Kategorienwechsel erst nach bewusster Bereichsauswahl zu', async () => {
  const { app, page, root, data, demo } = await launch()
  try {
    const reference = demo.references.b15
    const readMain = () => JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')) as YearFile
    await page.getByLabel('Konto wählen', { exact: true }).selectOption('haupt')
    await page.getByRole('navigation', { name: 'Hauptnavigation', exact: true }).getByRole('button', { name: 'Buchungen', exact: true }).click()
    const edit = () => page.getByRole('row').filter({ hasText: 'Erstattung' }).getByRole('button', { name: 'Bearbeiten', exact: true }).click()
    await edit()
    await page.getByLabel('Veranstaltung / Kategorie', { exact: true }).selectOption('spenden')
    await page.getByLabel('Name', { exact: true }).fill('Nachtrag Person')
    await expect(page.getByLabel('Tätigkeitsbereich auswählen', { exact: true })).toHaveValue('')
    await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click()
    await expect.poll(() => readMain().bookings.find((entry) => entry.id === reference.bookingId)?.categoryId).toBe('spenden')
    expect(readSettings(data).organization.assignments[keyFor(reference)]).toBeUndefined()
    await edit()
    await page.getByRole('button', { name: 'Kategorie-Vorgabe verwenden', exact: true }).click()
    await expect(page.getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('I')
    await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click()
    await expect.poll(() => readSettings(data).organization.assignments[keyFor(reference)]?.allocations).toEqual([{ area: 'I', amount: 18000 }])
  } finally { await close(app, root) }
})

test('verwendet ausschließlich den Testdatenordner und deaktiviert Update-Netzwerkzugriffe', async () => {
  const { app, page, root } = await launch()
  try {
    const identity = await app.evaluate(({ app, BrowserWindow }) => ({ name: app.getName(), title: BrowserWindow.getAllWindows()[0].getTitle(), userData: app.getPath('userData') }))
    expect(identity.name).toBe('Buchführung · Lokal')
    expect(identity.title).toBe('Buchführung · Lokal')
    expect(identity.userData).toBe(join(root, 'kassenwart'))
    const externalRequests: string[] = []
    page.on('request', (request) => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()) })
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Vereinsübersicht', exact: true })).toBeVisible()
    const update = await page.evaluate(() => window.kassenwart!.checkForUpdate())
    expect(update.hasUpdate).toBe(false)
    expect(update.notes).toContain('Lokale Entwicklungsversion')
    const result = await page.evaluate(() => window.kassenwart!.installUpdate({ current: '0', latest: '999', hasUpdate: true, assetUrl: 'https://example.invalid/installer.zip' }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('deaktiviert')
    expect(externalRequests).toEqual([])
    expect(existsSync(join(identity.userData, 'daten', 'einstellungen.json'))).toBe(true)
  } finally { await close(app, root) }
})
