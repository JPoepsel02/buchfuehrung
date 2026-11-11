import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, test, vi } from 'vitest'

const source = readFileSync(resolve('scripts/build-production.cjs'), 'utf8')
const nativeRequire = createRequire(import.meta.url)

function load(args?: string[], status = 0) {
  const spawnSync = vi.fn().mockReturnValue({ status })
  const module = { exports: {} as unknown }
  const require = Object.assign((name: string) => name === 'node:child_process' ? { spawnSync }
    : name === 'node:path' ? nativeRequire('node:path').posix : nativeRequire(name), {
    resolve: () => '/project/node_modules/electron-vite/package.json',
    main: args ? module : {},
  })
  const process = { execPath: '/runtime/node', argv: ['/runtime/node', 'build-production.cjs', ...(args ?? [])], env: { BUCHFUEHRUNG_BUILD_MODE: 'local', PRESERVED_ENV: 'yes' } }
  new Script(source).runInNewContext({ require, module, process, __dirname: '/project/scripts' })
  return { hook: module.exports as (context: { appDir?: string }) => Promise<void>, spawnSync }
}

describe('production build entry point', () => {
  test('packaging always builds the production mode even after a local build', async () => {
    const { hook, spawnSync } = load()
    await hook({ appDir: '/isolated/project' })
    expect(spawnSync).toHaveBeenCalledWith('/runtime/node', ['/project/node_modules/electron-vite/bin/electron-vite.js', 'build'], {
      cwd: '/isolated/project', stdio: 'inherit', env: { BUCHFUEHRUNG_BUILD_MODE: 'production', PRESERVED_ENV: 'yes' },
    })
  })

  test('only an explicit local CLI flag builds the local preview', () => {
    const { spawnSync } = load(['--local'])
    expect(spawnSync.mock.calls[0][2].env.BUCHFUEHRUNG_BUILD_MODE).toBe('local')
    expect(load([]).spawnSync.mock.calls[0][2].env.BUCHFUEHRUNG_BUILD_MODE).toBe('production')
  })

  test('aborts packaging when compilation fails', async () => {
    const { hook } = load(undefined, 1)
    await expect(hook({})).rejects.toThrow('Build (production) fehlgeschlagen')
  })

  test('rejects unknown CLI switches', () => {
    expect(() => load(['--unsafe'])).toThrow('Erlaubt ist nur')
  })
})
