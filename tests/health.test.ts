import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getHealthSnapshot,
  startHealthPolling,
  stopHealthPolling,
  subscribeHealth,
  type HealthSnapshot,
} from '@/api/health';

describe('server health store', () => {
  beforeEach(() => {
    stopHealthPolling();
  });
  afterEach(() => {
    stopHealthPolling();
  });

  it('starts as stopped (no polls yet)', () => {
    const snap = getHealthSnapshot();
    expect(snap.status === 'stopped' || snap.status === 'offline').toBe(true);
    expect(snap.lastSeenUp).toBeNull();
  });

  it('notifies subscribers on update', async () => {
    const seen: HealthSnapshot[] = [];
    const unsub = subscribeHealth((s) => seen.push(s));
    unsub();
    expect(seen.length).toBeGreaterThan(0);
  });
});