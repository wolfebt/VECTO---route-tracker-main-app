import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function buildTestAliases() {
  if (!process.env.VITEST) return {}
  const aliases = {}
  const resolveWith = (pkgJsonRelPath, specifiers) => {
    try {
      const req = createRequire(path.resolve(process.cwd(), pkgJsonRelPath))
      for (const spec of specifiers) {
        try {
          aliases[spec] = req.resolve(spec)
        } catch {
          // Optional package unavailable
        }
      }
    } catch {
      // Manifest unavailable
    }
  }
  resolveWith('package.json', ['@google/genai'])
  resolveWith('functions/package.json', [
    'firebase-admin/app',
    'firebase-admin/firestore',
    'firebase-admin/messaging',
    'firebase-functions/params',
    'firebase-functions/v2/firestore',
    'firebase-functions/v2/https',
    'firebase-functions/v2/scheduler',
  ])
  return aliases
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [tailwindcss(), react()],
  test: {
    environment: 'jsdom',
    globals: false,
    env: { VITE_GOOGLE_MAPS_API_KEY: '', VITE_PUBLIC_APP_URL: '' },
    alias: buildTestAliases(),
    setupFiles: ['./TEST_SUITE/helpers/setupDomMocks.js'],
    include: ['TEST_SUITE/**/*.test.{js,jsx}'],
  },
})
