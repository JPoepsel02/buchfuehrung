import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/** Browser-Vorschau des Renderers (ohne Electron) – für UI-Tests. */
export default defineConfig({
  define: { __BUCHFUEHRUNG_BUILD_MODE__: JSON.stringify('local') },
  base: './',
  root: resolve(__dirname, 'src/renderer'),
  build: { outDir: resolve(__dirname, '.web-dist'), emptyOutDir: true },
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
