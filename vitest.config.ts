import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Standalone test config - no electron plugin (tests never build the main process).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node', // component tests opt into jsdom via a per-file pragma
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
      // Type-only and entrypoint/bootstrap files have no unit-testable logic.
      exclude: ['**/*.test.*', '**/*.d.ts', 'src/shared/types.ts', 'src/main.tsx'],
    },
  },
})
