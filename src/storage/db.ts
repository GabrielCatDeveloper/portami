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
}

const DB_NAME = 'portami';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PortamiDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<PortamiDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PortamiDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
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