import { chronological, yearTotals } from '@shared/ledger'
import { MONTH_NAMES, formatEur, monthOf } from '@shared/money'
import type { YearFile } from '@shared/types'

/**
 * Jahres-Präsentation für die Generalversammlung (A4 quer, eine Folie pro
 * Seite) – erzählt das Jahr als Reise: Startsaldo, dann alle Veranstaltungen
 * chronologisch als Stationen an einer durchlaufenden Zeitlinie, zum Schluss
 * Jahressaldo und Kassenbestand als Großzahlen (wie die Vereins-Vorlage).
 */

const PINE = '#13271b'
const PINE_DEEP = '#0b1b11'
const CREAM = '#f8f5ee'
const INK = '#21301f'
const GREEN = '#2c7a4f'
const GREEN_SOFT = '#a8dcbb'
const RED = '#b14a32'
const MUTED = '#98a094'
const LINE = '#dcd7c8'

/** Eine Station der Jahres-Reise: Veranstaltung mit Monat und Saldo. */
interface Station {
  month: number
  name: string
  saldo: number
}

export function buildPresentationHtml(file: YearFile, logoDataUrl?: string | null): string {
  const totals = yearTotals(file)
  const chrono = chronological(file)

  // Chronologische Stationen: Saldo je Veranstaltung innerhalb jedes Monats
  const stations: Station[] = []
  for (const row of chrono) {
    const m = monthOf(row.date)
    let st = stations.find((s) => s.month === m && s.name === row.categoryName)
    if (!st) {
      st = { month: m, name: row.categoryName, saldo: 0 }
      stations.push(st)
    }
    st.saldo += row.signedAmount
  }

  // Stationen gleichmäßig auf Folien verteilen (max. 4 je Folie) –
  // verhindert eine fast leere letzte Folie mit nur einer Station.
  const chunks: Station[][] = []
  const slideCount = Math.max(1, Math.ceil(stations.length / 4))
  const base = Math.floor(stations.length / slideCount)
  let rest = stations.length % slideCount
  for (let i = 0; i < stations.length; ) {
    const size = base + (rest > 0 ? 1 : 0)
    rest -= 1
    chunks.push(stations.slice(i, i + size))
    i += size
  }

  const logo = logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="">` : ''
  const heroLogo = logoDataUrl ? `<img class="hero-logo" src="${logoDataUrl}" alt="">` : ''
  // Auf den Großzahl-Folien: kleines Logo statt Zierstrich (wenn vorhanden)
  const centerMark = logoDataUrl
    ? `<img class="center-logo" src="${logoDataUrl}" alt="">`
    : '<div class="rule"></div>'

  const flowSlides = chunks
    .map((chunk, idx) => {
      const isLast = idx === chunks.length - 1
      const monthRange = `${MONTH_NAMES[chunk[0].month - 1]}${
        chunk.length > 1 && chunk[chunk.length - 1].month !== chunk[0].month
          ? ` – ${MONTH_NAMES[chunk[chunk.length - 1].month - 1]}`
          : ''
      }`
      return `
  <section class="slide light">
    <header>
      <div>
        <div class="kicker accent">Der Jahresverlauf${chunks.length > 1 ? ` · ${idx + 1}/${chunks.length}` : ''}</div>
        <div class="headline">${monthRange}</div>
      </div>
      ${logo || `<span class="kicker soft">Kassenbericht ${file.year}</span>`}
    </header>
    <div class="flow" style="grid-template-columns: repeat(${chunk.length}, 1fr)">
      <div class="flow-line"></div>
      ${!isLast ? '<div class="flow-next">⟶</div>' : '<div class="flow-end"></div>'}
      ${chunk
        .map((s, i) => {
          const up = i % 2 === 0
          const neg = s.saldo < 0
          return `
      <div class="station ${up ? 'station--up' : 'station--down'}" style="grid-column: ${i + 1}">
        <div class="station-body">
          <div class="station-month">${MONTH_NAMES[s.month - 1]}</div>
          <div class="station-name">${esc(s.name)}</div>
          <div class="station-saldo ${neg ? 'neg' : 'pos'}">${s.saldo > 0 ? '+ ' : s.saldo < 0 ? '− ' : ''}${formatEur(Math.abs(s.saldo))}</div>
        </div>
        <div class="station-stem"></div>
        <div class="station-dot ${neg ? 'dot-neg' : 'dot-pos'}"></div>
      </div>`
        })
        .join('')}
    </div>
    <footer>${esc(file.clubName || '')} · Kassenbericht ${file.year}</footer>
  </section>`
    })
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
    padding: 16mm 20mm 12mm;
    display: flex; flex-direction: column;
    position: relative; overflow: hidden;
  }
  .slide.dark {
    background: radial-gradient(130% 150% at 12% -10%, #1e3d29 0%, ${PINE} 48%, ${PINE_DEEP} 100%);
    color: ${CREAM};
  }
  .slide.light { background: ${CREAM}; }

  .kicker { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt;
            letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; }
  .kicker.soft { opacity: 0.4; font-weight: 400; }
  .kicker.accent { color: ${GREEN}; }
  .headline { font-size: 26pt; font-weight: 650; letter-spacing: -0.01em; margin-top: 2.5mm; }
  header { display: flex; justify-content: space-between; align-items: flex-start; z-index: 1; }
  .logo { width: 24mm; height: auto; }
  footer { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9pt;
           opacity: 0.4; z-index: 1; }
  .slide.dark footer { opacity: 0.5; }

  /* Riesige Jahreszahl als Hintergrund */
  .giant-year {
    position: absolute; right: -10mm; bottom: -30mm;
    font-size: 150mm; font-weight: 700; letter-spacing: -0.05em;
    line-height: 1; color: rgb(255 255 255 / 0.045); user-select: none;
  }
  .slide.light .giant-year { color: rgb(25 45 30 / 0.045); }

  /* Hero */
  .hero { margin: auto 0; z-index: 1; }
  .hero-logo { width: 38mm; margin-bottom: 10mm; filter: drop-shadow(0 2mm 6mm rgb(0 0 0 / 0.4)); }
  .hero .eyebrow { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12.5pt;
                   letter-spacing: 0.26em; text-transform: uppercase; color: ${GREEN_SOFT}; margin-bottom: 5mm; }
  h1 { font-size: 54pt; font-weight: 650; letter-spacing: -0.015em; line-height: 1.03; }
  .hero .year-accent { color: ${GREEN_SOFT}; }
  .subtitle { font-size: 15pt; margin-top: 7mm; opacity: 0.72; }

  /* Großzahl-Folien */
  .big-center { margin: auto; text-align: center; z-index: 1; max-width: 240mm; }
  .big-label { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13pt;
               letter-spacing: 0.24em; text-transform: uppercase; opacity: 0.5; margin-bottom: 10mm; }
  .slide.dark .big-label { color: ${GREEN_SOFT}; opacity: 1; }
  .big-number { font-size: 84pt; font-weight: 650; letter-spacing: -0.025em; line-height: 1; }
  .big-sub { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12pt;
             opacity: 0.5; margin-top: 10mm; }
  .rule { width: 22mm; height: 1mm; border-radius: 1mm; background: ${GREEN}; margin: 0 auto 10mm; }
  .slide.dark .rule { background: ${GREEN_SOFT}; }
  .center-logo { width: 22mm; height: auto; margin: 0 auto 9mm; display: block; }
  .slide.dark .center-logo { filter: drop-shadow(0 1.5mm 4mm rgb(0 0 0 / 0.35)); }

  /* Jahres-Flow: Stationen an durchlaufender Zeitlinie */
  .flow {
    position: relative; flex: 1; z-index: 1;
    display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 8mm;
    margin: 4mm 2mm 6mm;
  }
  .flow-line {
    position: absolute; left: -6mm; right: 2mm; top: 50%; height: 0.9mm;
    background: linear-gradient(90deg, rgb(44 122 79 / 0) 0%, ${GREEN} 8%, ${GREEN} 92%, rgb(44 122 79 / 0.25) 100%);
    border-radius: 1mm;
  }
  .flow-next {
    position: absolute; right: -8mm; top: 50%; transform: translateY(-54%);
    color: ${GREEN}; font-size: 20pt; font-family: 'Helvetica Neue', Arial, sans-serif;
  }
  .flow-end {
    position: absolute; right: -4mm; top: 50%; transform: translateY(-50%);
    width: 4mm; height: 4mm; border-radius: 50%;
    background: ${PINE}; border: 1mm solid ${GREEN_SOFT};
  }
  .station { position: relative; display: flex; flex-direction: column; align-items: center; }
  .station-dot {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 5.4mm; height: 5.4mm; border-radius: 50%;
    background: ${CREAM}; border: 1.2mm solid ${GREEN};
    box-shadow: 0 0 0 2mm ${CREAM};
  }
  .station-dot.dot-neg { border-color: ${RED}; }
  .station-stem {
    position: absolute; left: 50%; width: 0.5mm; height: 13mm;
    background: ${LINE}; transform: translateX(-50%);
  }
  .station--up .station-stem { bottom: calc(50% + 4mm); }
  .station--down .station-stem { top: calc(50% + 4mm); }
  .station-body { position: absolute; left: 0; right: 0; text-align: center; }
  .station--up .station-body { bottom: calc(50% + 19mm); }
  .station--down .station-body { top: calc(50% + 19mm); }
  .station-month {
    font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; font-weight: 600;
    letter-spacing: 0.2em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 2.6mm;
  }
  .station-name {
    font-size: 16.5pt; font-weight: 650; line-height: 1.18; color: ${PINE};
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    hyphens: auto; overflow-wrap: break-word;
  }
  .station-saldo {
    font-size: 16.5pt; font-weight: 600; margin-top: 3mm;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .pos { color: ${GREEN}; }
  .neg { color: ${RED}; }
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
    <div class="big-center">
      ${centerMark}
      <div class="big-label">Kontostand zu Beginn des Jahres ${file.year}</div>
      <div class="big-number">${formatEur(file.openingBalance)}</div>
      <div class="big-sub">1. Januar ${file.year}</div>
    </div>
  </section>

  ${flowSlides}

  <section class="slide light">
    <div class="giant-year">${file.year}</div>
    <div class="big-center">
      ${centerMark}
      <div class="big-label">Saldo für das Geschäftsjahr ${file.year}</div>
      <div class="big-number ${totals.saldo < 0 ? 'neg' : 'pos'}">${totals.saldo > 0 ? '+ ' : totals.saldo < 0 ? '− ' : ''}${formatEur(Math.abs(totals.saldo))}</div>
      <div class="big-sub">Einnahmen ${formatEur(totals.einnahmen)} · Ausgaben ${formatEur(totals.ausgaben)} · ${totals.count} Buchungen</div>
    </div>
  </section>

  <section class="slide dark">
    <div class="giant-year">${file.year}</div>
    <div class="big-center">
      ${centerMark}
      <div class="big-label">Kassenbestand</div>
      <div class="big-number">${formatEur(totals.closingBalance)}</div>
      <div class="big-sub">31. Dezember ${file.year}</div>
    </div>
    <footer style="text-align:center">${esc(file.clubName || '')}</footer>
  </section>
</body>
</html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
