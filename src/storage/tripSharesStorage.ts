// ============================================================
// CRUD helpers for the two trip-share stores (Hito 7 — Fase 2)
//
// Why a separate file:
//   `db.ts` is already large and we want the schema definition
//   and the generic open/get/clear helpers in one place. Domain
//   helpers for trip shares belong here.
// ============================================================
import { getDB } from './db';
import type {
  OutgoingTripShare,
  OutgoingTripShareRecipient,
  IncomingTripShare,
  RecipientStatus,
} from '@/api/types';

// ---------- Outgoing trip shares ----------

export async function putOutgoingShare(share: OutgoingTripShare): Promise<void> {
  const db = await getDB();
  await db.put('outgoingTripShares', share);
}

export async function getOutgoingShare(id: string): Promise<OutgoingTripShare | undefined> {
  const db = await getDB();
  return db.get('outgoingTripShares', id);
}

export async function listOutgoingShares(): Promise<OutgoingTripShare[]> {
  const db = await getDB();
  // Newest first — uses the by-startedAt index.
  return db.getAllFromIndex('outgoingTripShares', 'by-startedAt').then((xs) => xs.reverse());
}

export async function listActiveOutgoingShares(): Promise<OutgoingTripShare[]> {
  const all = await listOutgoingShares();
  return all.filter((s) => !s.endedAt);
}

export async function deleteOutgoingShare(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('outgoingTripShares', id);
}

/**
 * Update a single recipient's delivery state inside an outgoing share.
 * Reads → mutates → writes atomically enough for our purposes
 * (last-writer-wins on the device; no concurrent writers expected).
 */
export async function updateOutgoingRecipient(
  tripShareId: string,
  deviceId: string,
  patch: Partial<OutgoingTripShareRecipient>,
): Promise<OutgoingTripShare | undefined> {
  const db = await getDB();
  const cur = await db.get('outgoingTripShares', tripShareId);
  if (!cur) return undefined;
  const curRecip = cur.recipients[deviceId];
  if (!curRecip) return cur;
  const next: OutgoingTripShare = {
    ...cur,
    recipients: {
      ...cur.recipients,
      [deviceId]: { ...curRecip, ...patch },
    },
  };
  await db.put('outgoingTripShares', next);
  return next;
}

export async function setOutgoingEnded(
  tripShareId: string,
  endedAt: number,
  endReason: string,
): Promise<void> {
  const db = await getDB();
  const cur = await db.get('outgoingTripShares', tripShareId);
  if (!cur) return;
  await db.put('outgoingTripShares', { ...cur, endedAt, endReason });
}

// ---------- Incoming trip shares ----------

export async function putIncomingShare(share: IncomingTripShare): Promise<void> {
  const db = await getDB();
  await db.put('incomingTripShares', share);
}

export async function getIncomingShare(fromAnonId: string): Promise<IncomingTripShare | undefined> {
  const db = await getDB();
  return db.get('incomingTripShares', fromAnonId);
}

export async function listIncomingShares(): Promise<IncomingTripShare[]> {
  const db = await getDB();
  return db.getAllFromIndex('incomingTripShares', 'by-startedAt').then((xs) => xs.reverse());
}

export async function listActiveIncomingShares(): Promise<IncomingTripShare[]> {
  const all = await listIncomingShares();
  return all.filter((s) => !s.endedAt);
}

export async function deleteIncomingShare(fromAnonId: string): Promise<void> {
  const db = await getDB();
  await db.delete('incomingTripShares', fromAnonId);
}

export async function setIncomingEnded(
  fromAnonId: string,
  endedAt: number,
  endReason: string,
): Promise<void> {
  const db = await getDB();
  const cur = await db.get('incomingTripShares', fromAnonId);
  if (!cur) return;
  await db.put('incomingTripShares', { ...cur, endedAt, endReason });
}

export async function updateIncomingLocation(
  fromAnonId: string,
  loc: { lat: number; lng: number; ts: number; speed?: number },
  extras?: { nextStopName?: string; etaNextStopS?: number },
): Promise<void> {
  const db = await getDB();
  const cur = await db.get('incomingTripShares', fromAnonId);
  if (!cur) return;
  await db.put('incomingTripShares', {
    ...cur,
    lastLocation: loc,
    nextStopName: extras?.nextStopName ?? cur.nextStopName,
    etaNextStopS: extras?.etaNextStopS ?? cur.etaNextStopS,
  });
}

// ---------- Helpers ----------

/** Build a fresh `OutgoingTripShareRecipient` in `pending` state. */
export function makeRecipient(
  deviceId: string,
  alias: string | undefined,
  now = Date.now(),
): OutgoingTripShareRecipient {
  return {
    deviceId,
    alias,
    status: 'pending' satisfies RecipientStatus,
    lastAttemptAt: now,
  };
}
