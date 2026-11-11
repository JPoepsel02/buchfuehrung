import { describe, expect, test } from 'vitest'
import { splitCsvLine } from '@shared/csv'
import { bookingKey, buildOrganizationReport, createTransfer, makeAssignment, organizationDefaults } from '@shared/organization'
import type { ActivityAllocation, OrganizationAssignment, OrganizationConfig, OrganizationPeriod, OrganizationReport } from '@shared/organization'
import type { Booking, YearFile } from '@shared/types'
import { formatEur, parseAmountToCents } from '@shared/money'
import {
  buildOrganizationReportHtml, canExportOrganizationReport, ORGANIZATION_REPORT_TITLES, organizationReportRows, organizationReportToCsv,
} from '../organizationReport'
import type { OrganizationReportKind } from '../organizationReport'

const PERIOD: OrganizationPeriod = { from: '2026-01-01', to: '2026-12-31' }
const KINDS: OrganizationReportKind[] = ['eur', 'bookings', 'events']

describe('report numeric boundaries', () => {
  test('blocks exports when valid individual account amounts overflow the combined cent range', () => {
    const files = [year('haupt', 'Hauptkonto', [booking('big', Number.MAX_SAFE_INTEGER - 10, 'einnahme', '2026-01-10', 1)]),
      year('zweit', 'Nebenkonto', [booking('small', 20, 'einnahme', '2026-01-10', 1)])].map((file) => ({ ...file, openingBalance: 0 }))
    const organization = { ...organizationDefaults(files), assignments: Object.fromEntries(files.flatMap((file) => file.bookings.map((item) =>
      [bookingKey({ konto: file.konto!, year: file.year, bookingId: item.id }), makeAssignment(item, [{ area: 'I', amount: item.amount }])]))),
    }
    const report = buildOrganizationReport(files, organization, PERIOD)
    expect(report.openCount).toBe(0)
    expect(report.issues.join(' ')).toContain('sicheren Cent-Zahlenbereich')
    for (const kind of KINDS) expect(canExportOrganizationReport(report, kind)).toBe(false)
  })

  test('legacy zero-cent entries are neutral and do not require an impossible allocation', () => {
    const file = year('haupt', 'Hauptkonto', [booking('zero', 0, 'einnahme', '2026-01-10', 1)])
    const report = buildOrganizationReport([file], organizationDefaults([file]), PERIOD)
    expect(report.openCount).toBe(0)
    expect(report.income).toBe(0)
    expect(report.bookings).toHaveLength(1)
    expect(canExportOrganizationReport(report, 'eur')).toBe(true)
  })
})

function booking(id: string, amount: number, type: Booking['type'], date: string, seq: number, subcategory?: string): Booking {
  return {
    id, amount, type, date, seq, categoryId: 'event', description: `Buchung ${id}`,
    isUmsatz: true, nonUmsatzAmount: 0, source: 'manuell', note: '', refNo: seq,
    ...(subcategory ? { subcategory } : {}),
  }
}

function year(konto: string, name: string, bookings: Booking[]): YearFile {
  return {
    schemaVersion: 1, year: 2026, konto, kontoName: name, openingBalance: 100_000,
    clubName: 'Testverein', treasurerName: 'Erika Muster', fiscalStartMonth: 1,
    categories: [{ id: 'event', name: 'Jugendfahrt', code: 'J', sortOrder: 1, active: true }], bookings,
  }
}

