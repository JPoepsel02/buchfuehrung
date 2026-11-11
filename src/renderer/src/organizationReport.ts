import { AREA_DEFINITIONS } from '@shared/organization'
import type { ActivityAreaId, OrganizationBooking, OrganizationConfig, OrganizationReport } from '@shared/organization'
import { formatAmount, formatDate, formatEur } from '@shared/money'

export type OrganizationReportKind = 'eur' | 'bookings' | 'events'

export const ORGANIZATION_REPORT_TITLES: Record<OrganizationReportKind, string> = {
  eur: 'Einnahmenüberschussrechnung (EÜR)',
  bookings: 'Buchungsübersicht',
  events: 'Veranstaltungsauswertung',
}

type ReportColumn = ActivityAreaId | 'open'

export interface OrganizationReportRow {
  kind: 'income' | 'expense'
  konto: string
  kontoName: string
  categoryId: string
  categoryName: string
  position: string
  amounts: Record<ReportColumn, number>
  amount: number
  count: number
}

type EurReportRow = Omit<OrganizationReportRow, 'konto' | 'kontoName' | 'categoryId'>

const blankAmounts = (): Record<ReportColumn, number> => ({ I: 0, V: 0, Z: 0, W: 0, open: 0 })
const areaName = (id: ActivityAreaId) => AREA_DEFINITIONS.find((area) => area.id === id)?.name ?? id
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

function status(report: OrganizationReport): string {
  if (report.issues.length > 0) return 'Datengrundlage prüfen'
  return report.openCount > 0 ? `Vorläufig · ${report.openCount} Zuordnungen offen` : 'Zuordnung vollständig'
}

function accountNames(report: OrganizationReport): string {
  return report.accounts.map((account) => account.name).join(', ') || 'Keine Konten ausgewählt'
}

export function canExportOrganizationReport(report: OrganizationReport, kind: OrganizationReportKind): boolean {
  const numbers = [report.income, report.expenses, report.result, report.unassignedIncome, report.unassignedExpenses,
    report.transferVolume, ...report.areas.flatMap((area) => [area.income, area.expenses, area.result]),
    ...report.accounts.flatMap((account) => [account.income, account.expenses, account.result])]
  return report.accounts.length > 0 && numbers.every(Number.isSafeInteger) && (kind !== 'eur' || report.openCount === 0)
}

function amountsFor(entry: OrganizationBooking): Record<ReportColumn, number> {
  if (entry.status !== 'assigned') return { ...blankAmounts(), open: entry.booking.amount }
  return entry.allocations.reduce((amounts, allocation) => ({
    ...amounts, [allocation.area]: amounts[allocation.area] + allocation.amount,
  }), blankAmounts())
}

export function organizationReportRows(report: OrganizationReport): OrganizationReportRow[] {
  return report.bookings.filter((entry) => !entry.transferId).reduce<OrganizationReportRow[]>((rows, entry) => {
    const kind = entry.booking.type === 'einnahme' ? 'income' : 'expense'
    const position = entry.booking.subcategory?.trim() || 'Allgemein'
    const amounts = amountsFor(entry)
    const existing = rows.find((row) => row.kind === kind && row.konto === entry.reference.konto
      && row.categoryId === entry.booking.categoryId && row.position === position)
    if (!existing) return [...rows, {
      kind, konto: entry.reference.konto, kontoName: entry.kontoName,
      categoryId: entry.booking.categoryId, categoryName: entry.booking.categoryName,
      position, amounts, amount: entry.booking.amount, count: 1,
    }]
    return rows.map((row) => row !== existing ? row : {
      ...row, count: row.count + 1, amount: row.amount + entry.booking.amount,
      amounts: Object.fromEntries(Object.entries(amounts).map(([area, amount]) => [area, row.amounts[area as ReportColumn] + amount])) as Record<ReportColumn, number>,
    })
  }, []).sort((left, right) => left.kontoName.localeCompare(right.kontoName, 'de')
    || left.categoryName.localeCompare(right.categoryName, 'de') || left.position.localeCompare(right.position, 'de'))
}

