import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built renderer loads correctly from file:// in Electron.
  base: './',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // jsforce is CJS with heavy deps — keep it external, resolved at runtime from node_modules
              external: ['jsforce', 'electron'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
