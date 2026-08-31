// ============================================================
// Tests for the trip-share stores + janitor (Hito 7 — Fase 2).
//
// We test through the helper functions in `tripSharesStorage.ts`
// and the pure `runJanitor` function. The DB is `fake-indexeddb`
// (wired in tests/setup.ts).
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { getDB } from '@/storage/db';
import {
  putOutgoingShare,
  getOutgoingShare,
  listOutgoingShares,
  listActiveOutgoingShares,
  deleteOutgoingShare,
  updateOutgoingRecipient,
  setOutgoingEnded,
  putIncomingShare,
  getIncomingShare,
  listIncomingShares,
  listActiveIncomingShares,
  deleteIncomingShare,
  setIncomingEnded,
  updateIncomingLocation,
  makeRecipient,
} from '@/storage/tripSharesStorage';
import { runJanitor, TRIP_SHARE_TTL_MS } from '@/storage/janitor';
import type {
  OutgoingTripShare,
  IncomingTripShare,
} from '@/api/types';

const DAY = 24 * 60 * 60 * 1000;

// Build a fresh DB before each test. fake-indexeddb is shared across
// the test process but the `indexedDB` global is reset between runs
// via `vi.resetModules()`-like patterns; the simplest robust approach
// is to wipe the stores manually.
async function wipeStores() {
  const db = await getDB();
  await db.clear('outgoingTripShares');
  await db.clear('incomingTripShares');
}

function mkOutgoing(overrides: Partial<OutgoingTripShare> = {}): OutgoingTripShare {
  return {
    id: 'share-1',
    tripId: 'trip-1',
    routeId: 'route-1',
    routeName: 'L1 Plaza → Atocha',
    myAnonId: 'a1b2c3',
    startedAt: Date.now(),
    recipients: {
      'peer-A': makeRecipient('peer-A', 'Marta'),
    },
    ...overrides,
  };
}

function mkIncoming(overrides: Partial<IncomingTripShare> = {}): IncomingTripShare {
  return {
    fromAnonId: 'friend-1',
    fromDeviceId: 'pub-friend-1',
    fromAlias: 'Marta',
    tripId: 'trip-1',
    routeId: 'route-1',
    routeName: 'L1 Plaza → Atocha',
    startedAt: Date.now(),
    senderStatus: 'connected',
    ...overrides,
  };
}

beforeEach(async () => {
  await wipeStores();
});