function eurRows(report: OrganizationReport): EurReportRow[] {
  return organizationReportRows(report).reduce<EurReportRow[]>((rows, row) => {
    const existing = rows.find((entry) => entry.kind === row.kind
      && entry.categoryName === row.categoryName && entry.position === row.position)
    if (!existing) return [...rows, { kind: row.kind, categoryName: row.categoryName, position: row.position,
      amounts: { ...row.amounts }, amount: row.amount, count: row.count }]
    return rows.map((entry) => entry !== existing ? entry : {
      ...entry, amount: entry.amount + row.amount, count: entry.count + row.count,
      amounts: Object.fromEntries(Object.entries(row.amounts).map(([area, amount]) => [area, entry.amounts[area as ReportColumn] + amount])) as Record<ReportColumn, number>,
    })
  }, []).sort((left, right) => left.categoryName.localeCompare(right.categoryName, 'de')
    || left.position.localeCompare(right.position, 'de'))
}

function areaTotal(report: OrganizationReport, column: ActivityAreaId, kind: 'income' | 'expenses' | 'result'): number {
  return report.areas.find((area) => area.area === column)?.[kind] ?? 0
}

function numericCell(amount: number, showZero = false): string {
  return `<td class="num">${amount !== 0 || showZero ? esc(formatEur(amount)) : '—'}</td>`
}

function eurTable(report: OrganizationReport): string {
  const rows = eurRows(report)
  const visibleColumns = AREA_DEFINITIONS.map((area) => area.id)
  const head = `<thead><tr><th scope="col">Veranstaltung / Unterkategorie</th>${visibleColumns.map((column) => `<th scope="col" class="num">${esc(areaName(column))}</th>`).join('')}<th scope="col" class="num">Gesamt</th></tr></thead>`
  const parts = (['income', 'expense'] as const).map((kind) => {
    const selected = rows.filter((row) => row.kind === kind)
    const groups = [...new Set(selected.map((row) => row.categoryName))]
    const sign = kind === 'income' ? 1 : -1
    return `<tbody><tr class="section"><th colspan="${visibleColumns.length + 2}">${kind === 'income' ? 'Einnahmen' : 'Ausgaben'}</th></tr></tbody>${groups.map((group) => {
      const groupRows = selected.filter((row) => row.categoryName === group)
      const first = groupRows[0]
      return `<tbody class="report-group"><tr class="group"><th colspan="${visibleColumns.length + 2}">${esc(first.categoryName)}</th></tr>${groupRows.map((row) => `<tr><td>${esc(row.position)}</td>${visibleColumns.map((column) => numericCell(sign * row.amounts[column])).join('')}${numericCell(sign * row.amount)}</tr>`).join('')}</tbody>`
    }).join('')}<tbody><tr class="total"><th>${kind === 'income' ? 'Einnahmen' : 'Ausgaben'} gesamt</th>${visibleColumns.map((column) => numericCell(sign * areaTotal(report, column, kind === 'income' ? 'income' : 'expenses'), true)).join('')}${numericCell(sign * (kind === 'income' ? report.income : report.expenses), true)}</tr></tbody>`
  }).join('')
  const result = `<tbody><tr class="result"><th>Überschuss / Fehlbetrag</th>${visibleColumns.map((column) => numericCell(areaTotal(report, column, 'result'), true)).join('')}${numericCell(report.result, true)}</tr></tbody>`
  return `<table class="eur">${head}${parts}${result}</table>`
}

function allocationLabel(entry: OrganizationBooking): string {
  if (entry.transferId) return 'Interne Umbuchung'
  if (entry.status !== 'assigned') return 'Noch zuzuordnen'
  return entry.allocations.map((allocation) => `${areaName(allocation.area)}${entry.allocations.length > 1 ? `: ${formatEur(allocation.amount)}` : ''}`).join(' · ')
}

