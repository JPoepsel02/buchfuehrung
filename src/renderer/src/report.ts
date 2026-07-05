import { fiscalEndLabel, fiscalLabel, prevFiscalEndLabel } from '@shared/fiscal'
import { byCategory, chronological, eventRows, yearTotals } from '@shared/ledger'
import { MONTH_NAMES, formatAmount, formatDate, formatEur, monthOf } from '@shared/money'
import type { AuditInfo, YearFile } from '@shared/types'

/** Leere Angaben erscheinen im Druck als Schreiblinie. */
function val(v: string | undefined, width = 180): string {
  const s = (v ?? '').trim()
  return s ? esc(s) : `<span class="fill" style="min-width:${width}px"></span>`
}

function dateVal(v: string | undefined, fallbackYear: number, width = 110): string {
  const formatted = formatAuditDate(v, fallbackYear)
  return formatted ? esc(formatted) : `<span class="fill" style="min-width:${width}px"></span>`
}

/**
 * Erzeugt den druckfertigen Prüfbericht als eigenständiges HTML-Dokument
 * (A4). Enthält Abhak-Kästchen je Beleg sowie Unterschriftsfelder für die
 * Kassenprüfung.
 */
/**
 * Erzeugt Zusammenfassung, Chronologie und Veranstaltungs-Tabelle für EIN
 * Buch – wird für Haupt- und Zweitkonto identisch verwendet.
 */
function ledgerSections(file: YearFile, accountNo: number, accountLabel: string): string {
  const totals = yearTotals(file)
  const chrono = chronological(file)
  const groups = byCategory(file)

  const chronoRows = chrono
    .map(
      (r) => `
      <tr>
        <td class="nowrap">${formatDate(r.date)}</td>
        <td class="ref">${esc(r.ref)}</td>
        <td>${receiptCell(r.receiptAvailable === false ? 0 : 1, 1)}</td>
        <td>${esc((r.name ?? '').trim() || '–')}</td>
        <td>${esc(r.description)}</td>
        <td class="num">${r.type === 'ausgabe' ? formatAmount(r.amount) : ''}</td>
        <td class="num">${r.type === 'einnahme' ? formatAmount(r.amount) : ''}</td>
        <td class="num">${formatAmount(r.runningBalance)}</td>
      </tr>`,
    )
    .join('')

  const groupSections = groups
    .map(
      (g) => `
      <tr class="group-head"><td colspan="7">${esc(g.category.name)}</td></tr>
      ${eventRows(g)
        .map(
          (r) => `
        <tr>
          <td class="ref">${esc(r.refs)}</td>
          <td class="nowrap">${r.kind === 'einzeln' ? formatDate(r.date) : `${r.count} Buchungen`}</td>
          <td>${receiptCell(r.receiptAvailableCount, r.count)}</td>
          <td>${r.kind === 'unterkategorie' ? '' : esc(r.name || '–')}</td>
          <td>${esc(r.label)}</td>
          <td class="num">${r.ausgaben > 0 ? formatAmount(r.ausgaben) : ''}</td>
          <td class="num">${r.einnahmen > 0 ? formatAmount(r.einnahmen) : ''}</td>
        </tr>`,
        )
        .join('')}
      <tr class="group-sum">
        <td colspan="5">Saldo ${esc(g.category.name)}</td>
        <td class="num">${formatAmount(g.ausgaben)}</td>
        <td class="num">${formatAmount(g.einnahmen)}</td>
      </tr>
      <tr class="group-sum2">
        <td colspan="5"></td>
        <td colspan="2" class="num"><strong>${formatEur(g.saldo)}</strong></td>
      </tr>`,
    )
    .join('')

  const monthsWithBookings = [...new Set(chrono.map((r) => monthOf(r.date)))]
    .sort((a, b) => a - b)
    .map((m) => MONTH_NAMES[m - 1])
    .join(', ')

  return `
  <section class="account-report">
  <h2 class="account-title">${accountNo}. Bericht ${esc(accountLabel)}</h2>
  <div class="account-meta">Kassenjahr ${esc(fiscalLabel(file))}</div>

  <h3>Zusammenfassung</h3>
  <table class="summary">
    <tr><td>Anfangssaldo (Abschlusssaldo ${prevFiscalEndLabel(file)})</td><td class="num">${formatEur(file.openingBalance)}</td></tr>
    <tr><td>Summe Einnahmen</td><td class="num">${formatEur(totals.einnahmen)}</td></tr>
    <tr><td>Summe Ausgaben</td><td class="num">−${formatEur(totals.ausgaben)}</td></tr>
    <tr><td>Jahressaldo</td><td class="num">${formatEur(totals.saldo)}</td></tr>
    <tr><td>Umsatz</td><td class="num">${formatEur(totals.umsatz)}</td></tr>
    <tr><td>Anzahl Buchungen (${monthsWithBookings || 'keine'})</td><td class="num">${totals.count}</td></tr>
    <tr class="total"><td>Abschlusssaldo ${fiscalEndLabel(file)}</td><td class="num">${formatEur(totals.closingBalance)}</td></tr>
  </table>

  <h3>Buchungen chronologisch <span style="font-weight:normal;font-size:9pt">(▤ = Beleg vorhanden)</span></h3>
  <table>
    <thead>
      <tr><th>Datum</th><th>Nr.</th><th>Beleg</th><th>Name</th><th>Verwendungszweck</th>
      <th class="num">Ausgaben (€)</th><th class="num">Einnahmen (€)</th><th class="num">Kassenstand (€)</th></tr>
    </thead>
    <tbody>${chronoRows}</tbody>
  </table>

  <div class="pagebreak"></div>
  <h3>Buchungen nach Veranstaltung</h3>
  <table>
    <thead>
      <tr><th>Nr.</th><th>Datum</th><th>Beleg</th><th>Name</th><th>Verwendungszweck</th>
      <th class="num">Ausgaben (€)</th><th class="num">Einnahmen (€)</th></tr>
    </thead>
    <tbody>${groupSections}</tbody>
  </table>
  </section>`
}

