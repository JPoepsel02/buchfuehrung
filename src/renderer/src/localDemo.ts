import demo from './localDemo.json'
import { isLocalExperiment } from '@shared/runtime'

export function initializeLocalBrowserData(): void {
  if (!isLocalExperiment || window.kassenwart) return
  const prefix = 'vereinszentrale-lokal:'
  if (Object.keys(localStorage).some((key) => key.startsWith(prefix))) return
  for (const file of demo.files) {
    const scope = file.konto === 'haupt' ? 'jahr' : file.konto === 'zweit' ? 'k2' : file.konto
    localStorage.setItem(`${prefix}${scope}:${file.year}`, JSON.stringify(file))
  }
  localStorage.setItem(`${prefix}einstellungen`, JSON.stringify(demo.settings))
}
