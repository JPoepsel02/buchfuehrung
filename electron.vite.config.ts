import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // lib-fints ist ein reines ESM-Paket und wird deshalb in das
    // CommonJS-Main-Bundle eingebettet statt externalisiert.
    plugins: [externalizeDepsPlugin({ exclude: ['lib-fints'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
})
