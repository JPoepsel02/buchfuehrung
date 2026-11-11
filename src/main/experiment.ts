import { app } from 'electron'
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { isLocalExperiment } from '../shared/runtime'

export { isLocalExperiment } from '../shared/runtime'

export const experimentRoot = resolve(__dirname, '../..')
const archivedLocalBuild = app.isPackaged || /(?:^|[\\/])[^\\/]+\.asar(?:[\\/]|$)/i.test(experimentRoot)

function actualPath(path: string): string {
  const target = resolve(path)
  let parent = target
  while (!existsSync(parent)) {
    const next = dirname(parent)
    if (next === parent) return target
    parent = next
  }
  return resolve(realpathSync(parent), relative(parent, target))
}

function inside(parent: string, target: string): boolean {
  const suffix = relative(parent, target)
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

function testRoot(): string | null {
  const value = process.env.BUCHFUEHRUNG_TEST_ROOT
  if (!value) return null
  const root = resolve(value)
  if (!basename(root).startsWith('buchfuehrung-e2e-') || !existsSync(root)
    || !statSync(root).isDirectory() || !basename(actualPath(root)).startsWith('buchfuehrung-e2e-')
    || actualPath(root) === actualPath(tmpdir()) || !inside(actualPath(tmpdir()), actualPath(root))) {
    throw new Error('Ungültiger temporärer Testdatenordner.')
  }
  return root
}

function localWorkspace(): string {
  return testRoot() ?? (archivedLocalBuild ? join(app.getPath('appData'), 'kassenwart-lokal') : experimentRoot)
}

export const mirrorRoot = isLocalExperiment ? join(localWorkspace(), '.local-backups') : app.getPath('documents')

function isolatedDirectory(workspace: string, path: string, temporaryOverride = false): string {
  const target = actualPath(path)
  const productionData = actualPath(join(app.getPath('appData'), 'kassenwart'))
  const syntheticAppData = temporaryOverride && actualPath(workspace) === actualPath(app.getPath('appData'))
  if (!inside(actualPath(workspace), target) || (!syntheticAppData && inside(productionData, target))) {
    throw new Error('Der lokale Datenordner darf nicht auf produktive Daten verweisen.')
  }
  return path
}

export function experimentUserData(): string {
  const isolated = testRoot()
  if (isolated) return isolatedDirectory(isolated, join(isolated, 'kassenwart'), true)
  if (!isLocalExperiment) return join(app.getPath('appData'), 'kassenwart')
  if (archivedLocalBuild) return isolatedDirectory(localWorkspace(), join(localWorkspace(), 'kassenwart'))
  return isolatedDirectory(experimentRoot, join(experimentRoot, '.local-data', 'kassenwart'))
}

export function allowedMirrorPath(path: string): boolean {
  if (!path || !isAbsolute(path) || /[\x00-\x1f]/.test(path)) return false
  try {
    const target = actualPath(path)
    if (isLocalExperiment) {
      const data = actualPath(experimentUserData())
      return inside(actualPath(localWorkspace()), actualPath(mirrorRoot)) && inside(actualPath(mirrorRoot), target)
        && !inside(data, target) && !inside(target, data)
    }
    if (target === parse(target).root) return false
    const protectedPaths = [experimentUserData(), programDirectory(app.getAppPath()), programDirectory(experimentRoot)]
    return protectedPaths.every((value) => {
      const protectedPath = actualPath(value)
      return !inside(protectedPath, target) && !inside(target, protectedPath)
    })
  } catch {
    return false
  }
}

function programDirectory(path: string): string {
  const bundle = path.match(/^(.*?\.app)(?:[\\/]|$)/i)?.[1]
  return bundle ?? (/\.asar$/i.test(path) ? dirname(dirname(path)) : path)
}

export function experimentExportDirectory(): string {
  if (!isLocalExperiment) return app.getPath('downloads')
  const directory = isolatedDirectory(localWorkspace(), join(localWorkspace(), '.exports'))
  mkdirSync(directory, { recursive: true })
  return directory
}

export const experimentAppName = isLocalExperiment ? 'Buchführung · Lokal' : 'Buchführung'
export function applyExperimentIdentity(): void {
  app.setPath('userData', experimentUserData())
  app.setName(experimentAppName)
}
