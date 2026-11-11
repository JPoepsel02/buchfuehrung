import PptxGenJS from 'pptxgenjs'
import { imageSize } from 'image-size'
import { MONTH_NAMES, formatDate, formatEur } from '@shared/money'
import { isSafeLogoDataUrl } from '@shared/logo'
import type { YearFile } from '@shared/types'
import { buildPresentationData } from './presentationData'
import type { PresentationStation, PresentationSummary } from './presentationData'

const COLOR = {
  pine: '13271B', cream: 'F8F5EE', ink: '21301F', green: '2C7A4F',
  soft: 'A8DCBB', red: 'B14A32', muted: '788373', line: 'DCD7C8',
} as const
const WIDTH = 13.333333
const LEFT = 0.85
const CONTENT = WIDTH - 2 * LEFT
const signed = (amount: number) => `${amount > 0 ? '+ ' : amount < 0 ? '− ' : ''}${formatEur(Math.abs(amount))}`
const amountColor = (amount: number) => amount < 0 ? COLOR.red : COLOR.green
const nameSize = (name: string, normal = 18) => name.length > 90 ? 12 : name.length > 55 ? 15 : normal
interface Logo { data: string; width: number; height: number }

function readLogo(data: string | null | undefined): Logo | undefined {
  if (!isSafeLogoDataUrl(data)) return undefined
  try {
    const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (character) => character.charCodeAt(0))
    const { width, height } = imageSize(bytes)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Ungültige Bildgröße')
    return { data, width, height }
  } catch {
    throw new Error('Das Vereinslogo konnte nicht gelesen werden. Bitte eine gültige PNG-, JPEG- oder WebP-Datei verwenden.')
  }
}

function text(slide: PptxGenJS.Slide, value: string, options: PptxGenJS.TextPropsOptions) {
  slide.addText(value, { fontFace: 'Arial', lang: 'de-DE', margin: 0, color: COLOR.ink,
    fontSize: 16, breakLine: false, valign: 'middle', fit: 'shrink', ...options })
}

function addLogo(slide: PptxGenJS.Slide, logo: Logo | undefined, x: number, y: number, w: number, h: number) {
  if (!logo) return
  const scale = Math.min(w / logo.width, h / logo.height)
  const width = logo.width * scale
  const height = logo.height * scale
  slide.addImage({ data: logo.data, x: x + (w - width) / 2, y: y + (h - height) / 2,
    w: width, h: height, altText: 'Vereinslogo' })
}

function newSlide(pptx: PptxGenJS, dark = false): PptxGenJS.Slide {
  const slide = pptx.addSlide()
  slide.background = { color: dark ? COLOR.pine : COLOR.cream }
  return slide
}

function watermark(slide: PptxGenJS.Slide, year: number, dark = false) {
  text(slide, String(year), { objectName: 'Hintergrundjahr',
    x: 0, y: 2.775591, w: 13.727034, h: 5.905512,
    fontFace: 'Helvetica Neue', fontSize: 425.19685, charSpacing: -21.25984, lineSpacingMultiple: 1,
    bold: true, color: dark ? 'FFFFFF' : '192D1E', transparency: 95.5,
    align: 'right', valign: 'top', fit: 'none' })
}

function footer(slide: PptxGenJS.Slide, file: YearFile, label: string, dark = false) {
  text(slide, `${file.clubName || ''} · Kassenbericht ${label}`, {
    x: LEFT, y: 7.02, w: CONTENT, h: 0.23, fontSize: 9,
    color: dark ? COLOR.soft : COLOR.muted,
  })
}

function heading(slide: PptxGenJS.Slide, kicker: string, title: string, logo: Logo | undefined, label: string) {
  text(slide, kicker.toUpperCase(), { x: LEFT, y: 0.65, w: 9.7, h: 0.28, fontSize: 11, bold: true,
    charSpacing: 2, color: COLOR.green })
  text(slide, title, { x: LEFT, y: 1.05, w: 10.15, h: 0.58, fontSize: 28, bold: true })
  if (logo) addLogo(slide, logo, 11.35, 0.65, 1.1, 0.75)
  else text(slide, `Kassenbericht ${label}`, { x: 10.1, y: 0.65, w: 2.4, h: 0.3,
    fontSize: 10, color: COLOR.muted, align: 'right' })
}

function cover(pptx: PptxGenJS, file: YearFile, label: string, logo: Logo | undefined) {
  const slide = newSlide(pptx, true)
  watermark(slide, file.year, true)
  addLogo(slide, logo, LEFT, 0.7, 1.6, 1.05)
  text(slide, file.clubName || 'Kassenbericht', { x: LEFT, y: 2.05, w: CONTENT, h: 0.6,
    fontSize: nameSize(file.clubName, 17), color: COLOR.soft, charSpacing: 1.6 })
  text(slide, 'Kassenbericht', { x: LEFT, y: 2.95, w: CONTENT, h: 0.9, fontSize: 58, bold: true, color: COLOR.cream })
  text(slide, label, { x: LEFT, y: 3.92, w: CONTENT, h: 0.9, fontSize: 58, bold: true, color: COLOR.soft })
  text(slide, 'Generalversammlung', { x: LEFT, y: 5.2, w: CONTENT, h: 0.45, fontSize: 18, color: COLOR.cream })
}

