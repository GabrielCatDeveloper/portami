// ============================================================
// Playwright config for end-to-end tests.
//
// Boots `vite preview` (production build) before each run, serves
// the built PWA at http://localhost:4173, runs the spec files in
// tests/e2e/, and tears the server down on exit.
//
// Browser support:
//   - Chromium is the only project we run in CI. WebKit/Firefox can
//     be added later by extending the `projects` array, but the
//     cost of installing their binaries outweighs the marginal
//     coverage for an iOS/Android-first PWA.
//
// Permissions:
//   - geolocation: many e2e flows (Board, Trip, synthetic GPS) need
//     to grant geolocation without prompts.
//   - notifications: the "trip started" notification flow requires
//     permission. (Some sandbox configurations deny this even when
//     requested — tests that depend on notifications should mark
//     themselves appropriately.)
//
// Why we don't run against `vite dev`:
//   - MSW only initialises when the app boots in dev/test mode; the
//     production build uses real /api/* paths and a real /health
//     endpoint, so e2e coverage should hit the same code the user
//     does in production.
//
// Base path:
//   - `npm run preview` serves the static dist/ at the configured
//     VITE_BASE_PATH (default `/portami/`). For e2e we want root,
//     so we override with `VITE_BASE_PATH=/` and the preview server
//     is reached at http://localhost:4173/.
// ============================================================

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // E2E specs share IndexedDB across pages in the same browser
  // context, and several specs rely on a clean starting state
  // (wiped IDB + localStorage in beforeEach). Running multiple
  // workers in parallel races on the singleton `portami` DB and
  // the strict-port preview server, producing flaky failures.
  // Sequential is the right default for a small e2e suite; if the
  // suite grows past ~10 specs, switch to per-spec projects with
  // their own browser context.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI']
    ? [['list'], ['github']]
    : [['list']],

  use: {
    baseURL: BASE_URL,
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
  // We test the GPS path heavily; grant geolocation so the
  // navigator.geolocation.watchPosition calls succeed.
  permissions: ['geolocation'],
  geolocation: { latitude: 40.417, longitude: -3.7035 }, // Sol, Madrid
  locale: 'es-ES',
  timezoneId: 'Europe/Madrid',
  // The PWA's MSW-driven `/api/*` fetches and the ServiceWorker
  // navigation handler keep the `load` event from firing reliably
  // for some routes (e.g. /board). `commit` fires as soon as the
  // new document starts rendering, which is the right semantic
  // for SPA navigation in tests.
  navigationTimeout: 15_000,
  // Each spec gets its own isolated context (default), but inside
  // a single spec we still share cookies + storage across tests.
  // Specs that need a clean slate must explicitly wipe IDB +
  // localStorage in `beforeEach`.
  storageState: undefined,
  serviceWorkers: 'allow',
},

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Build first with VITE_BASE_PATH=/ so the SPA is mounted at
    // the root path (matches our baseURL). The CI workflow does the
    // same; locally you can run `VITE_BASE_PATH=/ npm run build`
    // followed by `npm run preview` for the same effect.
    command: 'VITE_BASE_PATH=/ npm run build && VITE_BASE_PATH=/ npm run preview',
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});