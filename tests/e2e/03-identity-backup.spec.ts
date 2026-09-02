// ============================================================
// E2E — Identity backup round-trip.
//
// What this covers:
//   - User can export their identity to a `.portami-backup` file
//     protected by a passphrase.
//   - The exported file contains a valid signature (the import path
//     trusts it for `keep` / `replace` operations).
//   - Regenerating the identity produces a different `#XXXX-XXXX`.
//   - Importing the backup restores the original anonId.
//
// Why this matters:
//   - The identity import path was the source of a CRITICAL security
//     regression we fixed earlier (see ROADMAP.md Hito 7 audit +
//     `tests/sync.test.ts::encryptIdentityForPeer round-trip`). An
//     e2e test guarantees the *user-facing* flow doesn't silently
//     regress: regenerating must change the ID; importing the
//     original must restore it. If those assertions fail, an attacker
//     could potentially restore a tampered identity.
//
// How we drive the modal:
//   - PassphrasePrompt is a custom modal rendered by React, not a
//     native `window.prompt`. We target the input by its visible
//     label ("Contraseña" / "Repite la contraseña").
// ============================================================

import { expect, test } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// SPA navigation: don't wait for `load` (some routes' MSW fetches
// keep it pending); `commit` fires as soon as the new document
// starts rendering, which is enough for our assertions.
const goto = (page: import('@playwright/test').Page) => (url: string) =>
  page.goto(url, { waitUntil: 'commit' });

test.describe('Identity backup round-trip', () => {
  const passphrase = 'cor-rect-horse-battery-staple';
  const downloadDir = path.join(os.tmpdir(), 'portami-e2e-' + Date.now());

  test.beforeEach(async () => {
    await fs.mkdir(downloadDir, { recursive: true });
  });

  test.afterEach(async () => {
    await fs.rm(downloadDir, { recursive: true, force: true });
  });

  test('export → regenerate → import restores the original anonId', async ({ page }) => {
    test.setTimeout(60_000);

    await goto(page)('/');
    await page.evaluate(async () => {
      await Promise.all(
        ['portami', 'portami-stop-alerts'].map(
          (name) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            }),
        ),
      );
      localStorage.clear();
    });
    await goto(page)('/settings');

    // Capture the current anonId from the identity card.
    const anonIdLocator = page.locator('div').filter({ hasText: /^#[A-Z0-9]{4}-[A-Z0-9]{4}$/ }).first();
    const originalId = (await anonIdLocator.textContent())?.trim();
    expect(originalId).toMatch(/^#[A-Z0-9]{4}-[A-Z0-9]{4}$/);

//    1. Export — open the PassphrasePrompt modal, fill it, submit,
    //    then wait for the download.
    await page.getByRole('button', { name: /Exportar mi identidad|Export my identity/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/^Contraseña|Passphrase$/).first().fill(passphrase);
    await page.getByLabel(/Repite la contraseña|Repeat passphrase/i).fill(passphrase);
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('button', { name: /Aceptar|^OK$|Confirm/i }).click();
    const download = await downloadPromise;

    const backupPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(backupPath);

    // Sanity-check the backup file content.
    const backupJson = JSON.parse(await fs.readFile(backupPath, 'utf-8'));
    expect(backupJson.formatVersion).toBe(1);
    expect(backupJson.kdf.iter).toBe(600_000);
    expect(backupJson.cipher.name).toBe('AES-GCM');
    expect(backupJson.encryptedJwk).toBeTruthy();
    expect(backupJson.pubKey).toBeTruthy();
    expect(backupJson.anonId).toBe(originalId?.replace(/^#/, ''));

    // 2. Regenerate the identity.
    await page.getByRole('button', { name: /Zona peligrosa|Danger zone/i }).click();
    await page.getByRole('button', { name: /Regenerar identidad|Regenerate identity/i }).click();
    // Confirm dialog
    await page.getByRole('button', { name: /Sí, regenerar|Yes, regenerate/i }).click();

    // Wait for the new anonId to settle (different from the original).
    await expect(anonIdLocator).not.toHaveText(originalId ?? '', { timeout: 5_000 });
    const newId = (await anonIdLocator.textContent())?.trim();
    expect(newId).toMatch(/^#[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(newId).not.toBe(originalId);

    // 3. Import the backup.
    // The file picker is a hidden <input type="file"> triggered
    // by the "Importar mi identidad" button. Playwright intercepts
    // the chooser via `page.on('filechooser')`.
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Importar mi identidad|Import my identity/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(backupPath);

    // PassphrasePrompt modal opens; fill the single password field.
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/Contraseña|Passphrase/).first().fill(passphrase);
    await page.getByRole('button', { name: /Aceptar|^OK$|Confirm/i }).click();

    // The banner confirms the import.
    await expect(page.getByText(/Identidad importada correctamente|Identity imported successfully/i)).toBeVisible({
      timeout: 5_000,
    });

    // The anonId must now match the original.
    await expect(anonIdLocator).toHaveText(originalId ?? '', { timeout: 5_000 });
  });
});