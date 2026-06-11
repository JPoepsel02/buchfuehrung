import { byCategory, chronological, monthSummaries, yearTotals } from '@shared/ledger'
import { MONTH_NAMES, formatEur, monthOf } from '@shared/money'
import type { MonthSummary, YearFile } from '@shared/types'

/**
 * Jahres-Präsentation für die Generalversammlung (A4 quer, eine Folie pro
 * Seite): dunkle Titelfolie, "Jahr in Zahlen" als Bento-Grid, Jahresverlauf
 * mit Saldo-Balken und Kassenstand-Kurve, Monatskarten, Veranstaltungs-
 * Ranking sowie Jahressaldo und Endbestand als Großzahlen.
 */

const INK = '#1c2a21'
const PINE = '#14281c'
const PINE_DEEP = '#0d1f15'
const CREAM = '#f7f4ec'
const GREEN = '#2c7a4f'
const GREEN_SOFT = '#9fd6b1'
const RED = '#b14a32'
const RED_SOFT = '#f0a08c'
const MUTED = '#8a9388'

const EUR0 = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function buildPresentationHtml(file: YearFile, logoDataUrl?: string | null): string {
  const totals = yearTotals(file)
  const months = monthSummaries(file)
  const chrono = chronological(file)
  const groups = byCategory(file)

  // Saldo je Veranstaltung innerhalb jedes Monats (Reihenfolge: erstes Auftreten)
  const monthEvents: { month: number; events: { name: string; saldo: number }[] }[] = []
  for (const row of chrono) {
    const m = monthOf(row.date)
    let bucket = monthEvents.find((x) => x.month === m)
    if (!bucket) {
      bucket = { month: m, events: [] }
      monthEvents.push(bucket)
    }
    let event = bucket.events.find((e) => e.name === row.categoryName)
    if (!event) {
      event = { name: row.categoryName, saldo: 0 }
      bucket.events.push(event)
    }
    event.saldo += row.signedAmount
  }
  const monthChunks: (typeof monthEvents)[] = []
  for (let i = 0; i < monthEvents.length; i += 4) monthChunks.push(monthEvents.slice(i, i + 4))

  const logo = logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="">` : ''
  const heroLogo = logoDataUrl ? `<img class="hero-logo" src="${logoDataUrl}" alt="">` : ''
  const eur = (cents: number) =>
    `<span class="${cents < 0 ? 'neg' : 'pos'}">${cents > 0 ? '+' : ''}${formatEur(cents)}</span>`

  const monthSlides = monthChunks
    .map(
      (chunk, idx) => `
  <section class="slide light">
    <header>
      <span class="kicker">Monatsverlauf${monthChunks.length > 1 ? ` · ${idx + 1}/${monthChunks.length}` : ''}</span>
      <span class="kicker kicker--soft">Kassenbericht ${file.year}</span>
    </header>
    <div class="month-grid cols-${Math.min(chunk.length, 2)}">
      ${chunk
        .map((m) => {
          const saldo = m.events.reduce((a, e) => a + e.saldo, 0)
          return `
      <div class="month-card">
        <div class="month-head">
          <span class="month-name">${MONTH_NAMES[m.month - 1]}</span>
          <span class="badge ${saldo < 0 ? 'badge--neg' : 'badge--pos'}">${saldo > 0 ? '+' : ''}${formatEur(saldo)}</span>
        </div>
        ${m.events
          .map(
            (e) => `
        <div class="event-row">
          <span class="event-name">${esc(e.name)}</span>
          <span class="event-dots"></span>
          <span class="event-saldo">${eur(e.saldo)}</span>
        </div>`,
          )
          .join('')}
      </div>`
        })
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
  body { font-family: Georgia, 'Times New Roman', serif; color: ${INK}; }
  .slide {
    width: 296mm; height: 209mm;
    page-break-after: always;
    padding: 16mm 20mm;
    display: flex; flex-direction: column;
    position: relative; overflow: hidden;
  }
  .slide.dark {
    background: radial-gradient(120% 140% at 15% 0%, #1d3a28 0%, ${PINE} 45%, ${PINE_DEEP} 100%);
    color: ${CREAM};
  }
  .slide.light { background: ${CREAM}; }
  .sans { font-family: 'Helvetica Neue', Arial, sans-serif; }

  /* Riesige Jahreszahl als Hintergrund-Ornament */
  .giant-year {
    position: absolute; right: -8mm; bottom: -26mm;
    font-size: 130mm; font-weight: 700; letter-spacing: -0.04em;
    color: rgb(255 255 255 / 0.05); line-height: 1; user-select: none;
  }
  .slide.light .giant-year { color: rgb(20 40 28 / 0.05); }

  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9mm; z-index: 1; }
  .kicker { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; letter-spacing: 0.18em;
            text-transform: uppercase; font-weight: 600; }
  .kicker--soft { opacity: 0.45; font-weight: 400; }
  .logo { width: 26mm; height: auto; }

  /* Hero */
  .hero { margin: auto 0; z-index: 1; }
  .hero-logo { width: 40mm; margin-bottom: 9mm; filter: drop-shadow(0 2mm 6mm rgb(0 0 0 / 0.35)); }
  .hero .eyebrow { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13pt; letter-spacing: 0.22em;
                   text-transform: uppercase; color: ${GREEN_SOFT}; margin-bottom: 5mm; }
  h1 { font-size: 52pt; font-weight: 650; letter-spacing: -0.015em; line-height: 1.04; }
  .hero .year-accent { color: ${GREEN_SOFT}; }
  .subtitle { font-size: 16pt; margin-top: 6mm; opacity: 0.75; }
  footer { font-size: 9.5pt; opacity: 0.45; font-family: 'Helvetica Neue', Arial, sans-serif; z-index: 1; }

  /* Bento "Jahr in Zahlen" */
  .bento { display: grid; grid-template-columns: 1.5fr 1fr 1fr; grid-template-rows: 1fr 1fr;
           gap: 7mm; flex: 1; z-index: 1; }
  .tile { background: white; border-radius: 6mm; padding: 9mm 10mm;
          box-shadow: 0 1.5mm 6mm rgb(25 40 30 / 0.07); display: flex; flex-direction: column; }
  .tile--hero { grid-row: span 2; background: linear-gradient(150deg, #1d3a28, ${PINE_DEEP});
                color: ${CREAM}; justify-content: center; }
  .tile .label { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt; letter-spacing: 0.14em;
                 text-transform: uppercase; opacity: 0.55; margin-bottom: auto; }
  .tile--hero .label { color: ${GREEN_SOFT}; opacity: 1; margin-bottom: 6mm; }
  .tile .value { font-size: 26pt; font-weight: 650; letter-spacing: -0.01em; margin-top: 4mm; }
  .tile--hero .value { font-size: 42pt; }
  .tile .sub { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5pt; opacity: 0.5; margin-top: 2.5mm; }
  .pos { color: ${GREEN}; } .neg { color: ${RED}; }
  .tile--hero .pos { color: ${GREEN_SOFT}; } .tile--hero .neg { color: ${RED_SOFT}; }

  /* Chart-Folie */
  .chart-card { background: white; border-radius: 6mm; padding: 9mm 10mm 7mm;
                box-shadow: 0 1.5mm 6mm rgb(25 40 30 / 0.07); z-index: 1; }
  .chart-card + .chart-card { margin-top: 7mm; }
  .chart-title { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt; letter-spacing: 0.14em;
                 text-transform: uppercase; opacity: 0.55; margin-bottom: 4mm; }
  svg text { font-family: 'Helvetica Neue', Arial, sans-serif; }

  /* Monatskarten */
  .month-grid { display: grid; gap: 7mm; flex: 1; align-content: start; z-index: 1; }
  .month-grid.cols-1 { grid-template-columns: 1fr; }
  .month-grid.cols-2 { grid-template-columns: 1fr 1fr; }
  .month-card { background: white; border-radius: 6mm; padding: 7mm 9mm;
                box-shadow: 0 1.5mm 6mm rgb(25 40 30 / 0.07); }
  .month-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4mm; }
  .month-name { font-size: 16.5pt; font-weight: 650; color: ${PINE}; }
  .badge { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; font-weight: 600;
           padding: 1.4mm 3.4mm; border-radius: 99mm; }
  .badge--pos { background: #e3f1e7; color: ${GREEN}; }
  .badge--neg { background: #f8e7e1; color: ${RED}; }
  .event-row { display: flex; align-items: baseline; gap: 3mm; font-size: 12.5pt; padding: 1.7mm 0; }
  .event-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%; }
  .event-dots { flex: 1; border-bottom: 0.4mm dotted #d8d4c6; transform: translateY(-1mm); }
  .event-saldo { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }

  /* Großzahl-Folien */
  .big-center { margin: auto; text-align: center; z-index: 1; }
  .big-label { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13pt; letter-spacing: 0.2em;
               text-transform: uppercase; opacity: 0.55; margin-bottom: 9mm; }
  .slide.dark .big-label { color: ${GREEN_SOFT}; opacity: 1; }
  .big-number { font-size: 70pt; font-weight: 650; letter-spacing: -0.02em; }
  .big-sub { font-size: 12pt; opacity: 0.55; margin-top: 8mm; font-family: 'Helvetica Neue', Arial, sans-serif; }
</style>
</head>
<body>
  <section class="slide dark">
    <div class="giant-year">${file.year}</div>
    <div class="hero">
      ${heroLogo}
      <div class="eyebrow">${esc(file.clubName || 'Kassenbericht')}</div>
      <h1>Kassenbericht<br><span class="year-accent">${file.year}</span></h1>
      <div class="subtitle">Generalversammlung · Kassenführung: ${esc(file.treasurerName || '–')}</div>
    </div>
    <footer>Alle Angaben ohne Gewähr</footer>
  </section>

  <section class="slide light">
    <div class="giant-year">${file.year}</div>
    <header><span class="kicker">Das Jahr in Zahlen</span>${logo || `<span class="kicker kicker--soft">Kassenbericht ${file.year}</span>`}</header>
    <div class="bento">
      <div class="tile tile--hero">
        <div class="label">Kassenbestand 31.12.${file.year}</div>
        <div class="value">${formatEur(totals.closingBalance)}</div>
        <div class="sub" style="opacity:0.6">Jahresbeginn: ${formatEur(file.openingBalance)}</div>
      </div>
      <div class="tile">
        <div class="label">Einnahmen</div>
        <div class="value pos">${formatEur(totals.einnahmen)}</div>
      </div>
      <div class="tile">
        <div class="label">Ausgaben</div>
        <div class="value neg">−${formatEur(totals.ausgaben)}</div>
      </div>
      <div class="tile">
        <div class="label">Jahressaldo</div>
        <div class="value">${eur(totals.saldo)}</div>
      </div>
      <div class="tile">
        <div class="label">Buchungen</div>
        <div class="value">${totals.count}</div>
        <div class="sub">Umsatz ${formatEur(totals.umsatz)} (ohne durchlaufende Posten)</div>
      </div>
    </div>
  </section>

  <section class="slide light">
    <header><span class="kicker">Jahresverlauf</span><span class="kicker kicker--soft">Kassenbericht ${file.year}</span></header>
    <div class="chart-card">
      <div class="chart-title">Saldo je Monat</div>
      ${saldoBarChart(months)}
    </div>
    <div class="chart-card">
      <div class="chart-title">Kassenstand im Jahresverlauf</div>
      ${balanceLineChart(months, file.openingBalance)}
    </div>
  </section>

  ${monthSlides}

  ${
    groups.length > 0
      ? `
  <section class="slide light">
    <header><span class="kicker">Veranstaltungen im Vergleich</span><span class="kicker kicker--soft">Kassenbericht ${file.year}</span></header>
    <div class="chart-card" style="flex:1">
      <div class="chart-title">Saldo je Veranstaltung</div>
      ${categoryRanking(groups.map((g) => ({ name: g.category.name, saldo: g.saldo })))}
    </div>
  </section>`
      : ''
  }

  <section class="slide light">
    <div class="giant-year">${file.year}</div>
    <div class="big-center">
      <div class="big-label">Saldo für das Geschäftsjahr ${file.year}</div>
      <div class="big-number">${eur(totals.saldo)}</div>
      <div class="big-sub">Einnahmen ${formatEur(totals.einnahmen)} · Ausgaben ${formatEur(totals.ausgaben)} · ${totals.count} Buchungen</div>
    </div>
  </section>

  <section class="slide dark">
    <div class="giant-year">${file.year}</div>
    <div class="big-center">
      <div class="big-label">Kassenbestand</div>
      <div class="big-number">${formatEur(totals.closingBalance)}</div>
      <div class="big-sub">31. Dezember ${file.year} · Jahresbeginn ${formatEur(file.openingBalance)}</div>
    </div>
    <footer style="text-align:center">${esc(file.clubName || '')}</footer>
  </section>
</body>
</html>`
}

/** Balkendiagramm: Saldo je Monat, positive Balken grün nach oben, negative rot nach unten. */
function saldoBarChart(months: MonthSummary[]): string {
  const W = 980
  const H = 300
  const padX = 16
  const labelH = 22
  const posMax = Math.max(1, ...months.map((m) => m.saldo))
  const negMax = Math.max(0, ...months.map((m) => -m.saldo))
  const plotH = H - labelH - 34
  const zeroY = 22 + (plotH * posMax) / (posMax + negMax)
  const scale = plotH / (posMax + negMax)
  const slot = (W - padX * 2) / 12
  const barW = slot * 0.52

  const bars = months
    .map((m, i) => {
      const x = padX + slot * i + (slot - barW) / 2
      const h = Math.abs(m.saldo) * scale
      const isPos = m.saldo >= 0
      const y = isPos ? zeroY - h : zeroY
      const label = m.saldo !== 0 ? EUR0.format(m.saldo / 100) : ''
      const labelY = isPos ? y - 7 : y + h + 15
      return `
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, m.saldo !== 0 ? 2 : 0).toFixed(1)}"
          rx="5" fill="${isPos ? GREEN : RED}" opacity="${m.saldo === 0 ? 0 : 0.92}"/>
    ${label ? `<text x="${(x + barW / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="${isPos ? GREEN : RED}">${label}</text>` : ''}
    <text x="${(padX + slot * i + slot / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="12" fill="${MUTED}">${MONTH_NAMES[i].slice(0, 3)}</text>`
    })
    .join('')

  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
    <line x1="${padX}" y1="${zeroY.toFixed(1)}" x2="${W - padX}" y2="${zeroY.toFixed(1)}" stroke="#d8d4c6" stroke-width="1.5"/>
    ${bars}
  </svg>`
}

/** Linien-/Flächendiagramm: Kassenstand am Monatsende, beginnend beim Anfangssaldo. */
function balanceLineChart(months: MonthSummary[], openingBalance: number): string {
  const W = 980
  const H = 240
  const padX = 16
  const padTop = 30
  const padBottom = 24
  const values = [openingBalance, ...months.map((m) => m.balanceEnd)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  const plotH = H - padTop - padBottom
  const stepX = (W - padX * 2) / 12
  const pt = (i: number, v: number) =>
    `${(padX + stepX * i).toFixed(1)},${(padTop + plotH - ((v - min) / span) * plotH).toFixed(1)}`
  const points = values.map((v, i) => pt(i, v))
  const lastY = points[points.length - 1].split(',')[1]
  const firstY = points[0].split(',')[1]

  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
    <defs>
      <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${GREEN}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${GREEN}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polygon points="${points.join(' ')} ${(W - padX).toFixed(1)},${H - padBottom} ${padX},${H - padBottom}" fill="url(#fill)"/>
    <polyline points="${points.join(' ')}" fill="none" stroke="${GREEN}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${padX}" cy="${firstY}" r="5" fill="${PINE}"/>
    <circle cx="${W - padX}" cy="${lastY}" r="5" fill="${GREEN}"/>
    <text x="${padX + 10}" y="${Number(firstY) - 10}" font-size="12.5" font-weight="600" fill="${PINE}">${EUR0.format(openingBalance / 100)}</text>
    <text x="${W - padX - 10}" y="${Number(lastY) - 10}" text-anchor="end" font-size="12.5" font-weight="600" fill="${GREEN}">${EUR0.format(values[values.length - 1] / 100)}</text>
    <text x="${padX}" y="${H - 6}" font-size="12" fill="${MUTED}">1. Januar</text>
    <text x="${W - padX}" y="${H - 6}" text-anchor="end" font-size="12" fill="${MUTED}">31. Dezember</text>
  </svg>`
}

