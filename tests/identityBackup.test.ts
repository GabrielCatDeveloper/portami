import { describe, it, expect } from 'vitest';
import {
  exportIdentityBackup,
  importIdentityBackup,
} from '@/io/identityBackup';
import { generateIdentityKeyPair, exportPrivateKeyJwk } from '@/crypto';

describe('identityBackup', () => {
  it('round-trips identity through passphrase encryption', async () => {
    const kp = await generateIdentityKeyPair();
    const privKeyJwk = await exportPrivateKeyJwk(kp.privKey);

    const backup = await exportIdentityBackup({
      pubKey: kp.pubKeyB64,
      anonId: 'TEST-TEST',
      privKeyJwk,
      passphrase: 'correct-horse-battery-staple',
    });

    expect(backup.formatVersion).toBe(1);
    expect(backup.pubKey).toBe(kp.pubKeyB64);
    expect(backup.anonId).toBe('TEST-TEST');

    const recoveredJwk = await importIdentityBackup({
      backup,
      passphrase: 'correct-horse-battery-staple',
    });

    expect(recoveredJwk).toEqual(privKeyJwk);
  });

  it('rejects wrong passphrase', async () => {
    const kp = await generateIdentityKeyPair();
    const privKeyJwk = await exportPrivateKeyJwk(kp.privKey);

    const backup = await exportIdentityBackup({
      pubKey: kp.pubKeyB64,
      anonId: 'TEST-TEST',
      privKeyJwk,
      passphrase: 'one-correct-passphrase',
    });

    await expect(
      importIdentityBackup({ backup, passphrase: 'wrong-passphrase' }),
    ).rejects.toThrow(/contraseña|dañado/i);
  });

  it('enforces minimum passphrase length', async () => {
    const kp = await generateIdentityKeyPair();
    const privKeyJwk = await exportPrivateKeyJwk(kp.privKey);

    await expect(
      exportIdentityBackup({
        pubKey: kp.pubKeyB64,
        anonId: 'TEST-TEST',
        privKeyJwk,
        passphrase: 'short',
      }),
    ).rejects.toThrow(/al menos 8/i);
  });

  it('rejects unsupported format version', async () => {
    const kp = await generateIdentityKeyPair();
    const privKeyJwk = await exportPrivateKeyJwk(kp.privKey);

    const backup = await exportIdentityBackup({
      pubKey: kp.pubKeyB64,
      anonId: 'TEST-TEST',
      privKeyJwk,
      passphrase: 'a-long-enough-passphrase',
    });

    await expect(
      importIdentityBackup({
        backup: { ...backup, formatVersion: 99 as any },
        passphrase: 'a-long-enough-passphrase',
      }),
    ).rejects.toThrow(/no soportado/i);
  });
});