/**
 * Erzeugt den druckfertigen Prüfbericht als eigenständiges HTML-Dokument
 * (A4): Titel + Abschnitte des Hauptkontos, danach die Abschnitte aller
 * weiteren Konten (eigenes Kassenjahr, strikt getrennt – keine Summen
 * über mehrere Konten) und zum Schluss der Kassenprüfbericht nach Vorlage,
 * der alle Konten abdeckt.
 */
export function buildReportHtml(
  file: YearFile,
  logoDataUrl?: string | null,
  others: readonly YearFile[] = [],
): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Kassenbericht ${file.year}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #1a1a18;
    margin: 0;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  header { border-bottom: 3px double #1a1a18; padding-bottom: 10px; margin-bottom: 18px;
           display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  header img { width: 86px; height: auto; flex: none; }
  h1 { font-size: 20pt; margin: 0; }
  h2 { font-size: 16pt; margin: 26px 0 8px; border-bottom: 2px solid #1a1a18; padding-bottom: 5px; }
  h3 { font-size: 13pt; margin: 20px 0 8px; border-bottom: 1px solid #1a1a18; padding-bottom: 3px; }
  .meta { color: #555; margin-top: 4px; }
  .account-title { font-weight: 800; margin-top: 8px; }
  .account-meta { color: #555; margin: -2px 0 14px; font-size: 10pt; }
  .receipt-state { color: #555; font-size: 8.5pt; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { text-align: left; border-bottom: 1.5px solid #1a1a18; padding: 4px 6px; font-size: 8.5pt;
       text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 4px 6px; border-bottom: 0.5px solid #bbb; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  .ref { font-weight: bold; white-space: nowrap; }
  .summary td { border-bottom: 0.5px solid #bbb; padding: 5px 6px; }
  .summary .total td { border-top: 1.5px solid #1a1a18; border-bottom: 3px double #1a1a18; font-weight: bold; }
  .group-head td { background: #f0ede6; font-weight: bold; border-top: 1.5px solid #1a1a18; }
  .group-sum td { font-weight: bold; border-top: 1px solid #1a1a18; }
  .group-sum2 td { font-weight: bold; border-bottom: 2px solid #1a1a18; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px 60px; margin-top: 50px; }
  .sig { border-top: 1px solid #1a1a18; padding-top: 4px; font-size: 9pt; color: #444; }
  .pagebreak { break-before: page; }
  footer { margin-top: 30px; font-size: 8pt; color: #888; }
  /* Kassenprüfbericht nach Vereinsvorlage */
  .audit { font-size: 11pt; line-height: 1.7; }
  .audit h2 { font-size: 16pt; margin-top: 18px; }
  .audit .club { font-size: 12pt; font-weight: bold; }
  .audit .box { font-size: 13pt; margin: 0 4px 0 10px; }
  .audit .konto { margin: 22px 0 0; }
  .audit .konto-head { font-weight: bold; margin-bottom: 4px; }
  .fill { display: inline-block; border-bottom: 1px solid #1a1a18; height: 1em; vertical-align: bottom; }
  .audit .lines { margin: 6px 0; }
  .audit .lines .fill { width: 100%; margin-top: 14px; }
  .audit .sig-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 40px; margin-top: 60px; }
</style>
</head>
<body>
  <header>
    <div>
      <h1>Kassenbericht ${file.year}</h1>
      <div class="meta">
        ${esc(file.clubName || '')}${file.clubName ? ' · ' : ''}Kassenführung: ${esc(file.treasurerName || '–')}
        · Erstellt am ${formatDate(new Date().toISOString().slice(0, 10))}
      </div>
    </div>
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}
  </header>

  ${ledgerSections(file, 1, accountReportLabel(file, file.audit?.konto1))}

  ${others
    .map(
      (other, i) => `
  <div class="pagebreak"></div>
  ${ledgerSections(other, 2 + i, accountReportLabel(other, i === 0 ? file.audit?.konto2 : undefined))}
  `,
    )
    .join('\n')}

  <div class="pagebreak"></div>
  ${auditSection(file, 2 + others.length)}
  <footer>Erstellt mit Buchführung · Kassenbericht ${file.year}</footer>
</body>
</html>`
}

/** Kassenprüfbericht – Aufbau und Formulierungen folgen der Vereinsvorlage. */
function auditSection(file: YearFile, sectionNo: number): string {
  const a: Partial<AuditInfo> = file.audit ?? {}
  const konten = [a.konto1, a.konto2].filter((k) => (k ?? '').trim() !== '')
  const kontoBlocks = (konten.length > 0 ? konten : [undefined]).map(
    (konto) => `
    <div class="konto">
      <div class="konto-head">Geprüft wurde das Bankkonto ${val(konto, 160)}</div>
      <div>
        <span class="box">☐</span> lückenlos
        <span class="box">☐</span> stichprobenartig
        &nbsp;&nbsp;auf&nbsp;&nbsp;
        <span class="box">☐</span> rechnerische
        <span class="box">☐</span> sachliche Richtigkeit
      </div>
      <div class="lines">
        Dabei ist uns Folgendes aufgefallen: <span class="fill" style="width:55%"></span>
        <span class="fill"></span>
      </div>
      <div><span class="box" style="margin-left:0">☐</span> Die Kontoführung war (ansonsten) einwandfrei. (Weitere) Mängel konnten nicht festgestellt werden.</div>
    </div>`,
  )

  return `
  <section class="audit">
    <div class="club">${esc(file.clubName || '')}</div>
    <h2>${sectionNo}. Kassenprüfbericht ${file.year}</h2>
    <p>
      Am ${dateVal(a.pruefDatum, file.year)} haben die von der letzten Mitgliederversammlung am
      ${dateVal(a.wahlDatum, file.year)} gewählten Kassenprüfer <strong>${val(a.pruefer1)}</strong> und
      <strong>${val(a.pruefer2)}</strong> im Beisein von ${val(file.treasurerName, 260)} die Kasse und das
      Konto der ${esc(file.clubName || 'Ortsgruppe')} entsprechend ihrem Auftrag aus der
      Generalversammlung vom ${dateVal(a.wahlDatum, file.year)} geprüft.
    </p>
    ${kontoBlocks.join('\n')}
    <p style="margin-top:28px">
      Wir bitten auf der Grundlage unserer Prüfung um Entlastung des Kassierers
      <strong>${esc(file.treasurerName || '')}</strong> / des Vorstandes in der
      Generalversammlung am ${dateVal(a.gvDatum, file.year)}.
    </p>
    <div class="sig-row">
      <div class="sig">Ort, Datum${a.ort ? `: ${esc(a.ort)}` : ''}</div>
      <div class="sig">${esc(a.pruefer1 || 'Kassenprüfer:in 1')}</div>
      <div class="sig">${esc(a.pruefer2 || 'Kassenprüfer:in 2')}</div>
    </div>
  </section>`
}

function accountName(file: YearFile): string {
  return file.kontoName?.trim() || ((file.konto ?? 'haupt') === 'haupt' ? 'Hauptkonto' : 'Weiteres Konto')
}

function accountReportLabel(file: YearFile, accountReference?: string): string {
  const name = accountName(file)
  const ref = accountReference?.trim()
  return ref ? `${name} · ${ref}` : name
}

function receiptCell(available: number, total: number): string {
  if (available === 0) return ''
  const count = total > 1 ? ` ${available}/${total}` : ''
  return `<span class="receipt-state">▤${count}</span>`
}

function formatAuditDate(value: string | undefined, fallbackYear: number): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`

  const german = /^(\d{1,2})\.(\d{1,2})\.(?:(\d{2}|\d{4}))?$/.exec(raw)
  if (!german) return raw
  const day = german[1].padStart(2, '0')
  const month = german[2].padStart(2, '0')
  const yearRaw = german[3]
  const year = yearRaw ? (yearRaw.length === 2 ? `20${yearRaw}` : yearRaw) : String(fallbackYear)
  return `${day}.${month}.${year}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
