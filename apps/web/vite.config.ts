import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Shared shell uses the host's @/ adapters. Resolve the web implementation first.
export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'huilu-platform',
      enforce: 'pre',
      resolveId(id) {
        if (!id.startsWith('@/')) return
        for (const base of ['./', '../../packages/app-shell/src/']) {
          for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
            const path = fileURLToPath(new URL(base + id.slice(2) + suffix, import.meta.url))
            if (existsSync(path)) return path
          }
        }
      },
    },
    tailwindcss(),
  ],
})
