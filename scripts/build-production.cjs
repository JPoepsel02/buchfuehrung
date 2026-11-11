const { spawnSync } = require('node:child_process')
const { dirname, join, resolve } = require('node:path')

const project = resolve(__dirname, '..')

function build(mode, root = project) {
  const executable = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js')
  const result = spawnSync(process.execPath, [executable, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, BUCHFUEHRUNG_BUILD_MODE: mode },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Build (${mode}) fehlgeschlagen (${result.status ?? result.signal}).`)
}

// electron-builder ruft diesen Hook vor dem Packen auf. So kann ein lokaler
// Vorschaubuild nie versehentlich als Produktions-App ausgeliefert werden.
module.exports = async (context) => build('production', context.appDir ?? project)

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--local')) {
    throw new Error('Erlaubt ist nur --local oder ein Produktionsbuild ohne Argumente.')
  }
  build(args[0] === '--local' ? 'local' : 'production')
}