// ============================================================
// CRUD: outgoing
// ============================================================
describe('outgoingTripShares store', () => {
  it('put + get round-trips', async () => {
    const s = mkOutgoing();
    await putOutgoingShare(s);
    const got = await getOutgoingShare('share-1');
    expect(got).toEqual(s);
  });

  it('listOutgoingShares returns shares newest-first', async () => {
    const now = Date.now();
    await putOutgoingShare(mkOutgoing({ id: 'old', startedAt: now - 2 * DAY }));
    await putOutgoingShare(mkOutgoing({ id: 'new', startedAt: now }));
    const list = await listOutgoingShares();
    expect(list.map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('listActiveOutgoingShares filters out ended ones', async () => {
    await putOutgoingShare(mkOutgoing({ id: 'active' }));
    await putOutgoingShare(
      mkOutgoing({ id: 'ended', endedAt: Date.now(), endReason: 'manual' }),
    );
    const list = await listActiveOutgoingShares();
    expect(list.map((s) => s.id)).toEqual(['active']);
  });

  it('updateOutgoingRecipient patches a single recipient', async () => {
    await putOutgoingShare(mkOutgoing());
    const next = await updateOutgoingRecipient('share-1', 'peer-A', {
      status: 'delivered',
      deliveredAt: 1000,
    });
    expect(next?.recipients['peer-A'].status).toBe('delivered');
    expect(next?.recipients['peer-A'].deliveredAt).toBe(1000);
  });

  it('updateOutgoingRecipient returns the existing row when recipient is unknown', async () => {
    await putOutgoingShare(mkOutgoing());
    const next = await updateOutgoingRecipient('share-1', 'unknown-peer', {
      status: 'delivered',
    });
    // The recipient wasn't there; the patch is a no-op for the row itself.
    expect(next?.recipients['unknown-peer']).toBeUndefined();
  });

  it('setOutgoingEnded stamps endedAt + endReason', async () => {
    await putOutgoingShare(mkOutgoing());
    await setOutgoingEnded('share-1', 9999, 'manual');
    const got = await getOutgoingShare('share-1');
    expect(got?.endedAt).toBe(9999);
    expect(got?.endReason).toBe('manual');
  });

  it('deleteOutgoingShare removes the row', async () => {
    await putOutgoingShare(mkOutgoing());
    await deleteOutgoingShare('share-1');
    expect(await getOutgoingShare('share-1')).toBeUndefined();
  });
});

// ============================================================
// CRUD: incoming
// ============================================================
describe('incomingTripShares store', () => {
  it('put + get round-trips', async () => {
    const s = mkIncoming();
    await putIncomingShare(s);
    const got = await getIncomingShare('friend-1');
    expect(got).toEqual(s);
  });

  it('put overwrites existing row with the same fromAnonId', async () => {
    await putIncomingShare(mkIncoming({ routeName: 'L1' }));
    await putIncomingShare(mkIncoming({ routeName: 'L2' }));
    const list = await listIncomingShares();
    expect(list).toHaveLength(1);
    expect(list[0].routeName).toBe('L2');
  });

  it('listActiveIncomingShares filters out ended ones', async () => {
    await putIncomingShare(mkIncoming({ fromAnonId: 'a' }));
    await putIncomingShare(
      mkIncoming({ fromAnonId: 'b', endedAt: Date.now(), endReason: 'manual' }),
    );
    const list = await listActiveIncomingShares();
    expect(list.map((s) => s.fromAnonId)).toEqual(['a']);
  });

  it('updateIncomingLocation merges loc + extras', async () => {
    await putIncomingShare(mkIncoming({ nextStopName: 'Sol' }));
    await updateIncomingLocation(
      'friend-1',
      { lat: 40.41, lng: -3.70, ts: 1234, speed: 8 },
      { etaNextStopS: 90 },
    );
    const got = await getIncomingShare('friend-1');
    expect(got?.lastLocation).toEqual({ lat: 40.41, lng: -3.70, ts: 1234, speed: 8 });
    expect(got?.nextStopName).toBe('Sol');
    expect(got?.etaNextStopS).toBe(90);
  });

  it('updateIncomingLocation preserves nextStopName when extras omits it', async () => {
    await putIncomingShare(mkIncoming({ nextStopName: 'Sol' }));
    await updateIncomingLocation('friend-1', { lat: 40.41, lng: -3.70, ts: 1 });
    const got = await getIncomingShare('friend-1');
    expect(got?.nextStopName).toBe('Sol');
  });

  it('setIncomingEnded stamps endedAt + endReason', async () => {
    await putIncomingShare(mkIncoming());
    await setIncomingEnded('friend-1', 5000, 'trip-ended');
    const got = await getIncomingShare('friend-1');
    expect(got?.endedAt).toBe(5000);
    expect(got?.endReason).toBe('trip-ended');
  });

  it('deleteIncomingShare removes the row', async () => {
    await putIncomingShare(mkIncoming());
    await deleteIncomingShare('friend-1');
    expect(await getIncomingShare('friend-1')).toBeUndefined();
  });
});

// ============================================================
// makeRecipient
// ============================================================
describe('makeRecipient', () => {
  it('builds a pending recipient with the given deviceId + alias', () => {
    const r = makeRecipient('dev-1', 'Marta', 5000);
    expect(r).toEqual({
      deviceId: 'dev-1',
      alias: 'Marta',
      status: 'pending',
      lastAttemptAt: 5000,
    });
  });

  it('defaults timestamp to now()', () => {
    const before = Date.now();
    const r = makeRecipient('dev-1', 'Marta');
    const after = Date.now();
    expect(r.lastAttemptAt).toBeGreaterThanOrEqual(before);
    expect(r.lastAttemptAt).toBeLessThanOrEqual(after);
  });
});

// ============================================================
// Janitor
// ============================================================
describe('runJanitor', () => {
  it('deletes outgoing shares older than TTL', async () => {
    const now = Date.now();
    await putOutgoingShare(mkOutgoing({ id: 'old', startedAt: now - TRIP_SHARE_TTL_MS - 1 }));
    await putOutgoingShare(mkOutgoing({ id: 'recent', startedAt: now - DAY }));
    const report = await runJanitor(now);
    expect(report.outgoingDeleted).toBe(1);
    expect(await getOutgoingShare('old')).toBeUndefined();
    expect(await getOutgoingShare('recent')).toBeDefined();
  });

  it('only deletes INCOMING shares that are BOTH ended AND older than TTL', async () => {
    const now = Date.now();
    // Active + old → keep
    await putIncomingShare(
      mkIncoming({ fromAnonId: 'old-active', startedAt: now - TRIP_SHARE_TTL_MS - 1 }),
    );
    // Ended + old → delete (endedAt < cutoff)
    await putIncomingShare(
      mkIncoming({
        fromAnonId: 'old-ended',
        startedAt: now - TRIP_SHARE_TTL_MS - 1,
        endedAt: now - TRIP_SHARE_TTL_MS - 500,
      }),
    );
    // Ended + recent → keep (TTL hasn't elapsed since endedAt)
    await putIncomingShare(
      mkIncoming({
        fromAnonId: 'recent-ended',
        startedAt: now - 2 * DAY,
        endedAt: now - DAY,
      }),
    );
    const report = await runJanitor(now);
    expect(report.incomingDeleted).toBe(1);
    expect(await getIncomingShare('old-active')).toBeDefined();
    expect(await getIncomingShare('old-ended')).toBeUndefined();
    expect(await getIncomingShare('recent-ended')).toBeDefined();
  });

  it('returns a report with ranAt', async () => {
    const now = Date.now();
    const r = await runJanitor(now);
    expect(r.ranAt).toBe(now);
    expect(r.outgoingDeleted).toBe(0);
    expect(r.incomingDeleted).toBe(0);
  });

  it('runs idempotently on an empty DB', async () => {
    const r = await runJanitor();
    expect(r.outgoingDeleted).toBe(0);
    expect(r.incomingDeleted).toBe(0);
  });
});
