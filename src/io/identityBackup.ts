// ============================================================
// Identity backup / restore — encrypted .portami-backup files
// Format:
//   {
//     formatVersion: 1,
//     exportedAt: <unix ms>,
//     pubKey: "<b64url>",
//     anonId: "XXXX-YYYY",
//     kdf: { name: "PBKDF2", iter: 600000, salt: "<b64url>" },
//     cipher: { name: "AES-GCM", nonce: "<b64url>" },
//     encryptedJwk: "<b64url>"
//   }
//
// The private key JWK is encrypted with AES-GCM, key derived from the user
// passphrase + salt via PBKDF2-SHA256 (600k iterations, OWASP 2023).
// ============================================================

import {
  deriveKeyFromPassphrase,
  aesEncrypt,
  aesDecrypt,
  bytesToBase64Url,
  base64UrlToBytes,
} from '@/crypto';

export type BackupFile = {
  formatVersion: 1;
  exportedAt: number;
  pubKey: string;
  anonId: string;
  kdf: { name: 'PBKDF2'; iter: number; salt: string };
  cipher: { name: 'AES-GCM'; nonce: string };
  encryptedJwk: string;
};

export async function exportIdentityBackup(opts: {
  pubKey: string;
  anonId: string;
  privKeyJwk: JsonWebKey;
  passphrase: string;
}): Promise<BackupFile> {
  if (opts.passphrase.length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyFromPassphrase(opts.passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(opts.privKeyJwk));
  const { ciphertext, nonce } = await aesEncrypt(key, plaintext);
  return {
    formatVersion: 1,
    exportedAt: Date.now(),
    pubKey: opts.pubKey,
    anonId: opts.anonId,
    kdf: { name: 'PBKDF2', iter: 600000, salt: bytesToBase64Url(salt) },
    cipher: { name: 'AES-GCM', nonce: bytesToBase64Url(nonce) },
    encryptedJwk: bytesToBase64Url(ciphertext),
  };
}

export async function importIdentityBackup(opts: {
  backup: BackupFile;
  passphrase: string;
  expectedPubKey?: string;
}): Promise<JsonWebKey> {
  if (opts.backup.formatVersion !== 1) {
    throw new Error('Formato de backup no soportado');
  }
  const salt = base64UrlToBytes(opts.backup.kdf.salt);
  const key = await deriveKeyFromPassphrase(opts.passphrase, salt);
  const ct = base64UrlToBytes(opts.backup.encryptedJwk);
  const nonce = base64UrlToBytes(opts.backup.cipher.nonce);
  let plaintext: Uint8Array;
  try {
    plaintext = await aesDecrypt(key, ct, nonce);
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado');
  }
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Archivo corrupto: contenido no es un JWK válido');
  }
  if (opts.expectedPubKey && opts.backup.pubKey !== opts.expectedPubKey) {
    throw new Error(
      'La pubKey del backup no coincide con este dispositivo. ¿Seguro que es tu backup?',
    );
  }
  return jwk;
}

export function downloadBackup(backup: BackupFile, anonId: string) {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portami-identidad-${anonId}-${new Date().toISOString().slice(0, 10)}.portami-backup`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickBackupFile(): Promise<BackupFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.portami-backup,.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        resolve(json as BackupFile);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}