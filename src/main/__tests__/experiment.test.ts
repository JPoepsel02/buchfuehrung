import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({ packaged: false, paths: {} as Record<string, string>, appPath: '' }))
const app = vi.hoisted(() => ({ getPath: vi.fn((name: string) => state.paths[name]), getAppPath: vi.fn(() => state.appPath),
  setPath: vi.fn(), setName: vi.fn(), get isPackaged() { return state.packaged } }))
vi.mock('electron', () => ({ app }))

const folders: string[] = []
let temporary: string
async function load(mode: 'local' | 'production' = 'local') {
  vi.stubGlobal('__BUCHFUEHRUNG_BUILD_MODE__', mode)
  return import('../experiment')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('BUCHFUEHRUNG_TEST_ROOT', '')
  temporary = mkdtempSync(join(tmpdir(), 'buchfuehrung-runtime-'))
  folders.push(temporary)
  state.packaged = false
  state.paths = { appData: join(temporary, 'appdata'), documents: join(temporary, 'documents'), downloads: join(temporary, 'downloads') }
  state.appPath = join(temporary, 'program')
  for (const folder of [...Object.values(state.paths), state.appPath]) mkdirSync(folder, { recursive: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('runtime paths', () => {
  test('retains the existing local data folder and isolated identity', async () => {
    const paths = await load()
    expect(paths.experimentUserData()).toBe(join(paths.experimentRoot, '.local-data', 'kassenwart'))
    expect(paths.experimentAppName).toBe('Buchführung · Lokal')
    paths.applyExperimentIdentity()
    expect(app.setPath).toHaveBeenCalledWith('userData', paths.experimentUserData())
  })

  test('uses the established production data path and a writable export default', async () => {
    const paths = await load('production')
    expect(paths.experimentUserData()).toBe(join(state.paths.appData, 'kassenwart'))
    expect(paths.experimentExportDirectory()).toBe(state.paths.downloads)
    expect(paths.experimentAppName).toBe('Buchführung')
    expect(paths.isLocalExperiment).toBe(false)
  })

  test('packaged local experiments stay outside ASAR and outside production data', async () => {
    state.packaged = true
    const paths = await load()
    expect(paths.experimentUserData()).toBe(join(state.paths.appData, 'kassenwart-lokal', 'kassenwart'))
    expect(paths.experimentUserData()).not.toContain('.asar')
    expect(paths.experimentUserData()).not.toBe(join(state.paths.appData, 'kassenwart'))
    expect(paths.experimentExportDirectory()).toBe(join(state.paths.appData, 'kassenwart-lokal', '.exports'))
  })

  test.each(['local', 'production'] as const)('isolates valid temporary test roots in %s builds', async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-runtime-'))
    folders.push(root)
    vi.stubEnv('BUCHFUEHRUNG_TEST_ROOT', root)
    const paths = await load(mode)
    expect(paths.experimentUserData()).toBe(join(root, 'kassenwart'))
  })

  test('rejects test roots that are not temporary directories with the required prefix', async () => {
    vi.stubEnv('BUCHFUEHRUNG_TEST_ROOT', state.paths.documents)
    const paths = await load('production')
    expect(() => paths.experimentUserData()).toThrow('Testdatenordner')
  })

  test('rejects a prefixed symlink pointing at the entire temporary directory', async () => {
    const link = join(temporary, 'buchfuehrung-e2e-not-isolated')
    symlinkSync(tmpdir(), link, 'dir')
    vi.stubEnv('BUCHFUEHRUNG_TEST_ROOT', link)
    const paths = await load('production')
    expect(() => paths.experimentUserData()).toThrow('Testdatenordner')
  })

  test('rejects a test-data symlink into the production data directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-runtime-'))
    folders.push(root)
    const production = join(state.paths.appData, 'kassenwart')
    mkdirSync(production)
    symlinkSync(production, join(root, 'kassenwart'), 'dir')
    vi.stubEnv('BUCHFUEHRUNG_TEST_ROOT', root)
    const paths = await load('production')
    expect(() => paths.experimentUserData()).toThrow('produktive Daten')
  })

  test('accepts a validated temporary root also used as the test process appData', async () => {
    const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-runtime-'))
    folders.push(root)
    state.paths.appData = root
    vi.stubEnv('BUCHFUEHRUNG_TEST_ROOT', root)
    const paths = await load('production')
    expect(paths.experimentUserData()).toBe(join(root, 'kassenwart'))
  })
})

describe('mirror folder boundaries', () => {
  test('permits packaged local mirrors beside the protected local data directory', async () => {
    state.packaged = true
    const paths = await load()
    expect(paths.allowedMirrorPath(paths.mirrorRoot)).toBe(true)
    expect(paths.allowedMirrorPath(join(paths.mirrorRoot, 'cloud-test'))).toBe(true)
    expect(paths.allowedMirrorPath(paths.experimentUserData())).toBe(false)
    expect(paths.allowedMirrorPath(join(paths.experimentUserData(), 'daten', 'backup'))).toBe(false)
    expect(paths.allowedMirrorPath(join(state.paths.appData, 'kassenwart-lokal'))).toBe(false)
    expect(paths.allowedMirrorPath(join(state.paths.appData, 'kassenwart'))).toBe(false)
  })

  test('keeps local backup choices under the experiment backup root', async () => {
    const paths = await load()
    expect(paths.allowedMirrorPath(join(paths.mirrorRoot, 'safe-child'))).toBe(true)
    expect(paths.allowedMirrorPath(state.paths.documents)).toBe(false)
    expect(paths.allowedMirrorPath(join(paths.mirrorRoot, '..', 'escape'))).toBe(false)
  })

  test('rejects a local mirror symlink into the active test data folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-runtime-'))
    folders.push(root)
    vi.stubEnv('BUCHFUEHRUNG_TEST_ROOT', root)
    const paths = await load()
    mkdirSync(paths.experimentUserData())
    symlinkSync(paths.experimentUserData(), paths.mirrorRoot, 'dir')
    expect(paths.allowedMirrorPath(paths.mirrorRoot)).toBe(false)
  })

  test('permits production cloud folders while rejecting data folders, their parents, and program folders', async () => {
    const paths = await load('production')
    expect(paths.allowedMirrorPath(join(state.paths.documents, 'Cloud', 'Buchführung'))).toBe(true)
    for (const target of [state.paths.appData, paths.experimentUserData(), join(paths.experimentUserData(), 'backups'),
      state.appPath, join(state.appPath, 'cloud'), temporary, '/', 'relative/path', '']) {
      expect(paths.allowedMirrorPath(target)).toBe(false)
    }
  })

  test('resolves symlinks before allowing a production backup folder', async () => {
    const paths = await load('production')
    const data = paths.experimentUserData()
    mkdirSync(data, { recursive: true })
    const link = join(state.paths.documents, 'looks-safe')
    symlinkSync(data, link, 'dir')
    expect(paths.allowedMirrorPath(link)).toBe(false)
    expect(paths.allowedMirrorPath(join(link, 'backups'))).toBe(false)
  })

  test('rejects any folder inside a packaged application bundle', async () => {
    state.appPath = join(temporary, 'Buchfuehrung.app', 'Contents', 'Resources', 'app.asar')
    mkdirSync(join(temporary, 'Buchfuehrung.app', 'Contents', 'Resources'), { recursive: true })
    writeFileSync(state.appPath, '')
    const paths = await load('production')
    expect(paths.allowedMirrorPath(join(temporary, 'Buchfuehrung.app', 'Contents', 'backup'))).toBe(false)
  })
})