function fixture(period = PERIOD): { files: YearFile[]; organization: OrganizationConfig; report: OrganizationReport } {
  const files = [
    year('haupt', 'Hauptkonto', [
      booking('income-1', 120_001, 'einnahme', '2026-01-10', 1, 'Teilnahme'),
      booking('income-2', 30_000, 'einnahme', '2026-02-10', 2, 'Teilnahme'),
      booking('split', 10_001, 'ausgabe', '2026-03-20', 3, 'Ausstattung'),
      booking('open', 2_500, 'ausgabe', '2026-04-10', 4),
      booking('interest', 500, 'einnahme', '2026-06-30', 5, 'Zinsen'),
      booking('transfer-out', 20_000, 'ausgabe', '2026-05-01', 6, 'Eigenübertrag'),
    ]),
    year('zweit', 'Nebenkonto', [
      booking('income-1', 1_000, 'einnahme', '2026-03-21', 1, 'Teilnahme'),
      booking('expense', 500, 'ausgabe', '2026-04-15', 2, 'Ausstattung'),
      booking('transfer-in', 20_000, 'einnahme', '2026-05-01', 3, 'Eigenübertrag'),
    ]),
  ]
  const defaults = organizationDefaults(files)
  const allocations: Record<string, ActivityAllocation[]> = {
    'haupt:income-1': [{ area: 'Z', amount: 120_001 }],
    'haupt:income-2': [{ area: 'Z', amount: 30_000 }],
    'haupt:split': [{ area: 'Z', amount: 6_001 }, { area: 'W', amount: 4_000 }],
    'haupt:interest': [{ area: 'V', amount: 500 }],
    'zweit:income-1': [{ area: 'I', amount: 1_000 }],
    'zweit:expense': [{ area: 'W', amount: 500 }],
  }
  const assignments = files.reduce<Record<string, OrganizationAssignment>>((result, file) =>
    file.bookings.reduce((previous, item) => {
      const parts = allocations[`${file.konto}:${item.id}`]
      return parts ? { ...previous,
        [bookingKey({ konto: file.konto!, year: file.year, bookingId: item.id })]: makeAssignment(item, parts),
      } : previous
    }, result), {})
  const organization: OrganizationConfig = { ...defaults, assignments,
    transfers: [createTransfer(files,
      { konto: 'haupt', year: 2026, bookingId: 'transfer-out' },
      { konto: 'zweit', year: 2026, bookingId: 'transfer-in' })],
  }
  return { files, organization, report: buildOrganizationReport(files, organization, period) }
}

function completeFixture(period = PERIOD) {
  const { files, organization } = fixture(period)
  const item = files[0].bookings.find((entry) => entry.id === 'open')!
  const complete = { ...organization, assignments: { ...organization.assignments,
    [bookingKey({ konto: 'haupt', year: 2026, bookingId: item.id })]: makeAssignment(item, [{ area: 'I', amount: item.amount }]),
  } }
  return { files, organization: complete, report: buildOrganizationReport(files, complete, period) }
}

function csvRows(csv: string): string[][] {
  return csv.replace(/^\ufeff/, '').trimEnd().split('\r\n').map((line) => splitCsvLine(line, ';'))
}

function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0) }

