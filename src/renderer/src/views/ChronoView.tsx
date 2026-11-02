import { useStore } from '../store'
import { ChronologicalTable } from '../components/ChronologicalTable'
import { fiscalLabel } from '@shared/fiscal'
import { chronological } from '@shared/ledger'

/** Alle Buchungen chronologisch mit laufendem Kassenstand – wie das Excel-Blatt. */
export function ChronoView() {
  const { file } = useStore()
  if (!file) return null
  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Chronologisch {fiscalLabel(file)}</h1>
        </div>
      </header>
      <section className="card">
        <ChronologicalTable rows={chronological(file)} summaryFile={file} emptyMessage="Noch keine Buchungen" />
      </section>
    </div>
  )
}