function bookingTable(report: OrganizationReport): string {
  const rows = [...report.bookings].sort((left, right) => left.booking.date.localeCompare(right.booking.date)
    || left.kontoName.localeCompare(right.kontoName, 'de') || left.booking.seq - right.booking.seq)
  return `<table><thead><tr><th>Datum</th><th>Konto</th><th>Beleg-Nr.</th><th>Veranstaltung</th><th>Name / Verwendungszweck</th><th>Tätigkeitsbereich</th><th class="num">Betrag</th></tr></thead><tbody>${rows.map((entry) => `<tr><td class="nowrap">${esc(formatDate(entry.booking.date))}</td><td>${esc(entry.kontoName)}</td><td>${esc(entry.booking.ref)}</td><td>${esc(entry.booking.categoryName)}${entry.booking.subcategory ? `<br><small>${esc(entry.booking.subcategory)}</small>` : ''}</td><td>${entry.booking.name?.trim() ? `${esc(entry.booking.name)}<br>` : ''}${esc(entry.booking.description)}</td><td>${esc(allocationLabel(entry))}</td>${numericCell(entry.booking.signedAmount, true)}</tr>`).join('')}</tbody></table>`
}

function eventGroups(report: OrganizationReport) {
  return organizationReportRows(report).reduce<Array<{ konto: string; name: string; categoryId: string; categoryName: string; position: string; income: number; expenses: number; count: number }>>((result, row) => {
    const existing = result.find((group) => group.konto === row.konto && group.categoryId === row.categoryId && group.position === row.position)
    if (!existing) return [...result, { konto: row.konto, name: row.kontoName, categoryId: row.categoryId,
      categoryName: row.categoryName, position: row.position, income: row.kind === 'income' ? row.amount : 0,
      expenses: row.kind === 'expense' ? row.amount : 0, count: row.count }]
    return result.map((group) => group !== existing ? group : { ...group,
      income: group.income + (row.kind === 'income' ? row.amount : 0),
      expenses: group.expenses + (row.kind === 'expense' ? row.amount : 0), count: group.count + row.count })
  }, [])
}

function eventTable(report: OrganizationReport): string {
  const groups = eventGroups(report)
  return `<table><thead><tr><th>Konto</th><th>Veranstaltung</th><th>Unterkategorie</th><th class="num">Buchungen</th><th class="num">Einnahmen</th><th class="num">Ausgaben</th><th class="num">Ergebnis</th></tr></thead><tbody>${groups.map((group) => `<tr><td>${esc(group.name)}</td><td>${esc(group.categoryName)}</td><td>${esc(group.position)}</td><td class="num">${group.count}</td>${numericCell(group.income, true)}${numericCell(-group.expenses, true)}${numericCell(group.income - group.expenses, true)}</tr>`).join('')}<tr class="result"><th colspan="4">Gesamt</th>${numericCell(report.income, true)}${numericCell(-report.expenses, true)}${numericCell(report.result, true)}</tr></tbody></table>`
}

function safeLogo(logo: string | null | undefined): string {
  return logo && logo.length <= 8_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)
    ? `<img class="logo" src="${logo}" alt="Vereinslogo">` : ''
}

