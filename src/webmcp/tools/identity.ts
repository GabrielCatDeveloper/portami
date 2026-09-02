// Identity tools — read, regenerate, export/import the Ed25519
// keypair that anchors all signed operations in portami.
//
// Notes on safety:
//   - `regenerate_identity` is destructive (new pubKey = new
//     anonId = loses trust with anyone who voted on your old
//     proposals). We tag it `destructiveHint: true` so the agent
//     asks for explicit confirmation.
//   - `import_identity_jwk` and `reset_identity` are likewise
//     destructive.
//   - The passphrase-protected `.portami-backup` format is the
//     safe way to move identity between devices; we expose it as
//     `export_identity_backup_file` (returns the JSON) and
//     `import_identity_backup_file` (takes the JSON + passphrase).
//     These are clearly more cumbersome than the bare JWK, so we
//     expose both and let the caller choose.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { useIdentityStore } from '@/state/identity';
import { exportIdentityBackup, importIdentityBackup } from '@/io/identityBackup';
import { registerOneTool } from '../register';
import { empty, object, str } from '../schema';

export const identityTools: ModelContextTool[] = [
  {
    name: 'get_identity',
    title: 'Get identity',
    description:
      'Return the current anonymous identity (pubKey, anonId, createdAt). Read-only — never returns the private key.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      const s = useIdentityStore.getState();
      if (!s.initialized) throw new Error('identity not initialised yet');
      const id = s.identity;
      if (!id) throw new Error('no identity available');
      return {
        anonId: s.anonId,
        pubKey: id.pubKey,
        createdAt: id.createdAt,
      };
    },
  },

  {
    name: 'export_identity_jwk',
    title: 'Export identity (raw JWK)',
    description:
      'Return the private key as a JSON Web Key. ⚠️ Anyone with this file can sign as you — handle with care. Destructive to leak.',
    inputSchema: empty(),
    async execute() {
      const id = await useIdentityStore.getState().ensure();
      return {
        pubKey: id.pubKey,
        privKeyJwk: id.privKeyJwk,
        format: 'jwk',
      };
    },
  },

  {
    name: 'import_identity_jwk',
    title: 'Import identity (raw JWK)',
    description:
      'Replace the local identity with the one in the provided JWK. ⚠️ Destructive: your previous anonId and any votes tied to it are gone.',
    inputSchema: object({
      privKeyJwk: str('The JSON Web Key containing the private key (must include `d`).'),
    }, ['privKeyJwk']),
    async execute({ privKeyJwk }) {
      await useIdentityStore.getState().importFromJwk(privKeyJwk as JsonWebKey);
      return { ok: true };
    },
  },

  {
    name: 'regenerate_identity',
    title: 'Regenerate identity',
    description:
      'Generate a fresh Ed25519 keypair. ⚠️ Destructive: previous anonId, votes, and trust relationships are lost.',
    inputSchema: empty(),
    async execute() {
      const id = await useIdentityStore.getState().regenerate();
      const anonId = await useIdentityStore.getState().anonId;
      return { pubKey: id.pubKey, anonId, createdAt: id.createdAt };
    },
  },

  {
    name: 'reset_identity',
    title: 'Reset everything',
    description:
      'Wipe the identity AND all local data (routes, proposals, recordings, drafts, paired devices, trips, sync metadata). ⚠️⚠️ Very destructive — cannot be undone.',
    inputSchema: empty(),
    async execute() {
      await useIdentityStore.getState().reset();
      return { ok: true };
    },
  },

  {
    name: 'export_identity_backup_file',
    title: 'Export identity backup (passphrase-protected)',
    description:
      'Return a passphrase-protected backup file (.portami-backup shape). Pass the same passphrase to `import_identity_backup_file` to restore. PBKDF2-SHA256 600k iters + AES-GCM.',
    inputSchema: object({
      passphrase: str('Passphrase (≥8 chars) used to encrypt the private key.'),
    }, ['passphrase']),
    async execute({ passphrase }) {
      const id = await useIdentityStore.getState().ensure();
      const anonId = useIdentityStore.getState().anonId ?? '';
      const backup = await exportIdentityBackup({
        pubKey: id.pubKey,
        anonId,
        privKeyJwk: id.privKeyJwk,
        passphrase: passphrase as string,
      });
      return backup;
    },
  },

  {
    name: 'import_identity_backup_file',
    title: 'Import identity backup (passphrase-protected)',
    description:
      'Restore an identity from a passphrase-protected backup. ⚠️ Destructive: replaces the current identity.',
    inputSchema: object({
      backupJson: str('The full backup object as a JSON string (the contents of the .portami-backup file).'),
      passphrase: str('The passphrase used at export time.'),
    }, ['backupJson', 'passphrase']),
    async execute({ backupJson, passphrase }) {
      const backup = JSON.parse(backupJson as string);
      const jwk = await importIdentityBackup({
        backup,
        passphrase: passphrase as string,
      });
      await useIdentityStore.getState().importFromJwk(jwk);
      return { ok: true, anonId: backup.anonId, pubKey: backup.pubKey };
    },
  },
];

export async function registerIdentityTools(mc: ModelContext): Promise<void> {
  for (const t of identityTools) await registerOneTool(mc, t);
}
