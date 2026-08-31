// Local alerts (multi-stop notifications) — user-only, stored in IndexedDB.
// Server has no knowledge of these.

import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB } from 'idb';

export type StopAlert = {
  id?: number;             // auto-increment
  tripRouteId: string;     // route this alert belongs to
  stopId: string;
  stopName: string;
  /** Trigger when the bus is within this many meters of the stop. */
  triggerDistanceM: number;
  /** Has the alert fired for the current trip? Cleared on new trip. */
  triggered?: boolean;
  createdAt: number;
};

interface PortamiDB extends DBSchema {
  stopAlerts: {
    key: number;
    value: StopAlert;
    indexes: { 'by-route': string };
  };
}

let _dbPromise: Promise<IDBPDatabase<PortamiDB>> | null = null;
function getDB(): Promise<IDBPDatabase<PortamiDB>> {
  if (!_dbPromise) {
    _dbPromise = openDB<PortamiDB>('portami-stop-alerts', 1, {
      upgrade(db) {
        const store = db.createObjectStore('stopAlerts', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-route', 'tripRouteId');
      },
    });
  }
  return _dbPromise;
}

export async function listAlertsForRoute(routeId: string): Promise<StopAlert[]> {
  const db = await getDB();
  return db.getAllFromIndex('stopAlerts', 'by-route', routeId);
}

export async function addAlert(alert: Omit<StopAlert, 'id' | 'createdAt' | 'triggered'>): Promise<number> {
  const db = await getDB();
  const result = await db.add('stopAlerts', { ...alert, triggered: false, createdAt: Date.now() });
  return result as number;
}

export async function deleteAlert(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('stopAlerts', id);
}

export async function markTriggered(id: number): Promise<void> {
  const db = await getDB();
  const cur = await db.get('stopAlerts', id);
  if (!cur) return;
  await db.put('stopAlerts', { ...cur, triggered: true });
}

export async function resetTriggered(routeId: string): Promise<void> {
  const db = await getDB();
  const alerts = await db.getAllFromIndex('stopAlerts', 'by-route', routeId);
  const tx = db.transaction('stopAlerts', 'readwrite');
  for (const a of alerts) {
    if (a.triggered) {
      await tx.store.put({ ...a, triggered: false });
    }
  }
  await tx.done;
}