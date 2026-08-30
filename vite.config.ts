import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Base path for static hosting.
// - GitHub Pages (project site): "/portami/"
// - GitHub Pages (user site, custom domain, Netlify, Vercel, etc.): "/"
// Override at build time with: VITE_BASE_PATH="/" npm run build
const BASE_PATH = process.env.VITE_BASE_PATH ?? '/portami/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'portami',
        short_name: 'portami',
        description: 'Rastreo colaborativo y anónimo de buses y trens',
        theme_color: '#0f766e',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'es',
        start_url: BASE_PATH,
        scope: BASE_PATH,
        icons: [
          { src: `${BASE_PATH}icons/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: `${BASE_PATH}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: `${BASE_PATH}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        additionalManifestEntries: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
});