import type { YearFile } from '@shared/types'
import { api } from './api'
import { buildPresentationHtml } from './presentation'

export async function exportAnnualPresentation(file: YearFile, logo: string | null | undefined, format: 'pdf' | 'pptx') {
  const name = `Jahrespraesentation-${file.year}.${format}`
  if (format === 'pdf') return api.exportPdf(buildPresentationHtml(file, logo), name, { slideFormat: '16:9' })
  const { buildPresentationPptx } = await import('./presentationPptx')
  return api.savePptx(name, await buildPresentationPptx(file, logo))
}