function totalSlide(pptx: PptxGenJS, file: YearFile, label: string, title: string, value: string,
  logo: Logo | undefined, options: { dark?: boolean; date?: string; color?: string } = {}) {
  const slide = newSlide(pptx, options.dark)
  watermark(slide, file.year, options.dark)
  if (logo) addLogo(slide, logo, WIDTH / 2 - 0.45, 1.65, 0.9, 0.75)
  else slide.addShape(pptx.ShapeType.line, { x: WIDTH / 2 - 0.45, y: 2.05, w: 0.9, h: 0,
    line: { color: options.dark ? COLOR.soft : COLOR.green, width: 3 } })
  text(slide, title, { x: LEFT, y: 2.68, w: CONTENT, h: 0.65, fontSize: 15, align: 'center',
    color: options.dark ? COLOR.soft : COLOR.muted, charSpacing: 1.3 })
  text(slide, value, { x: LEFT, y: 3.6, w: CONTENT, h: 1.15, fontSize: value.length > 17 ? 58 : 76,
    bold: true, align: 'center', color: options.color ?? (options.dark ? COLOR.cream : COLOR.ink) })
  if (options.date) text(slide, formatDate(options.date), { x: LEFT, y: 5.15, w: CONTENT, h: 0.4,
    fontSize: 14, color: options.dark ? COLOR.soft : COLOR.muted, align: 'center' })
  footer(slide, file, label, options.dark)
}

function timelineSlide(pptx: PptxGenJS, file: YearFile, label: string, stations: PresentationStation[],
  index: number, count: number, logo: Logo | undefined) {
  const slide = newSlide(pptx)
  const first = MONTH_NAMES[stations[0].month - 1]
  const last = MONTH_NAMES[stations.at(-1)!.month - 1]
  heading(slide, `Der Jahresverlauf${count > 1 ? ` · ${index + 1}/${count}` : ''}`,
    first === last ? first : `${first} – ${last}`, logo, label)
  slide.addShape(pptx.ShapeType.line, { x: LEFT, y: 4.1, w: CONTENT, h: 0,
    line: { color: COLOR.green, width: 2.4, ...(index < count - 1 ? { endArrowType: 'triangle' as const } : {}) } })
  const width = CONTENT / stations.length
  stations.forEach((station, position) => {
    const x = LEFT + position * width + 0.09
    const w = width - 0.18
    const up = position % 2 === 0
    const y = up ? 2.16 : 4.65
    text(slide, MONTH_NAMES[station.month - 1].toUpperCase(), { x, y, w, h: 0.25,
      fontSize: 10, charSpacing: 1.5, color: COLOR.muted, align: 'center' })
    text(slide, station.name, { x, y: y + 0.37, w, h: 0.96, fontSize: nameSize(station.name),
      bold: true, align: 'center' })
    text(slide, signed(station.saldo), { x, y: y + 1.4, w, h: 0.4,
      fontSize: 19, bold: true, color: amountColor(station.saldo), align: 'center' })
    const center = x + w / 2
    slide.addShape(pptx.ShapeType.line, { x: center, y: up ? 3.96 : 4.1, w: 0, h: up ? 0.14 : 0.42,
      line: { color: COLOR.line, width: 1.2 } })
    slide.addShape(pptx.ShapeType.ellipse, { x: center - 0.095, y: 4.005, w: 0.19, h: 0.19,
      line: { color: amountColor(station.saldo), width: 2.5 }, fill: { color: COLOR.cream } })
  })
  footer(slide, file, label)
}

function summarySlide(pptx: PptxGenJS, file: YearFile, label: string, summaries: PresentationSummary[],
  index: number, count: number, logo: Logo | undefined) {
  const slide = newSlide(pptx)
  watermark(slide, file.year)
  heading(slide, `Weitere Posten${count > 1 ? ` · ${index + 1}/${count}` : ''}`,
    'Beiträge, Zuschüsse & Co.', logo, label)
  summaries.forEach((summary, position) => {
    const columns = Math.min(summaries.length, 2)
    const w = CONTENT / columns - 0.3
    const x = LEFT + (position % columns) * CONTENT / columns + 0.15
    const y = summaries.length <= 2 ? 3.25 : 2.55 + Math.floor(position / columns) * 2.05
    text(slide, signed(summary.saldo), { x, y, w, h: 0.7, fontSize: 42,
      bold: true, color: amountColor(summary.saldo), align: 'center' })
    text(slide, summary.name, { x, y: y + 0.9, w, h: 0.75, fontSize: nameSize(summary.name, 15),
      color: COLOR.muted, align: 'center' })
  })
  footer(slide, file, label)
}

export async function buildPresentationPptx(file: YearFile, logoDataUrl?: string | null): Promise<Uint8Array> {
  const data = buildPresentationData(file)
  const logo = readLogo(logoDataUrl)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = file.treasurerName || file.clubName || 'Buchführung'
  pptx.company = file.clubName
  pptx.subject = `Jahrespräsentation ${data.label}`
  pptx.title = `Kassenbericht ${data.label}`
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }
  cover(pptx, file, data.label, logo)
  totalSlide(pptx, file, data.label, `Kontostand zu Beginn des Jahres ${data.label}`, formatEur(file.openingBalance),
    logo, { date: data.range.start })
  data.timeline.forEach((stations, index) => timelineSlide(pptx, file, data.label, stations, index, data.timeline.length, logo))
  data.summaries.forEach((summaries, index) => summarySlide(pptx, file, data.label, summaries, index, data.summaries.length, logo))
  totalSlide(pptx, file, data.label, `Saldo für das Geschäftsjahr ${data.label}`, signed(data.totals.saldo), logo,
    { color: amountColor(data.totals.saldo) })
  totalSlide(pptx, file, data.label, 'Kassenbestand', formatEur(data.totals.closingBalance), logo,
    { dark: true, date: data.range.end })
  const result = await pptx.write({ outputType: 'uint8array', compression: true })
  if (!(result instanceof Uint8Array)) throw new Error('PowerPoint-Datei konnte nicht erstellt werden.')
  return result
}
