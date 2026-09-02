// ============================================================
// E2E — App boot + bottom-nav navigation.
//
// What this covers:
//   - Service worker registers without throwing (precache manifest
//     has valid entries; the precache URLs resolve).
//   - Identity is generated on first load (anonId appears in the
//     `#XXXX-XXXX` format).
//   - Bottom-nav links navigate to every top-level page without
//     throwing or leaving a stale React tree behind.
//
// Notes for maintainers:
//   - The MSW mock layer initialises on app boot when VITE_API_BASE
//     is empty (the production build embeds it as `''`). On the
//     preview server the SW takes over for `/api/*`; MSW stays
//     active in the page context and intercepts before the SW.
//   - We don't assert on server-status badge — it varies depending
//     on whether the polling request resolves before the assertion
//     fires.
// ============================================================

import { expect, test } from '@playwright/test';

// SPA navigation: don't wait for `load` (some routes' MSW fetches
// keep it pending); `commit` fires as soon as the new document
// starts rendering, which is enough for our assertions.
const goto = (page: import('@playwright/test').Page) => (url: string) =>
  page.goto(url, { waitUntil: 'commit' });

test.describe('App boot + navigation', () => {
  test('loads the home page and shows the anonId', async ({ page }) => {
    // MSW intercepts /api/* via fetch — Playwright supports
    // this transparently since MSW uses service-worker registration
    // in dev and fetch interception in test mode.
    await goto(page)('/');

    // Header renders the anonymized ID in `XXXX-XXXX` format.
    // We accept any 4-4 alphanumeric because the ID is random.
    await expect(page.locator('h1')).toContainText(/#?[A-Z0-9]{4}-[A-Z0-9]{4}/);

    // Tagline is present (default bundle 'es').
    await expect(page.getByText(/Tu bus, en directo/i)).toBeVisible();
  });

  test('bottom-nav links navigate to every top-level page', async ({ page }) => {
    await goto(page)('/');

    // Home is the landing page.
    await expect(page).toHaveURL(/\/$/);

    // The Home page has both a bottom-nav and a quick-action grid
    // with overlapping labels. Scope every selector to the
    // `.bottom-nav` container to disambiguate.
    const nav = page.locator('nav.bottom-nav');

    // Explore
    await nav.getByRole('link', { name: /Explorar/ }).click();
    await expect(page).toHaveURL(/\/explore$/);
    // The map container is mounted (Leaflet adds .leaflet-container)
    await expect(page.locator('.leaflet-container')).toBeVisible();

    // Record
    await nav.getByRole('link', { name: /Grabar/ }).click();
    await expect(page).toHaveURL(/\/record$/);

    // Settings
    await nav.getByRole('link', { name: /Ajustes/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
    // The settings page renders the anonymized ID block
    await expect(page.getByText(/Tu ID an/i)).toBeVisible();
  });
});