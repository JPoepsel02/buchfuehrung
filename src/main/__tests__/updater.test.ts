import { afterEach, describe, expect, test, vi } from 'vitest'

const app = vi.hoisted(() => ({ getVersion: () => '1.16.0', relaunch: vi.fn(), exit: vi.fn(), quit: vi.fn() }))
const processTools = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }))
vi.mock('electron', () => ({ app }))
vi.mock('node:child_process', () => processTools)

import { checkForUpdate, downloadAndInstall } from '../updater'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

const filename = process.platform === 'win32' ? 'Buchfuehrung-1.17.0-x64.exe'
  : `Buchfuehrung-1.17.0-${process.arch}.dmg`
const address = `https://github.com/JPoepsel02/buchfuehrung/releases/download/v1.17.0/${filename}`

describe('updater boundary', () => {
  test('returns an available installer only from the official release source', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      tag_name: 'v1.17.0', body: 'Änderungen', assets: [{ name: filename, browser_download_url: address }],
    }) }))
    const result = await checkForUpdate()
    expect(result.latest).toBe('1.17.0')
    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(result).toMatchObject({ hasUpdate: true, assetName: filename, assetUrl: address })
    }
  })

  test('filters untrusted installers out of the release response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      tag_name: 'v1.17.0', assets: [{ name: filename, browser_download_url: 'https://malware.example/setup.exe' }],
    }) }))
    expect(await checkForUpdate()).toMatchObject({ hasUpdate: false, assetName: undefined, assetUrl: undefined })
  })

  test('rejects remote API failures visibly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(checkForUpdate()).rejects.toThrow('HTTP 503')
  })

  test('never fetches or executes an arbitrary URL supplied to the installer', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await downloadAndInstall(null, { current: '1.16.0', latest: '1.17.0', hasUpdate: true,
      assetName: filename, assetUrl: 'https://malware.example/setup.exe' })).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
    expect(processTools.spawn).not.toHaveBeenCalled()
    expect(processTools.spawnSync).not.toHaveBeenCalled()
  })

  test('rejects missing installers without side effects', async () => {
    expect(await downloadAndInstall(null, { current: '1.16.0', latest: '1.17.0', hasUpdate: true })).toEqual({ ok: false, error: 'Kein Installer gefunden.' })
  })
})
