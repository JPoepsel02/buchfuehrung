import { BrowserWindow, app } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, pickAsset } from '../shared/version'

/**
 * Update über GitHub-Releases: Check vergleicht das neueste Release mit der
 * laufenden Version; die Installation lädt den Installer herunter und
 * ersetzt die App (macOS: DMG mounten und Bundle tauschen, Windows:
 * NSIS-Setup starten). Kein Code-Signing nötig, da der Download durch die
 * App selbst keine Quarantäne-Markierung erhält.
 */

const REPO = 'JPoepsel02/kassenwart'

export interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
  assetName?: string
  assetUrl?: string
  notes?: string
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Buchfuehrung-Updater' },
  })
  if (!res.ok) throw new Error(`GitHub-Release-Abfrage fehlgeschlagen (HTTP ${res.status})`)
  const rel = (await res.json()) as {
    tag_name?: string
    body?: string
    assets?: { name: string; browser_download_url: string }[]
  }
  const latest = String(rel.tag_name ?? '').replace(/^v/i, '')
  const current = app.getVersion()
  const asset = pickAsset(rel.assets ?? [], process.platform, process.arch)
  return {
    current,
    latest,
    hasUpdate: latest !== '' && compareVersions(latest, current) > 0 && asset !== null,
    assetName: asset?.name,
    assetUrl: asset?.browser_download_url,
    notes: rel.body ?? '',
  }
}

/** Lädt den Installer mit Fortschrittsmeldungen an den Renderer herunter. */
async function download(win: BrowserWindow | null, url: string, target: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Buchfuehrung-Updater' } })
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const out = createWriteStream(target)
  const reader = res.body.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      win?.webContents.send('update:progress', { received, total })
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }
  if (total > 0 && received < total) throw new Error('Download unvollständig.')
}

/** Ersetzt das laufende App-Bundle durch das aus der DMG (macOS). */
function installFromDmg(dmgPath: string): void {
  const attach = spawnSync('hdiutil', ['attach', '-nobrowse', '-readonly', dmgPath], {
    encoding: 'utf-8',
  })
  if (attach.status !== 0) throw new Error('DMG konnte nicht geöffnet werden.')
  const mount = attach.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('/Volumes/'))
    .map((l) => l.slice(l.indexOf('/Volumes/')))
    .pop()
  if (!mount) throw new Error('Mount-Punkt der DMG nicht gefunden.')
  try {
    const appName = readdirSync(mount).find((f) => f.endsWith('.app'))
    if (!appName) throw new Error('Kein App-Bundle in der DMG gefunden.')
    const source = join(mount, appName)
    const target = join('/Applications', appName)
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    const copy = spawnSync('ditto', [source, target])
    if (copy.status !== 0) throw new Error('Kopieren nach /Applications fehlgeschlagen.')
  } finally {
    spawnSync('hdiutil', ['detach', mount, '-quiet'])
  }
}

export async function downloadAndInstall(
  win: BrowserWindow | null,
  info: UpdateInfo,
): Promise<{ ok: boolean; error?: string }> {
  if (!info.assetUrl || !info.assetName) return { ok: false, error: 'Kein Installer gefunden.' }
  const target = join(tmpdir(), info.assetName)
  try {
    await download(win, info.assetUrl, target)
    if (process.platform === 'darwin') {
      installFromDmg(target)
      app.relaunch()
      app.exit(0)
    } else {
      // Windows: NSIS-Setup übernimmt Austausch und Neustart
      spawn(target, [], { detached: true, stdio: 'ignore' }).unref()
      app.quit()
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    // Installer-Datei nach Windows-Start nicht löschen – das Setup läuft daraus
    if (process.platform === 'darwin') rmSync(target, { force: true })
  }
}
