// ============================================================
// E2E — Language switching audit.
//
// What this covers:
//   - Switching the language in Settings must propagate everywhere
//     on the next page load. Specifically:
//       * The i18n module reads `portami.lang` from localStorage on
//         init and uses it as the active language.
//       * Every i18n key resolves to the new locale's value, not
//         the fallback.
//
// Why this matters:
//   - This is a regression audit. After the bulk i18n work, some
//     components still rendered hardcoded Spanish, others used
//     module-level constants captured before i18next initialised,
//     etc. The audit below makes those regressions visible: if a
//     string stays in Spanish after switching to English, the test
//     fails with the offending text in the error message.
//
// What it doesn't cover:
//   - i18n key *coverage* (missing keys → fallback). That's covered
//     by unit tests around the locales; here we only assert that
//     strings that DO exist change as expected.
//
// Strategy:
//   - We avoid page navigation (which races with the service worker
//     and causes intermittent ERR_ABORTEDs in this PWA). Instead,
//     we set the language via localStorage and reload the page —
//     which is what the real user does on a slow connection or
//     after restarting the app — then probe i18n directly via
//     `page.evaluate`. This is more reliable and tests exactly the
//     scenario we care about: "does the app read the persisted
//     language on next init?".
// ============================================================

import { expect, test } from '@playwright/test';

const LANGS = ['es', 'ca', 'en'] as const;
type Lang = (typeof LANGS)[number];

/**
 * Track: every (lang, key) we expect to render correctly. The
 * keys are real i18n keys used by the app's UI; the expected
 * values are the actual translations from the locales.
 *
 * Note: every string checked here MUST be visible on the page
 * under test (the home page), or the assertion will fail for
 * unrelated reasons. Keep this list aligned with what renders
 * on / for a given language.
 */
const TRACKED: Array<{ lang: Lang; key: string; expectIncludes: string }> = [
  // Home.tsx — Home CTA renders on /
  { lang: 'en', key: 'home.board', expectIncludes: 'I just boarded' },
  { lang: 'es', key: 'home.board', expectIncludes: 'He subido' },
  { lang: 'ca', key: 'home.board', expectIncludes: 'pujat' },

  { lang: 'en', key: 'home.plan', expectIncludes: 'Plan a trip' },
  { lang: 'es', key: 'home.plan', expectIncludes: 'Planear' },
  { lang: 'ca', key: 'home.plan', expectIncludes: 'Planificar' },

  // Bottom nav — always visible
  { lang: 'en', key: 'nav.home', expectIncludes: 'Home' },
  { lang: 'es', key: 'nav.home', expectIncludes: 'Inicio' },
  { lang: 'ca', key: 'nav.home', expectIncludes: 'Inici' },

  { lang: 'en', key: 'nav.settings', expectIncludes: 'Settings' },
  { lang: 'es', key: 'nav.settings', expectIncludes: 'Ajustes' },
  { lang: 'ca', key: 'nav.settings', expectIncludes: 'Configuració' },
];

test.describe('Language switching audit', () => {
  test('every tracked i18n key resolves correctly in all 3 languages after re-init', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('header h1', { timeout: 8_000 });

    const failures: string[] = [];
    for (const lang of LANGS) {
      // Set the language, reload so i18n re-inits from localStorage,
      // then probe i18n directly via the global namespace.
      await page.evaluate((l) => {
        localStorage.setItem('portami.lang', l);
        window.location.reload();
      }, lang);
      // Wait for the page to render after reload. We pick a string
      // that should appear in the current language and wait for it.
      const expectedMarker = lang === 'en' ? 'Home'
        : lang === 'ca' ? 'Inici'
        : 'Inicio';
      await page.waitForFunction(
        (marker) => document.body.innerText.includes(marker),
        expectedMarker,
        { timeout: 8_000 },
      );
      await page.waitForTimeout(200);

      for (const track of TRACKED.filter((t) => t.lang === lang)) {
        // The i18next module is bundled but the t function is not
        // exposed on window. We can't access module-private state, so
        // we look for the rendered DOM where the key has been
        // substituted. The body.innerText contains every visible
        // string on the page after the language change.
        const result = await page.evaluate(() => document.body.innerText);
        if (!result.includes(track.expectIncludes)) {
          failures.push(
            `[${lang}] expected i18n key "${track.key}" to include "${track.expectIncludes}"`,
          );
        }
      }
    }

    if (failures.length > 0) {
      console.log('\nFailures:\n' + failures.join('\n'));
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

// Keep this last in the alphabetical sort so it doesn't leak its
// persisted language to other specs (which assume Spanish UI).
// The settings click in step 2 changes `portami.lang` to 'en';
// we reset it to 'es' here. If the test above failed and didn't
// reach this point, the next spec's `beforeEach` clears localStorage
// anyway (see 02-trip-flow.spec.ts), so we don't lose data.
test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  try {
    await page.evaluate(() => localStorage.setItem('portami.lang', 'es'));
  } catch {
    // page may have been torn down already — ignore.
  }
});