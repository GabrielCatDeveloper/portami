// ============================================================
// Tests for the trip-share controller — the singleton that owns
// the imperative start/stop/retry API + the always-on background
// loops. The hook `useTripShareBridge` (sync/tripShare.ts) is a
// thin adapter and is exercised manually in dev; here we cover
// the imperative surface directly.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { tripShareController } from '@/sync/tripShareController';
import { useIdentityStore } from '@/state/identity';
import { useTripShareStore } from '@/state/tripShare';
import { getDB } from '@/storage/db';
import type { Identity } from '@/api/types';

async function seedIdentity(): Promise<void> {
  const id: Identity = {
    pubKey: 'test-pubkey',
    privKeyJwk: { kty: 'oct', k: 'AAAA' } as unknown as JsonWebKey,
    createdAt: Date.now(),
  };
  const db = await getDB();
  await db.put('identity', id, 'self');
  useIdentityStore.setState({ identity: id, anonId: 'TEST01', initialized: true });
}

describe('tripShareController', () => {
  beforeEach(async () => {
    await seedIdentity();
    tripShareController.setActiveCtx(null);
  });

  it('reports not sharing when no share is active', () => {
    expect(tripShareController.isSharing()).toBe(false);
  });

  it('returns null activeCtx by default', () => {
    expect(tripShareController.getActiveCtx()).toBeNull();
  });

  it('setActiveCtx round-trips the context', () => {
    tripShareController.setActiveCtx({
      tripId: 't1',
      routeId: 'r1',
      routeName: 'R1',
      plannedRoute: null,
      lastSample: { lat: 0, lng: 0, ts: 0 },
    });
    expect(tripShareController.getActiveCtx()?.tripId).toBe('t1');
    tripShareController.setActiveCtx(null);
    expect(tripShareController.getActiveCtx()).toBeNull();
  });

  it('startSharing no-ops without an active trip context', async () => {
    const res = await tripShareController.startSharing();
    expect(res).toBeNull();
  });

  it('stopSharing is idempotent when not sharing', async () => {
    await tripShareController.stopSharing('manual');
    // The store stays empty.
    expect(useTripShareStore.getState().outgoing).toBeNull();
  });
});