describe('organizationReportRows', () => {
  test('keeps identical category and booking IDs from different accounts separate', () => {
    const { report } = fixture()
    const rows = organizationReportRows(report)
    const participation = rows.filter((row) => row.kind === 'income' && row.position === 'Teilnahme')
    expect(participation).toHaveLength(2)
    expect(participation.find((row) => row.konto === 'haupt')).toMatchObject({ amount: 150_001, count: 2, amounts: { Z: 150_001, I: 0 } })
    expect(participation.find((row) => row.konto === 'zweit')).toMatchObject({ amount: 1_000, count: 1, amounts: { I: 1_000, Z: 0 } })
  })

  test('reconciles every row and the report to the cent with mixed splits and open amounts', () => {
    const { report } = fixture()
    const rows = organizationReportRows(report)
    for (const row of rows) expect(sum(Object.values(row.amounts))).toBe(row.amount)
    expect(sum(rows.filter((row) => row.kind === 'income').map((row) => row.amount))).toBe(151_501)
    expect(sum(rows.filter((row) => row.kind === 'expense').map((row) => row.amount))).toBe(13_001)
    expect(report.result).toBe(138_500)
    expect(rows.find((row) => row.konto === 'haupt' && row.position === 'Ausstattung')?.amounts).toEqual({ I: 0, V: 0, Z: 6_001, W: 4_000, open: 0 })
    expect(rows.find((row) => row.position === 'Allgemein')?.amounts.open).toBe(2_500)
    expect(sum(report.areas.map((area) => area.result)) + report.unassignedIncome - report.unassignedExpenses).toBe(report.result)
  })

  test('omits linked internal transfers from operating rows without removing the underlying bookings', () => {
    const { report } = fixture()
    expect(report.bookings.filter((entry) => entry.transferId)).toHaveLength(2)
    expect(report.transferCount).toBe(1)
    expect(organizationReportRows(report).some((row) => row.position === 'Eigenübertrag')).toBe(false)
  })

  test('shows an outdated assignment as open and never exports its old allocation', () => {
    const { files, organization } = fixture()
    const changed = files.map((file) => file.konto !== 'haupt' ? file : {
      ...file, bookings: file.bookings.map((item) => item.id !== 'income-1' ? item : { ...item, amount: 120_002 }),
    })
    const report = buildOrganizationReport(changed, organization, PERIOD)
    const row = organizationReportRows(report).find((item) => item.konto === 'haupt' && item.position === 'Teilnahme')!
    expect(row.amounts.Z).toBe(30_000)
    expect(row.amounts.open).toBe(120_002)
    expect(row.amount).toBe(150_002)
  })

  test('does not mutate reports or retained allocation arrays', () => {
    const { report, organization } = fixture()
    const snapshot = JSON.stringify({ report, organization })
    organizationReportRows(report)
    for (const kind of KINDS) {
      buildOrganizationReportHtml(report, organization, undefined, kind)
      organizationReportToCsv(report, organization, kind)
    }
    expect(JSON.stringify({ report, organization })).toBe(snapshot)
  })
})

describe('canExportOrganizationReport', () => {
  test('blocks EÜR PDF and CSV for open or outdated assignments, while retaining other reports', () => {
    const { files, organization, report } = fixture()
    expect(canExportOrganizationReport(report, 'eur')).toBe(false)
    for (const kind of ['bookings', 'events'] as const) expect(canExportOrganizationReport(report, kind)).toBe(true)
    const complete = completeFixture()
    expect(canExportOrganizationReport(complete.report, 'eur')).toBe(true)
    const changed = files.map((file) => ({ ...file, bookings: file.bookings.map((item) =>
      item.id === 'income-1' && file.konto === 'haupt' ? { ...item, amount: item.amount + 1 } : item) }))
    const outdated = buildOrganizationReport(changed, organization, PERIOD)
    expect(outdated.openCount).toBeGreaterThan(report.openCount)
    expect(canExportOrganizationReport(outdated, 'eur')).toBe(false)
  })

  test.each(KINDS)('requires at least one account for %s', (kind) => {
    const { report } = completeFixture({ ...PERIOD, kontos: [] })
    expect(canExportOrganizationReport(report, kind)).toBe(false)
  })

  test('uses the selected period and accounts without blocking on unrelated data issues', () => {
    const { report } = fixture({ ...PERIOD, kontos: ['zweit'] })
    expect(report.openCount).toBe(0)
    expect(canExportOrganizationReport(report, 'eur')).toBe(true)
    expect(canExportOrganizationReport({ ...report, issues: ['Hinweis zu einem anderen Kassenjahr'] }, 'eur')).toBe(true)
    for (const kind of ['bookings', 'events'] as const) {
      expect(canExportOrganizationReport({ ...report, issues: ['Fehlendes Kassenjahr'] }, kind)).toBe(true)
    }
  })
})

