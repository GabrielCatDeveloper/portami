import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Identity,
  Route,
  RouteEditProposal,
  Recording,
  DraftRoute,
  PairedDevice,
  Trip,
  GPSSample,
  OutgoingTripShare,
  IncomingTripShare,
} from '@/api/types';

// ============================================================
// Schema
// ============================================================
interface PortamiDB extends DBSchema {
  // User identity (single record)
  identity: {
    key: 'self';
    value: Identity;
  };

  // Device key (single record) — used for WebRTC pairing
  deviceKey: {
    key: 'self';
    value: { deviceId: string; pubKey: string; privKeyJwk: JsonWebKey; createdAt: number };
  };

  // All routes user has ever seen (cache + own)
  routes: {
    key: string; // routeId
    value: Route & { isMine: boolean; isFavorite: boolean; cachedAt: number };
    indexes: { 'by-favorite': 'boolean'; 'by-mine': 'boolean' };
  };

  // All proposals seen by user (cache + own)
  proposals: {
    key: string; // proposalId
    value: RouteEditProposal & { myVote?: 'approve' | 'reject' };
    indexes: { 'by-route': string; 'by-status': string };
  };

  // Raw recordings before trimming
  recordings: {
    key: string; // recordingId
    value: Recording;
    indexes: { 'by-createdAt': number };
  };

  // Drafts in edit (RouteReview)
  draftRoutes: {
    key: string; // recordingId
    value: DraftRoute;
  };

  // WebRTC paired devices
  pairedDevices: {
    key: string; // deviceId
    value: PairedDevice;
    indexes: { 'by-pairedAt': number };
  };

  // Pending sync conflicts
  conflicts: {
    key: string; // entityId
    value: { entityId: string; ours: unknown; theirs: unknown; entityType: string; createdAt: number };
  };

  // Import history
  importHistory: {
    key: number; // autoincrement
    value: { id?: number; ts: number; file: string; imported: number; skipped: number; replaced: number; merged: number };
    indexes: { 'by-ts': number };
  };

  // Sync metadata
  syncMeta: {
    key: 'self';
    value: { lastSyncTs: number; lastSyncWithDeviceIds: string[] };
  };

  // Trip state — active and recent trips
  trips: {
    key: string; // tripId
    value: Trip;
    indexes: { 'by-route': string; 'by-startedAt': number };
  };

  // Pending GPS samples awaiting upload (offline queue)
  pendingSamples: {
    key: string; // composite: tripId-ts
    value: { tripId: string; ts: number; sample: GPSSample };
    indexes: { 'by-trip': string };
  };

  // Outgoing trip shares (Hito 7 — Fase 2): trips I sent to friends.
  // One row per share, TTL 7d (enforced by useStorageJanitor).
  outgoingTripShares: {
    key: string; // tripShareId
    value: OutgoingTripShare;
    indexes: { 'by-startedAt': number; 'by-trip': string };
  };

  // Incoming trip shares (Hito 7 — Fase 2): trips friends are sharing with me.
  // Keyed by sender's anonId — at most one active share per sender.
  // TTL 7d after `endedAt` (also enforced by janitor).
  incomingTripShares: {
    key: string; // fromAnonId
    value: IncomingTripShare;
    indexes: { 'by-startedAt': number };
  };
}

const DB_NAME = 'portami';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<PortamiDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<PortamiDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PortamiDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // The `upgrade` callback fires for every version transition
        // (oldVersion → newVersion). We branch on the OLD version so
        // each migration step runs exactly once.
        if (oldVersion < 1) {
          // ---- v0 → v1: initial schema ----
          // identity
          if (!db.objectStoreNames.contains('identity')) {
            db.createObjectStore('identity');
          }
          if (!db.objectStoreNames.contains('deviceKey')) {
            db.createObjectStore('deviceKey');
          }

          // routes
          if (!db.objectStoreNames.contains('routes')) {
            const store = db.createObjectStore('routes', { keyPath: 'id' });
            store.createIndex('by-favorite', 'isFavorite');
            store.createIndex('by-mine', 'isMine');
          }

          // proposals
          if (!db.objectStoreNames.contains('proposals')) {
            const store = db.createObjectStore('proposals', { keyPath: 'id' });
            store.createIndex('by-route', 'routeId');
            store.createIndex('by-status', 'status');
          }

          // recordings
          if (!db.objectStoreNames.contains('recordings')) {
            const store = db.createObjectStore('recordings', { keyPath: 'id' });
            store.createIndex('by-createdAt', 'createdAt');
          }

          // drafts
          if (!db.objectStoreNames.contains('draftRoutes')) {
            db.createObjectStore('draftRoutes', { keyPath: 'recordingId' });
          }

          // paired devices
          if (!db.objectStoreNames.contains('pairedDevices')) {
            const store = db.createObjectStore('pairedDevices', { keyPath: 'deviceId' });
            store.createIndex('by-pairedAt', 'pairedAt');
          }

          // conflicts
          if (!db.objectStoreNames.contains('conflicts')) {
            db.createObjectStore('conflicts', { keyPath: 'entityId' });
          }

          // imports
          if (!db.objectStoreNames.contains('importHistory')) {
            const store = db.createObjectStore('importHistory', { keyPath: 'id', autoIncrement: true });
            store.createIndex('by-ts', 'ts');
          }

          // sync meta
          if (!db.objectStoreNames.contains('syncMeta')) {
            db.createObjectStore('syncMeta');
          }

          // trips
          if (!db.objectStoreNames.contains('trips')) {
            const store = db.createObjectStore('trips', { keyPath: 'id' });
            store.createIndex('by-route', 'routeId');
            store.createIndex('by-startedAt', 'startedAt');
          }

          // pending samples
          if (!db.objectStoreNames.contains('pendingSamples')) {
            const store = db.createObjectStore('pendingSamples', { keyPath: 'tripId' });
            // Composite key — we'll use tripId as primary, since we batch by trip
            store.createIndex('by-trip', 'tripId');
          }
        }

        if (oldVersion < 2) {
          // ---- v1 → v2: Hito 7 Fase 2 — track trip shares ----
          // No data migration: this is purely additive.
          if (!db.objectStoreNames.contains('outgoingTripShares')) {
            const store = db.createObjectStore('outgoingTripShares', { keyPath: 'id' });
            store.createIndex('by-startedAt', 'startedAt');
            store.createIndex('by-trip', 'tripId');
          }
          if (!db.objectStoreNames.contains('incomingTripShares')) {
            const store = db.createObjectStore('incomingTripShares', { keyPath: 'fromAnonId' });
            store.createIndex('by-startedAt', 'startedAt');
          }
        }

        // Reference `tx` to silence "declared but never read" warnings.
        // Future migrations will use it to read existing data.
        void tx;
      },
    });
  }
  return dbPromise;
}

// Helper wrappers
export async function getIdentity(): Promise<Identity | undefined> {
  const db = await getDB();
  return db.get('identity', 'self');
}
export async function setIdentity(id: Identity): Promise<void> {
  const db = await getDB();
  await db.put('identity', id, 'self');
}
export async function clearIdentity(): Promise<void> {
  const db = await getDB();
  await db.delete('identity', 'self');
}