/** Horizontales Ranking: Saldo je Veranstaltung, sortiert, maximal 9 Zeilen. */
function categoryRanking(items: { name: string; saldo: number }[]): string {
  const sorted = [...items].sort((a, b) => b.saldo - a.saldo).slice(0, 9)
  const W = 980
  const rowH = 44
  const H = sorted.length * rowH + 8
  const labelW = 250
  const valueW = 110
  const barMax = W - labelW - valueW - 24
  const maxAbs = Math.max(1, ...sorted.map((i) => Math.abs(i.saldo)))

  const rows = sorted
    .map((item, i) => {
      const y = i * rowH + 8
      const w = Math.max(4, (Math.abs(item.saldo) / maxAbs) * barMax)
      const isPos = item.saldo >= 0
      return `
    <text x="0" y="${y + 22}" font-size="14.5" fill="${INK}">${esc(shorten(item.name, 26))}</text>
    <rect x="${labelW}" y="${y + 6}" width="${w.toFixed(1)}" height="22" rx="6" fill="${isPos ? GREEN : RED}" opacity="0.9"/>
    <text x="${labelW + w + 12}" y="${y + 22}" font-size="13.5" font-weight="600" fill="${isPos ? GREEN : RED}">${item.saldo > 0 ? '+' : ''}${EUR0.format(item.saldo / 100)}</text>`
    })
    .join('')

  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${rows}</svg>`
}

function shorten(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
