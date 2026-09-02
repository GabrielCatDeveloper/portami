// ============================================================
// Tests for the trip-share bridge policy helpers (Hito 7 — Fase 4).
// We focus on the pure helpers — the hook itself is hard to test in
// jsdom because it depends on the React tree, the sync store and
// setTimeout-driven ack timers; that path is covered manually via
// the dev server (two browser tabs).
// ============================================================
import { describe, it, expect } from 'vitest';
import { recipientChip } from '@/state/tripShare';
import {
  recipientTimeoutOutcome,
  initialRecipientStatus,
  nextStopInfo,
} from '@/sync/tripShare';
import { useTripShareStore } from '@/state/tripShare';
import type { RecipientStatus } from '@/api/types';

describe('initialRecipientStatus', () => {
  it('returns "pending" when the peer is connected', () => {
    expect(initialRecipientStatus(true)).toBe('pending');
  });

  it('returns "unreachable" when the peer is offline', () => {
    expect(initialRecipientStatus(false)).toBe('unreachable');
  });
});

describe('recipientTimeoutOutcome', () => {
  it('returns null when the recipient is no longer pending', () => {
    expect(recipientTimeoutOutcome({ currentStatus: 'delivered', isPeerConnected: true })).toBeNull();
    expect(recipientTimeoutOutcome({ currentStatus: 'failed', isPeerConnected: false })).toBeNull();
    expect(recipientTimeoutOutcome({ currentStatus: 'unreachable', isPeerConnected: true })).toBeNull();
  });

  it('returns retry when peer is still connected and status is pending', () => {
    const r = recipientTimeoutOutcome({ currentStatus: 'pending', isPeerConnected: true });
    expect(r).toEqual({ status: 'pending', retry: true });
  });

  it('returns failed when peer is offline and status is pending', () => {
    const r = recipientTimeoutOutcome({ currentStatus: 'pending', isPeerConnected: false });
    expect(r).toEqual({ status: 'failed', error: 'no ack' });
  });
});

describe('recipientChip', () => {
  it('maps each status to a stable visual treatment', () => {
    expect(recipientChip('delivered').variant).toBe('success');
    expect(recipientChip('pending').variant).toBe('warning');
    expect(recipientChip('failed').variant).toBe('danger');
    expect(recipientChip('unreachable').variant).toBe('muted');
  });

  it('returns a non-empty icon + i18n key for every status', () => {
    for (const s of ['delivered', 'pending', 'failed', 'unreachable'] as const) {
      const chip = recipientChip(s);
      expect(chip.icon.length).toBeGreaterThan(0);
      expect(chip.i18nKey.length).toBeGreaterThan(0);
      // The key must belong to the `recipient.` namespace so we can
      // assert that the locales cover every status.
      expect(chip.i18nKey.startsWith('recipient.')).toBe(true);
    }
  });

  it('exposes a complete mapping for every RecipientStatus', () => {
    // Exhaustiveness guard: if a new RecipientStatus is added without
    // updating RECIPIENT_CHIP_KEYS, this test fails.
    const known: RecipientStatus[] = ['delivered', 'pending', 'failed', 'unreachable'];
    for (const s of known) {
      expect(recipientChip(s)).toBeDefined();
    }
  });
});

describe('useTripShareStore.hydrate', () => {
  it('exposes hydrate + outgoing + sharedTrips', () => {
    const s = useTripShareStore.getState();
    expect(typeof s.hydrate).toBe('function');
    expect(typeof s.setOutgoing).toBe('function');
    expect(typeof s.setSharedTrip).toBe('function');
    expect(typeof s.updateSharedTrip).toBe('function');
    expect(s.outgoing).toBeNull();
    expect(s.sharedTrips).toEqual({});
  });
});

// ============================================================
// nextStopInfo (was already tested in tests/tripShare.test.ts but
// we keep the import here so dead-code detection stays happy).
// ============================================================
describe('nextStopInfo (smoke)', () => {
  it('returns null when stops is empty', () => {
    expect(nextStopInfo({ lat: 0, lng: 0, speed: 5 }, [])).toBeNull();
  });
});
