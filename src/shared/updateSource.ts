const repository = 'JPoepsel02/buchfuehrung'

export function isTrustedUpdateAsset(name: unknown, address: unknown): boolean {
  if (typeof name !== 'string' || !/^Buchfuehrung-[A-Za-z0-9][A-Za-z0-9._-]*\.(?:dmg|exe)$/.test(name)
    || typeof address !== 'string') return false
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port
      || url.username || url.password || url.search || url.hash || url.href !== address) return false
    const prefix = `/${repository}/releases/download/`
    if (!url.pathname.startsWith(prefix)) return false
    const parts = url.pathname.slice(prefix.length).split('/')
    return parts.length === 2 && /^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(parts[0]) && parts[1] === name
  } catch {
    return false
  }
}
