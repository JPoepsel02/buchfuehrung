import './styles/global.css'
import './styles/organization.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { StoreProvider } from './store'
import { isLocalExperiment } from '@shared/runtime'

async function start(): Promise<void> {
  document.title = isLocalExperiment ? 'Buchführung · Lokal' : 'Buchführung'
  if (isLocalExperiment && !window.kassenwart) {
    const { initializeLocalBrowserData } = await import('./localDemo')
    initializeLocalBrowserData()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <StoreProvider>
        <App />
      </StoreProvider>
    </StrictMode>,
  )
}

void start().catch((failure: unknown) => {
  document.getElementById('root')!.textContent = 'Die Anwendung konnte nicht gestartet werden. Bitte das Fenster erneut öffnen.'
  console.error(failure instanceof Error ? failure.message : 'Start fehlgeschlagen.')
})
