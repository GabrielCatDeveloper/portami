import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Base path for static hosting.
// - GitHub Pages (project site): "/portami/"
// - GitHub Pages (user site, custom domain, Netlify, Vercel, etc.): "/"
// Override at build time with: VITE_BASE_PATH="/" npm run build
const BASE_PATH = process.env.VITE_BASE_PATH ?? '/portami/';

// Backend API base URL. Empty in dev (uses MSW mocks).
// In production: VITE_API_BASE="https://your-server.deno.dev"
const API_BASE = process.env.VITE_API_BASE ?? '';

// Copy dist/index.html to dist/404.html after the build so GitHub Pages
// can serve it as a fallback for any unknown path. The SPA boots from
// 404.html and BrowserRouter reads the actual pathname to route correctly.
// This is the standard pattern for SPAs on GitHub Pages with clean URLs.
function ghPagesFallback(): Plugin {
  return {
    name: 'gh-pages-404-fallback',
    apply: 'build',
    async closeBundle() {
      const fs = await import('node:fs/promises');
      await fs.copyFile('dist/index.html', 'dist/404.html');
    },
  };
}

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    ghPagesFallback(),
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