describe('buildOrganizationReportHtml', () => {
  test.each(KINDS)('uses a fixed title and includes explicit scope for %s', (kind) => {
    const { report, organization } = fixture()
    const html = buildOrganizationReportHtml(report, organization, undefined, kind)
    expect(html).toContain(`<title>${ORGANIZATION_REPORT_TITLES[kind]}</title>`)
    expect(html).toContain(`<h1>${ORGANIZATION_REPORT_TITLES[kind]}</h1>`)
    expect(html).toContain('01.01.2026 bis 31.12.2026')
    if (kind !== 'eur') expect(html).toContain('Hauptkonto, Nebenkonto')
    else expect(html).not.toMatch(/Hauptkonto|Nebenkonto/)
    expect(html).toContain('Erika Muster')
    if (kind !== 'eur') expect(html).toMatch(/Vorläufig · 1 Zuordnung(?:en)? offen/)
    else expect(html).not.toMatch(/Vorläufig|Zuordnung vollständig|Zuordnung unvollständig|Offene Zuordnungen|Noch zuzuordnen/)
    expect(html).toContain(formatEur(report.result))
    expect(html).toContain('display:table-header-group')
    expect(html).toContain('color-scheme:light')
  })

  test('contains four areas and all reconciliation totals without open-assignment annotations in the EÜR', () => {
    const { report, organization } = fixture()
    const html = buildOrganizationReportHtml(report, organization)
    for (const title of ['Ideeller Bereich', 'Vermögensverwaltung', 'Zweckbetrieb', 'Wirtschaftlicher Geschäftsbetrieb']) expect(html).toContain(title)
    expect(html).toContain('Einnahmen gesamt')
    expect(html).toContain('Ausgaben gesamt')
    expect(html).toContain(formatEur(151_501))
    expect(html).toContain(formatEur(-13_001))
    expect(html).toContain(formatEur(138_500))
    expect(html).toContain(formatEur(-2_500))
    expect(html).toContain(formatEur(-6_001))
    expect(html).toContain(formatEur(-4_500))
    expect(html).not.toMatch(/Noch zuzuordnen|Offene Zuordnungen|Zuordnung vollständig|Vorläufig/)
  })

  test('omits account names and assignment status even when all external bookings are assigned', () => {
    const { report, organization } = completeFixture()
    const html = buildOrganizationReportHtml(report, organization)
    expect(html).not.toMatch(/Hauptkonto|Nebenkonto|Zuordnung vollständig|Zuordnung unvollständig|Vorläufig|Noch zuzuordnen|Offene Zuordnungen/)
    expect(html).toContain(formatEur(138_500))
  })

  test('merges identical category names and positions across accounts without changing split amounts', () => {
    const { report, organization } = completeFixture()
    const changedIds = { ...report, bookings: report.bookings.map((entry) => entry.reference.konto !== 'zweit' ? entry : {
      ...entry, booking: { ...entry.booking, categoryId: 'different-id-same-name' },
    }) }
    const html = buildOrganizationReportHtml(changedIds, organization)
    expect(html.match(/<td>Teilnahme<\/td>/g)).toHaveLength(1)
    expect(html.match(/<td>Ausstattung<\/td>/g)).toHaveLength(1)
    expect(html).toContain(formatEur(151_001))
    expect(html).toContain(formatEur(-6_001))
    expect(html).toContain(formatEur(-4_500))
    expect(html).toContain(formatEur(-10_501))
    expect(html).not.toMatch(/Hauptkonto|Nebenkonto/)
  })

  test('retains transfers in the booking listing and combines event income and expenses', () => {
    const { report, organization } = fixture()
    const bookings = buildOrganizationReportHtml(report, organization, undefined, 'bookings')
    expect(bookings).toContain('Buchung transfer-out')
    expect(bookings).toContain('Buchung transfer-in')
    expect(bookings).toContain('Interne Umbuchung')
    expect(bookings).toContain(`Zweckbetrieb: ${formatEur(6_001)}`)
    expect(bookings).toContain(`Wirtschaftlicher Geschäftsbetrieb: ${formatEur(4_000)}`)
    const events = buildOrganizationReportHtml(report, organization, undefined, 'events')
    expect(events).toContain('<th>Unterkategorie</th>')
    expect(events).toContain('<th class="num">Ergebnis</th>')
    expect(events).toContain(formatEur(-13_001))
    expect(events).not.toContain('Eigenübertrag')
  })

  test.each(KINDS)('escapes arbitrary HTML in names, categories, booking text and issues for %s', (kind) => {
    const { report, organization } = fixture()
    const payload = '<script>alert("x")</script> & \'Name\''
    const escaped = '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Name&#39;'
    const unsafe: OrganizationReport = { ...report,
      accounts: report.accounts.map((account) => ({ ...account, name: payload })),
      issues: [payload],
      bookings: report.bookings.map((entry) => ({ ...entry, kontoName: payload,
        booking: { ...entry.booking, categoryName: payload, name: payload, description: payload, subcategory: payload } })),
    }
    const html = buildOrganizationReportHtml(unsafe, { ...organization, name: payload, treasurerName: payload }, undefined, kind)
    expect(html).toContain(escaped)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain(payload)
    if (kind !== 'eur') expect(html).toContain('Datengrundlage prüfen')
    expect(html).toContain('<h2>Hinweise zur Datengrundlage</h2>')
  })

  test('allows bounded raster data logos and rejects remote, executable or oversized logo values', () => {
    const { report, organization } = fixture()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    expect(buildOrganizationReportHtml(report, organization, png)).toContain(`<img class="logo" src="${png}" alt="Vereinslogo">`)
    for (const invalid of [null, '', 'https://example.com/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA" onerror="alert(1)', `data:image/png;base64,${'A'.repeat(8_000_001)}`]) {
      expect(buildOrganizationReportHtml(report, organization, invalid)).not.toContain('<img')
    }
  })

  test.each(KINDS)('renders an empty selected scope for %s without inventing accounts or movements', (kind) => {
    const { report, organization } = fixture({ ...PERIOD, kontos: [] })
    const html = buildOrganizationReportHtml(report, { ...organization, name: '', treasurerName: '' }, null, kind)
    if (kind !== 'eur') expect(html).toContain('Keine Konten ausgewählt')
    else expect(html).not.toContain('Keine Konten ausgewählt')
    expect(html).toContain('Keine Buchungen im gewählten Zeitraum.')
    expect(html).toContain('<div class="club">Verein</div>')
    expect(html).not.toContain('Buchung income-1')
  })
})

