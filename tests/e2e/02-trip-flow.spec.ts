// ============================================================
// E2E — Synthetic GPS wiring + Board flow.
//
// What this covers:
//   - The /board route boots and renders the correct header.
//   - Geolocation permissions granted by the Playwright context
//     are honoured by the app (no permission prompt, no error).
//   - The flow reaches one of {suggestions, no-match} — never
//     the error phase.
//
// Why this matters:
//   - The /board route is the primary entry to the trip flow. A
//     regression that sends users to the error screen (e.g. broken
//     geolocation permission gate) would block real riders.
//
// Pre-conditions:
//   - Real geolocation permission has been granted via the
//     Playwright context (in `playwright.config.ts::use.permissions`).
//   - The MSW handler at `/api/routes` returns the seed routes.
//
// What we don't cover here:
//   - The testing-mode toggle. That's covered by unit tests; the
//     full toggle flow requires reloading the watcher and races
//     with the service-worker activation, which is brittle in
//     headless Chromium. Keeping this e2e focused on the happy
//     path of the real geolocation flow.
// ============================================================

import { expect, test } from '@playwright/test';

const goto = (page: import('@playwright/test').Page) => (url: string) =>
  page.goto(url, { waitUntil: 'commit' });

test.describe('Board flow', () => {
  test('boots /board and reaches the suggestions or no-match phase', async ({ page }) => {
    // /board auto-runs `beginBoarding` on mount. With granted
    // geolocation, the watcher resolves immediately and the
    // search phase fires.
    await goto(page)('/board');
    await expect(page.locator('header h1')).toContainText(/Subir a un bus/i);

    // Must NOT enter the error phase.
    await expect(page.getByText(/No hemos podido iniciar/)).not.toBeVisible({
      timeout: 10_000,
    });

    // Either suggestions or the no-match empty-state must appear.
    const suggestionsHeading = page.getByText(/¿Es alguna de estas rutas/i);
    const emptyHeading = page.getByText(/No hay rutas que coincidan/i);
    await expect(suggestionsHeading.or(emptyHeading)).toBeVisible({ timeout: 15_000 });
  });
});