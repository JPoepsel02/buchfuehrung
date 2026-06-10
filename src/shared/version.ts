/** Versionsvergleich und Installer-Auswahl für den Update-Check. */

/**
 * Vergleicht zwei Versionen wie "1.2.0" oder "v1.10.3" numerisch je Stelle.
 * Ergebnis > 0 wenn a neuer ist als b, 0 bei Gleichstand, < 0 wenn älter.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

/**
 * Wählt aus den Release-Assets den passenden Installer für die laufende
 * Plattform: macOS bekommt die DMG passend zur CPU-Architektur, Windows
 * die Setup-EXE. Liefert null, wenn nichts passt.
 */
export function pickAsset(
  assets: ReleaseAsset[],
  platform: string,
  arch: string,
): ReleaseAsset | null {
  if (platform === 'darwin') {
    const dmgs = assets.filter((a) => a.name.toLowerCase().endsWith('.dmg'))
    if (arch === 'arm64') return dmgs.find((a) => a.name.toLowerCase().includes('arm64')) ?? null
    return dmgs.find((a) => !a.name.toLowerCase().includes('arm64')) ?? null
  }
  if (platform === 'win32') {
    return assets.find((a) => a.name.toLowerCase().endsWith('.exe')) ?? null
  }
  return null
}