describe('organizationReportToCsv', () => {
  test.each(KINDS)('includes period, accounts and fixed report title for %s', (kind) => {
    const { report, organization } = fixture()
    const csv = organizationReportToCsv(report, organization, kind)
    expect(csv.startsWith('\ufeff')).toBe(true)
    const rows = csvRows(csv)
    expect(rows.find((row) => row[0] === 'Bericht')).toEqual(['Bericht', ORGANIZATION_REPORT_TITLES[kind]])
    expect(rows.find((row) => row[0] === 'Verein')).toEqual(['Verein', 'Testverein'])
    expect(rows.find((row) => row[0] === 'Zeitraum')).toEqual(['Zeitraum', '01.01.2026', '31.12.2026'])
    if (kind !== 'eur') expect(rows.find((row) => row[0] === 'Konten')).toEqual(['Konten', 'Hauptkonto', 'Nebenkonto'])
    else expect(csv).not.toMatch(/Hauptkonto|Nebenkonto|Status|Noch zuzuordnen|Offene Zuordnungen|Vorläufig/)
    expect(rows.find((row) => row[0] === 'Kassenführung')).toEqual(['Kassenführung', 'Erika Muster'])
  })

  test('reconciles consolidated EÜR area columns and negative expense cells', () => {
    const { report, organization } = completeFixture()
    const rows = csvRows(organizationReportToCsv(report, organization, 'eur'))
    const movements = rows.filter((row) => row[0] === 'Einnahme' || row[0] === 'Ausgabe')
    for (const row of movements) {
      expect(row).toHaveLength(9)
      const parts = row.slice(4, 8).map((value) => parseAmountToCents(value)!)
      expect(sum(parts)).toBe(parseAmountToCents(row[8]))
    }
    expect(sum(movements.map((row) => parseAmountToCents(row[8])!))).toBe(138_500)
    expect(rows.find((row) => row[0] === 'Einnahmen gesamt')?.at(-1)).toBe('1.515,01')
    expect(rows.find((row) => row[0] === 'Ausgaben gesamt')?.at(-1)).toBe('-130,01')
    expect(rows.find((row) => row[0] === 'Überschuss / Fehlbetrag')?.at(-1)).toBe('1.385,00')
    expect(movements.some((row) => row[2] === 'Eigenübertrag')).toBe(false)
    const participation = movements.filter((row) => row[0] === 'Einnahme' && row[2] === 'Teilnahme')
    expect(participation).toHaveLength(1)
    expect(participation[0]).toEqual(['Einnahme', 'Jugendfahrt', 'Teilnahme', '3', '10,00', '0,00', '1.500,01', '0,00', '1.510,01'])
    const equipment = movements.filter((row) => row[0] === 'Ausgabe' && row[2] === 'Ausstattung')
    expect(equipment).toHaveLength(1)
    expect(equipment[0].slice(4)).toEqual(['0,00', '0,00', '-60,01', '-45,00', '-105,01'])
    expect(rows.find((row) => row[0] === 'Interne Umbuchungen')?.slice(1)).toEqual(['1', '200,00'])
  })

  test('reconciles event CSV income, negative expenses and result by event and in total', () => {
    const { report, organization } = fixture()
    const rows = csvRows(organizationReportToCsv(report, organization, 'events'))
    expect(rows.find((row) => row[0] === 'Konto')).toEqual([
      'Konto', 'Veranstaltung', 'Unterkategorie', 'Buchungen', 'Einnahmen (€)', 'Ausgaben (€)', 'Ergebnis (€)',
    ])
    const movements = rows.filter((row) => row.length === 7 && ['Hauptkonto', 'Nebenkonto'].includes(row[0]))
    expect(movements.length).toBeGreaterThan(0)
    for (const row of movements) {
      const income = parseAmountToCents(row[4])!
      const expenses = parseAmountToCents(row[5])!
      expect(income).toBeGreaterThanOrEqual(0)
      expect(expenses).toBeLessThanOrEqual(0)
      expect(income + expenses).toBe(parseAmountToCents(row[6]))
    }
    expect(sum(movements.map((row) => parseAmountToCents(row[4])!))).toBe(report.income)
    expect(sum(movements.map((row) => parseAmountToCents(row[5])!))).toBe(-report.expenses)
    expect(sum(movements.map((row) => parseAmountToCents(row[6])!))).toBe(report.result)
    expect(sum(movements.map((row) => Number(row[3])))).toBe(7)
    expect(rows.find((row) => row[0] === 'Gesamt')?.slice(4)).toEqual(['1.515,01', '-130,01', '1.385,00'])
    expect(movements.some((row) => row[2] === 'Eigenübertrag')).toBe(false)
    expect(rows.find((row) => row[0] === 'Interne Umbuchungen')?.slice(1)).toEqual(['1', '200,00'])
  })

  test('keeps original transfer rows and mixed allocations in the booking CSV', () => {
    const { report, organization } = fixture()
    const rows = csvRows(organizationReportToCsv(report, organization, 'bookings'))
    const transferRows = rows.filter((row) => row[9] === 'Ja')
    expect(transferRows).toHaveLength(2)
    expect(transferRows.map((row) => parseAmountToCents(row[8])).sort((a, b) => a! - b!)).toEqual([-20_000, 20_000])
    const split = rows.find((row) => row[6] === 'Buchung split')!
    expect(split[7]).toContain(`Zweckbetrieb: ${formatEur(6_001)}`)
    expect(split[7]).toContain(`Wirtschaftlicher Geschäftsbetrieb: ${formatEur(4_000)}`)
    expect(split[8]).toBe('-100,01')
  })

  test.each(KINDS)('protects user text from spreadsheet formula evaluation for %s', (kind) => {
    const { report, organization } = fixture()
    const unsafe = { ...report, accounts: report.accounts.map((account) => ({ ...account, name: '@SUM(1)' })),
      issues: ['=1+1'],
      bookings: report.bookings.map((entry) => ({ ...entry, kontoName: '+SUM(1)', booking: { ...entry.booking,
        categoryName: '=HYPERLINK("https://example.com")', subcategory: ' \t-1+2', name: '@SUM(1)', description: '+SUM(2)',
      } })),
    }
    const csv = organizationReportToCsv(unsafe, { ...organization, name: '=1+1', treasurerName: '\t@SUM(2)' }, kind)
    expect(csv).toContain('"Verein";"\'=1+1"')
    if (kind !== 'eur') {
      expect(csv).toContain('"\'@SUM(1)"')
      expect(csv).toContain('"\'+SUM(1)"')
    }
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"')
    expect(csv).toContain(kind === 'bookings' ? '"\' \t-1+2"' : '"\'-1+2"')
    expect(csv).toContain('"Kassenführung";"\'\t@SUM(2)"')
    expect(csv).toContain('"Hinweis";"\'=1+1"')
    const numericExpense = kind === 'bookings' ? '-100,01' : '-130,01'
    expect(csv).not.toContain(`"'${numericExpense}"`)
    expect(csv).toContain(`"${numericExpense}"`)
  })

  test('retains quoted names with delimiters and line breaks', () => {
    const { report, organization } = fixture()
    const csv = organizationReportToCsv(report, { ...organization, name: 'Verein; "Beispiel"\nAbteilung' })
    expect(csv).toContain('"Verein";"Verein; ""Beispiel""\nAbteilung"')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  test.each(KINDS)('uses the selected period/account scope and still neutralizes a hidden counteraccount for %s', (kind) => {
    const { report, organization } = fixture({ from: '2026-04-01', to: '2026-06-30', kontos: ['haupt'] })
    expect(report.income).toBe(500)
    expect(report.expenses).toBe(2_500)
    expect(report.transferCount).toBe(1)
    const csv = organizationReportToCsv(report, organization, kind)
    const rows = csvRows(csv)
    if (kind !== 'eur') expect(rows.find((row) => row[0] === 'Konten')).toEqual(['Konten', 'Hauptkonto'])
    else expect(rows.find((row) => row[0] === 'Konten')).toBeUndefined()
    expect(rows.find((row) => row[0] === 'Zeitraum')).toEqual(['Zeitraum', '01.04.2026', '30.06.2026'])
    expect(csv).not.toContain('Nebenkonto')
    const html = buildOrganizationReportHtml(report, organization, null, kind)
    expect(html).not.toContain('Nebenkonto')
    expect(html).toContain(formatEur(-2_000))
  })

  test('returns metadata and zero totals for an empty selected scope', () => {
    const { report, organization } = fixture({ ...PERIOD, kontos: [] })
    const rows = csvRows(organizationReportToCsv(report, organization))
    expect(rows.find((row) => row[0] === 'Konten')).toBeUndefined()
    expect(rows.find((row) => row[0] === 'Einnahmen gesamt')?.at(-1)).toBe('0,00')
    expect(rows.filter((row) => row[0] === 'Einnahme' || row[0] === 'Ausgabe')).toHaveLength(0)
  })
})