export function buildOrganizationReportHtml(
  report: OrganizationReport,
  organization: Pick<OrganizationConfig, 'name' | 'treasurerName'>,
  logoDataUrl?: string | null,
  kind: OrganizationReportKind = 'eur',
): string {
  const title = ORGANIZATION_REPORT_TITLES[kind]
  const body = kind === 'eur' ? eurTable(report) : kind === 'bookings' ? bookingTable(report) : eventTable(report)
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${title}</title><style>
@page{size:A4 landscape;margin:14mm}*{box-sizing:border-box}html{background:#fff;color:#202b33;color-scheme:light}body{margin:0;font:10pt/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:22px}h1{font-size:21pt;line-height:1.2;letter-spacing:-.5pt;margin:5px 0 10px}h2{font-size:11pt;margin:0 0 9px}.club{font-size:10pt;font-weight:650}.meta{font-size:9pt;color:#52616d;margin:5px 0}.logo{max-width:75px;max-height:65px;object-fit:contain}table{width:100%;border-collapse:collapse;font-size:9pt;table-layout:auto}thead{display:table-header-group}th,td{padding:7px 8px;border-bottom:1px solid #dce2e6;text-align:left;vertical-align:top}thead th{background:#f1f3f5;color:#4b5965;font-size:8pt;font-weight:600}tr{break-inside:avoid}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}thead .num{white-space:normal;hyphens:auto;overflow-wrap:anywhere}.nowrap{white-space:nowrap}.section th{background:#e5f1eb;color:#215b49;font-weight:700;padding-top:10px;padding-bottom:10px}.group{break-after:avoid}.group th{background:#f5f6f8;font-weight:650;font-size:9pt}.group span{color:#52616d;font-weight:400}.total th,.total td{background:#f1f3f5;font-weight:650}.result th,.result td{border-top:2px solid #253039;font-weight:700;padding-top:11px}.eur th:first-child{min-width:170px}.notes{margin:20px 0 0;font-size:9pt;color:#4b5965}.notes ul{padding-left:18px;margin:6px 0}.reconciliation{margin-top:20px;border-top:1px solid #dce2e6;padding-top:12px;display:grid;gap:5px;font-size:9pt}.reconciliation>div{display:flex;justify-content:space-between;gap:15px}.reconciliation strong{font-variant-numeric:tabular-nums}footer{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #dce2e6;margin-top:22px;padding-top:12px;font-size:8pt;color:#52616d}small{font-size:8pt;color:#52616d}@media screen{body{max-width:1350px;margin:0 auto;padding:30px}}@media print{header{margin-bottom:17px}th,td{padding:5px 6px}.eur{font-size:8pt}.eur thead th{font-size:8pt}footer{break-inside:avoid}.notes,.reconciliation{break-inside:avoid}}</style></head><body>
<header><div><div class="club">${esc(organization.name || 'Verein')}</div><h1>${title}</h1><p class="meta">${esc(formatDate(report.period.from))} bis ${esc(formatDate(report.period.to))}</p>${kind !== 'eur' ? `<p class="meta">${esc(accountNames(report))}</p><p class="meta">${esc(status(report))}</p>` : ''}</div>${safeLogo(logoDataUrl)}</header>
${report.bookings.length > 0 ? body : '<p>Keine Buchungen im gewählten Zeitraum.</p>'}
<section class="reconciliation" aria-label="Abstimmung"><div><span>Einnahmen</span><strong>${esc(formatEur(report.income))}</strong></div><div><span>Ausgaben</span><strong>${esc(formatEur(-report.expenses))}</strong></div><div><span>Überschuss / Fehlbetrag</span><strong>${esc(formatEur(report.result))}</strong></div><div><span>Interne Umbuchungen</span><span>${report.transferCount} Verknüpfungen · ${esc(formatEur(report.transferVolume))}</span></div></section>
${kind !== 'eur' && report.openCount > 0 ? `<section class="notes"><h2>Offene Zuordnungen</h2><p>${report.openCount} Buchungen: ${esc(formatEur(report.unassignedIncome))} Einnahmen und ${esc(formatEur(report.unassignedExpenses))} Ausgaben. Diese Beträge sind in den Gesamtsummen enthalten.</p></section>` : ''}
${report.issues.length > 0 ? `<section class="notes"><h2>Hinweise zur Datengrundlage</h2><ul>${report.issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul></section>` : ''}
${kind === 'bookings' && report.transferCount > 0 ? '<p class="notes">Interne Umbuchungen sind in der Buchungsübersicht sichtbar und zählen nicht zu den Einnahmen und Ausgaben des Vereins.</p>' : ''}
<footer><span>${esc(organization.name || 'Verein')} · ${title}</span><span>${esc(organization.treasurerName)}</span></footer></body></html>`
}

const textCell = (value: unknown): string => {
  const text = String(value ?? '')
  return /^[\s\u0000-\u001f\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text
}
const csvCell = (value: string | number): string => `"${String(value).replace(/"/g, '""')}"`
const numeric = (amount: number): string => formatAmount(amount)

