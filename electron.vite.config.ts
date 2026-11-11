import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig(({ command }) => {
  const mode = command === 'build' && process.env.BUCHFUEHRUNG_BUILD_MODE === 'production' ? 'production' : 'local'
  const define = { __BUCHFUEHRUNG_BUILD_MODE__: JSON.stringify(mode) }
  const output = mode === 'production' ? '.production-out' : 'out'
  return {
  main: {
    define,
    build: { outDir: resolve(__dirname, output, 'main') },
    // lib-fints ist ein reines ESM-Paket und wird deshalb in das
    // CommonJS-Main-Bundle eingebettet statt externalisiert.
    plugins: [externalizeDepsPlugin({ exclude: ['lib-fints'] })],
  },
  preload: {
    define,
    build: { outDir: resolve(__dirname, output, 'preload') },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    define,
    build: { outDir: resolve(__dirname, output, 'renderer') },
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  }
})
