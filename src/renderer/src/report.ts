import { byCategory, chronological, yearTotals } from '@shared/ledger'
import { MONTH_NAMES, formatAmount, formatDate, formatEur, monthOf } from '@shared/money'
import type { YearFile } from '@shared/types'

/**
 * Erzeugt den druckfertigen Prüfbericht als eigenständiges HTML-Dokument
 * (A4). Enthält Abhak-Kästchen je Beleg sowie Unterschriftsfelder für die
 * Kassenprüfung.
 */
export function buildReportHtml(file: YearFile, logoDataUrl?: string | null): string {
  const totals = yearTotals(file)
  const chrono = chronological(file)
  const groups = byCategory(file)

  const chronoRows = chrono
    .map(
      (r) => `
      <tr>
        <td class="check">☐</td>
        <td class="nowrap">${formatDate(r.date)}</td>
        <td class="ref">${esc(r.ref)}</td>
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
      <tr class="group-head"><td colspan="6">${esc(g.category.name)}</td></tr>
      ${g.rows
        .map(
          (r) => `
        <tr>
          <td class="check">☐</td>
          <td class="ref">${esc(r.ref)}</td>
          <td class="nowrap">${formatDate(r.date)}</td>
          <td>${esc(r.description)}</td>
          <td class="num">${r.type === 'ausgabe' ? formatAmount(r.amount) : ''}</td>
          <td class="num">${r.type === 'einnahme' ? formatAmount(r.amount) : ''}</td>
        </tr>`,
        )
        .join('')}
      <tr class="group-sum">
        <td colspan="4">Saldo ${esc(g.category.name)}</td>
        <td class="num">${formatAmount(g.ausgaben)}</td>
        <td class="num">${formatAmount(g.einnahmen)}</td>
      </tr>
      <tr class="group-sum2">
        <td colspan="4"></td>
        <td colspan="2" class="num"><strong>${formatEur(g.saldo)}</strong></td>
      </tr>`,
    )
    .join('')

  const monthsWithBookings = [...new Set(chrono.map((r) => monthOf(r.date)))]
    .sort((a, b) => a - b)
    .map((m) => MONTH_NAMES[m - 1])
    .join(', ')

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Kassenbericht ${file.year}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a18;
    margin: 0;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  header { border-bottom: 3px double #1a1a18; padding-bottom: 10px; margin-bottom: 18px;
           display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  header img { width: 86px; height: auto; flex: none; }
  h1 { font-size: 20pt; margin: 0; }
  h2 { font-size: 13pt; margin: 26px 0 8px; border-bottom: 1px solid #1a1a18; padding-bottom: 3px; }
  .meta { color: #555; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { text-align: left; border-bottom: 1.5px solid #1a1a18; padding: 4px 6px; font-size: 8.5pt;
       text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 4px 6px; border-bottom: 0.5px solid #bbb; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  .ref { font-weight: bold; white-space: nowrap; }
  .check { font-size: 12pt; width: 24px; }
  .summary td { border-bottom: 0.5px solid #bbb; padding: 5px 6px; }
  .summary .total td { border-top: 1.5px solid #1a1a18; border-bottom: 3px double #1a1a18; font-weight: bold; }
  .group-head td { background: #f0ede6; font-weight: bold; border-top: 1.5px solid #1a1a18; }
  .group-sum td { font-weight: bold; border-top: 1px solid #1a1a18; }
  .group-sum2 td { font-weight: bold; border-bottom: 2px solid #1a1a18; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px 60px; margin-top: 50px; }
  .sig { border-top: 1px solid #1a1a18; padding-top: 4px; font-size: 9pt; color: #444; }
  .notes { border: 1px solid #888; min-height: 90px; margin-top: 8px; border-radius: 4px; }
  .confirm { margin-top: 24px; font-size: 10pt; }
  .checkbox-line { margin: 6px 0; }
  .checkbox-line .box { font-size: 13pt; margin-right: 6px; }
  .pagebreak { break-before: page; }
  footer { margin-top: 30px; font-size: 8pt; color: #888; }
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

  <h2>1. Zusammenfassung</h2>
  <table class="summary">
    <tr><td>Anfangssaldo (Abschlusssaldo 31.12.${file.year - 1})</td><td class="num">${formatEur(file.openingBalance)}</td></tr>
    <tr><td>Summe Einnahmen</td><td class="num">${formatEur(totals.einnahmen)}</td></tr>
    <tr><td>Summe Ausgaben</td><td class="num">−${formatEur(totals.ausgaben)}</td></tr>
    <tr><td>Jahressaldo</td><td class="num">${formatEur(totals.saldo)}</td></tr>
    <tr><td>Umsatz (ohne durchlaufende Posten)</td><td class="num">${formatEur(totals.umsatz)}</td></tr>
    <tr><td>Anzahl Buchungen (${monthsWithBookings || 'keine'})</td><td class="num">${totals.count}</td></tr>
    <tr class="total"><td>Abschlusssaldo 31.12.${file.year}</td><td class="num">${formatEur(totals.closingBalance)}</td></tr>
  </table>

  <h2>2. Buchungen chronologisch <span style="font-weight:normal;font-size:9pt">(☐ = Beleg geprüft)</span></h2>
  <table>
    <thead>
      <tr><th></th><th>Datum</th><th>Nr.</th><th>Verwendungszweck</th>
      <th class="num">Ausgaben (€)</th><th class="num">Einnahmen (€)</th><th class="num">Kassenstand (€)</th></tr>
    </thead>
    <tbody>${chronoRows}</tbody>
  </table>

  <div class="pagebreak"></div>
  <h2>3. Buchungen nach Veranstaltung</h2>
  <table>
    <thead>
      <tr><th></th><th>Nr.</th><th>Datum</th><th>Verwendungszweck</th>
      <th class="num">Ausgaben (€)</th><th class="num">Einnahmen (€)</th></tr>
    </thead>
    <tbody>${groupSections}</tbody>
  </table>

  <div class="pagebreak"></div>
  <h2>4. Kassenprüfung</h2>
  <div class="confirm">
    <div class="checkbox-line"><span class="box">☐</span> Alle Belege lagen vor und wurden geprüft.</div>
    <div class="checkbox-line"><span class="box">☐</span> Die Buchungen sind rechnerisch richtig.</div>
    <div class="checkbox-line"><span class="box">☐</span> Der Kassenstand stimmt mit Konto- und Barbestand überein.</div>
    <div class="checkbox-line"><span class="box">☐</span> Die Mittel wurden satzungsgemäß verwendet.</div>
    <div class="checkbox-line"><span class="box">☐</span> Es wird empfohlen, den Vorstand zu entlasten.</div>
  </div>
  <p style="margin-top:18px">Bemerkungen / Beanstandungen:</p>
  <div class="notes"></div>
  <div class="sig-grid">
    <div class="sig">Ort, Datum</div>
    <div class="sig">Kassenwart:in: ${esc(file.treasurerName || '')}</div>
    <div class="sig">Kassenprüfer:in 1 (Name, Unterschrift)</div>
    <div class="sig">Kassenprüfer:in 2 (Name, Unterschrift)</div>
  </div>
  <footer>Erstellt mit Buchführung · Kassenbericht ${file.year}</footer>
</body>
</html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
