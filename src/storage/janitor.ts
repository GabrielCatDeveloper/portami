// ============================================================
// Storage janitor — TTL cleanup for time-bounded stores.
//
// What it cleans:
//   - outgoingTripShares:     startedAt < now - 7d
//   - incomingTripShares:     endedAt  < now - 7d (only ended ones;
//                             active shares are never reaped)
//
// Why a standalone function (not inline in db.ts):
//   - testable from vitest without needing a React render
//   - reusable by the SW (future: cleanup on activate)
//
// `useStorageJanitor` wires it into the React lifecycle.
// ============================================================
import { getDB } from './db';

/** Default TTL for trip shares — 7 days. */
export const TRIP_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type JanitorReport = {
  outgoingDeleted: number;
  incomingDeleted: number;
  ranAt: number;
};

/**
 * Run one cleanup pass. Returns a small report (useful for logging
 * or surfacing in tests).
 */
export async function runJanitor(now: number = Date.now()): Promise<JanitorReport> {
  const db = await getDB();
  const cutoff = now - TRIP_SHARE_TTL_MS;

  // ---- outgoingTripShares: delete if startedAt < cutoff ----
  // We don't bother with the index cursor here: the store is small
  // (one row per share, capped by user activity over a week) and
  // getAll is fine. If profiling shows it matters, switch to an
  // index range cursor.
  const outgoing = await db.getAll('outgoingTripShares');
  let outgoingDeleted = 0;
  for (const s of outgoing) {
    if (s.startedAt < cutoff) {
      await db.delete('outgoingTripShares', s.id);
      outgoingDeleted++;
    }
  }

  // ---- incomingTripShares: delete if endedAt < cutoff ----
  // Active shares are kept regardless of age (a friend could be on a
  // very long trip, and the row gets refreshed by location updates).
  const incoming = await db.getAll('incomingTripShares');
  let incomingDeleted = 0;
  for (const s of incoming) {
    if (s.endedAt != null && s.endedAt < cutoff) {
      await db.delete('incomingTripShares', s.fromAnonId);
      incomingDeleted++;
    }
  }

  return { outgoingDeleted, incomingDeleted, ranAt: now };
}
