import { chronological, yearTotals } from '@shared/ledger'
import { MONTH_NAMES, formatEur, monthOf } from '@shared/money'
import type { YearFile } from '@shared/types'

/**
 * Jahres-Präsentation für die Generalversammlung als eigenständiges HTML
 * (A4 quer, eine Folie pro Seite): Anfangsbestand, Monatsverlauf mit den
 * Salden je Veranstaltung, Jahressaldo und Endbestand – wie die bisherige
 * PowerPoint des Vereins, nur automatisch aus den Buchungen erzeugt.
 */
export function buildPresentationHtml(file: YearFile, logoDataUrl?: string | null): string {
  const totals = yearTotals(file)
  const chrono = chronological(file)

  // Saldo je Veranstaltung innerhalb jedes Monats (Reihenfolge: erstes Auftreten)
  const months: { month: number; events: { name: string; saldo: number }[] }[] = []
  for (const row of chrono) {
    const m = monthOf(row.date)
    let bucket = months.find((x) => x.month === m)
    if (!bucket) {
      bucket = { month: m, events: [] }
      months.push(bucket)
    }
    let event = bucket.events.find((e) => e.name === row.categoryName)
    if (!event) {
      event = { name: row.categoryName, saldo: 0 }
      bucket.events.push(event)
    }
    event.saldo += row.signedAmount
  }

  // Maximal 4 Monats-Karten pro Folie
  const monthChunks: (typeof months)[] = []
  for (let i = 0; i < months.length; i += 4) monthChunks.push(months.slice(i, i + 4))

  const logo = logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="">` : ''
  const eur = (cents: number) =>
    `<span class="${cents < 0 ? 'neg' : 'pos'}">${cents > 0 ? '+' : ''}${formatEur(cents)}</span>`

  const monthSlides = monthChunks
    .map(
      (chunk, idx) => `
  <section class="slide light">
    <header><span class="kicker">Kassenbericht ${file.year}</span>
      <span class="kicker">Monatsverlauf ${monthChunks.length > 1 ? `${idx + 1}/${monthChunks.length}` : ''}</span>
    </header>
    <div class="month-grid cols-${Math.min(chunk.length, 2)}">
      ${chunk
        .map(
          (m) => `
      <div class="month-card">
        <div class="month-name">${MONTH_NAMES[m.month - 1]}</div>
        ${m.events
          .map(
            (e) => `
        <div class="event-row">
          <span class="event-name">${esc(e.name)}</span>
          <span class="event-saldo">${eur(e.saldo)}</span>
        </div>`,
          )
          .join('')}
      </div>`,
        )
        .join('')}
    </div>
  </section>`,
    )
    .join('')

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Kassenbericht ${file.year} – Präsentation</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  html, body { padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #221f1a; }
  .slide {
    width: 296mm;
    height: 209mm;
    page-break-after: always;
    padding: 18mm 22mm;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .slide.dark { background: #16301f; color: #f2efe7; }
  .slide.light { background: #faf8f2; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10mm; }
  .kicker { font-size: 13pt; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.65;
            font-family: 'Helvetica Neue', Arial, sans-serif; }
  .logo { width: 34mm; height: auto; }
  .title-wrap { margin: auto 0; }
  .title-wrap .logo { width: 46mm; margin-bottom: 10mm; }
  h1 { font-size: 44pt; font-weight: 600; letter-spacing: -0.01em; }
  .subtitle { font-size: 17pt; margin-top: 6mm; opacity: 0.8; }
  .big-center { margin: auto; text-align: center; }
  .big-label { font-size: 18pt; opacity: 0.75; margin-bottom: 8mm; }
  .big-number { font-size: 64pt; font-weight: 600; letter-spacing: -0.02em; }
  .big-sub { font-size: 13pt; opacity: 0.6; margin-top: 8mm;
             font-family: 'Helvetica Neue', Arial, sans-serif; }
  .month-grid { display: grid; gap: 8mm; flex: 1; align-content: start; }
  .month-grid.cols-1 { grid-template-columns: 1fr; }
  .month-grid.cols-2 { grid-template-columns: 1fr 1fr; }
  .month-card { background: white; border-radius: 5mm; padding: 7mm 9mm;
                box-shadow: 0 1mm 4mm rgb(30 40 30 / 0.08); }
  .month-name { font-size: 17pt; font-weight: 600; margin-bottom: 4mm; color: #16301f; }
  .event-row { display: flex; justify-content: space-between; align-items: baseline;
               font-size: 13.5pt; padding: 1.6mm 0; border-bottom: 0.3mm solid #e8e4d8; }
  .event-row:last-child { border-bottom: none; }
  .event-name { padding-right: 8mm; }
  .event-saldo { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
  .pos { color: #2c6e49; }
  .neg { color: #9b3a2a; }
  .slide.dark .pos { color: #9fd6b1; }
  .slide.dark .neg { color: #f0a08c; }
  footer { font-size: 10pt; opacity: 0.5; font-family: 'Helvetica Neue', Arial, sans-serif; }
</style>
</head>
<body>
  <section class="slide dark">
    <div class="title-wrap">
      ${logo}
      <h1>Kassenbericht ${file.year}</h1>
      <div class="subtitle">${esc(file.clubName || '')}</div>
    </div>
    <footer>Kassenführung: ${esc(file.treasurerName || '–')} · Alle Angaben ohne Gewähr</footer>
  </section>

  <section class="slide light">
    <header><span class="kicker">Kassenbericht ${file.year}</span>${logo}</header>
    <div class="big-center">
      <div class="big-label">Kontostand zu Beginn des Jahres ${file.year}</div>
      <div class="big-number">${formatEur(file.openingBalance)}</div>
      <div class="big-sub">1. Januar ${file.year}</div>
    </div>
  </section>

  ${monthSlides}

  <section class="slide light">
    <header><span class="kicker">Kassenbericht ${file.year}</span>${logo}</header>
    <div class="big-center">
      <div class="big-label">Saldo für das Geschäftsjahr ${file.year}</div>
      <div class="big-number">${eur(totals.saldo)}</div>
      <div class="big-sub">Einnahmen ${formatEur(totals.einnahmen)} · Ausgaben ${formatEur(totals.ausgaben)} · ${totals.count} Buchungen</div>
    </div>
  </section>

  <section class="slide dark">
    <div class="big-center">
      <div class="big-label">Kassenbestand</div>
      <div class="big-number">${formatEur(totals.closingBalance)}</div>
      <div class="big-sub">31. Dezember ${file.year}</div>
    </div>
  </section>
</body>
</html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