export function organizationReportToCsv(
  report: OrganizationReport,
  organization: Pick<OrganizationConfig, 'name' | 'treasurerName'>,
  kind: OrganizationReportKind = 'eur',
): string {
  const metadata: Array<Array<string | number>> = [
    ['Bericht', ORGANIZATION_REPORT_TITLES[kind]], ['Verein', textCell(organization.name)],
    ['Zeitraum', formatDate(report.period.from), formatDate(report.period.to)],
    ...(kind !== 'eur' ? [['Konten', ...report.accounts.map((account) => textCell(account.name))], ['Status', status(report)]] : []), [],
  ]
  let rows: Array<Array<string | number>>
  if (kind === 'bookings') {
    rows = [['Datum', 'Konto', 'Beleg-Nr.', 'Veranstaltung', 'Unterkategorie', 'Name', 'Verwendungszweck', 'Tätigkeitsbereich', 'Betrag (€)', 'Interne Umbuchung'],
      ...[...report.bookings].sort((left, right) => left.booking.date.localeCompare(right.booking.date) || left.booking.seq - right.booking.seq).map((entry) => [
        formatDate(entry.booking.date), textCell(entry.kontoName), textCell(entry.booking.ref), textCell(entry.booking.categoryName), textCell(entry.booking.subcategory),
        textCell(entry.booking.name), textCell(entry.booking.description), textCell(allocationLabel(entry)), numeric(entry.booking.signedAmount), entry.transferId ? 'Ja' : 'Nein',
      ])]
  } else if (kind === 'events') {
    rows = [['Konto', 'Veranstaltung', 'Unterkategorie', 'Buchungen', 'Einnahmen (€)', 'Ausgaben (€)', 'Ergebnis (€)'],
      ...eventGroups(report).map((group) => [textCell(group.name), textCell(group.categoryName), textCell(group.position), group.count, numeric(group.income), numeric(-group.expenses), numeric(group.income - group.expenses)]),
      ['Gesamt', '', '', '', numeric(report.income), numeric(-report.expenses), numeric(report.result)],
    ]
  } else {
    rows = [['Art', 'Veranstaltung', 'Unterkategorie', 'Buchungen', ...AREA_DEFINITIONS.map((area) => `${area.name} (€)`), 'Gesamt (€)'],
      ...eurRows(report).map((row) => {
        const sign = row.kind === 'income' ? 1 : -1
        return [row.kind === 'income' ? 'Einnahme' : 'Ausgabe', textCell(row.categoryName), textCell(row.position), row.count,
          ...AREA_DEFINITIONS.map((area) => numeric(sign * row.amounts[area.id])), numeric(sign * row.amount)]
      }),
      ['Einnahmen gesamt', '', '', '', ...AREA_DEFINITIONS.map((area) => numeric(areaTotal(report, area.id, 'income'))), numeric(report.income)],
      ['Ausgaben gesamt', '', '', '', ...AREA_DEFINITIONS.map((area) => numeric(-areaTotal(report, area.id, 'expenses'))), numeric(-report.expenses)],
      ['Überschuss / Fehlbetrag', '', '', '', ...AREA_DEFINITIONS.map((area) => numeric(areaTotal(report, area.id, 'result'))), numeric(report.result)],
    ]
  }
  const ending: Array<Array<string | number>> = [[], ['Interne Umbuchungen', report.transferCount, numeric(report.transferVolume)],
    ...report.issues.map((issue) => ['Hinweis', textCell(issue)]), ['Kassenführung', textCell(organization.treasurerName)]]
  return '\ufeff' + [...metadata, ...rows, ...ending].map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n'
}
