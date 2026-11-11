import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/main/filePersistence.ts', 'src/main/storage.ts', 'src/main/bank.ts', 'src/renderer/src/writeQueue.ts', 'src/renderer/src/browserPersistence.ts', 'src/renderer/src/autoFetch.ts', 'src/renderer/src/accountLifecycle.ts', 'src/renderer/src/importResponse.ts', 'src/renderer/src/bookingRow.ts', 'src/renderer/src/bookingSelection.ts', 'src/renderer/src/bookingFilters.ts', 'src/renderer/src/report.ts', 'src/renderer/src/organizationReport.ts', 'src/renderer/src/presentation.ts', 'src/renderer/src/presentationData.ts', 'src/renderer/src/presentationPptx.ts'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
})
