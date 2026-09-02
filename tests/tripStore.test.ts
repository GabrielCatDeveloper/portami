// ============================================================
// Tests for useTripStore — the source of truth for the active
// trip + ring-buffer of GPS samples.
//
// The store is straightforward but it sits in the middle of
// every trip-related UI: a regression in `startTrip` (e.g. losing
// the planned route on resume) would be silent. We exercise the
// public surface here, including:
//   - ring buffer cap (100 samples)
//   - state reset semantics on endTrip / reset
//   - plannedRoute attachment + clear
//   - that endTrip swallows network errors and still clears state
//     (matches the documented contract — "even if server fails,
//     locally we treat as ended")
// ============================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the API client before importing the store so the module
// init picks up the stub.
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from '@/api/client';
import { useTripStore } from '@/state/trip';
import type { GPSSample, Journey, Route, Trip } from '@/api/types';

const mockedApiFetch = vi.mocked(apiFetch);

const ROUTE: Route = {
  id: 'r-1',
  name: 'Test route',
  stops: [
    { id: 's1', name: 'A', lat: 40, lng: -3 },
    { id: 's2', name: 'B', lat: 40.01, lng: -3 },
  ],
  polyline: [[40, -3], [40.01, -3]],
  createdBy: 'tester',
  version: 1,
  active: true,
};

function sampleFixture(ts: number, lat: number, lng: number): GPSSample {
  return { ts, lat, lng, acc: 5, speed: 8 };
}

describe('useTripStore', () => {
  beforeEach(() => {
    useTripStore.getState().reset();
    mockedApiFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts idle with no trip, no route, no planned route', () => {
      const s = useTripStore.getState();
      expect(s.phase).toBe('idle');
      expect(s.activeTrip).toBeNull();
      expect(s.route).toBeNull();
      expect(s.lastSample).toBeNull();
      expect(s.startedAt).toBeNull();
      expect(s.plannedRoute).toBeNull();
    });
  });

  describe('startTrip', () => {
    it('POSTs /trips/start signed, stores the new Trip, transitions to onTrip', async () => {
      mockedApiFetch.mockResolvedValueOnce({ tripId: 'trip-123' });
      await useTripStore.getState().startTrip(ROUTE);

      expect(mockedApiFetch).toHaveBeenCalledWith(
        '/trips/start',
        expect.objectContaining({
          method: 'POST',
          signed: true,
          body: expect.objectContaining({ routeId: ROUTE.id }),
        }),
      );
      const s = useTripStore.getState();
      expect(s.phase).toBe('onTrip');
      expect(s.activeTrip?.id).toBe('trip-123');
      expect(s.activeTrip?.routeId).toBe(ROUTE.id);
      expect(s.activeTrip?.routeVersionAtStart).toBe(ROUTE.version);
      expect(s.route).toBe(ROUTE);
      expect(s.startedAt).toBeGreaterThan(0);
    });

    it('attaches the plannedRoute when provided', async () => {
      mockedApiFetch.mockResolvedValueOnce({ tripId: 'trip-p' });
      const plannedRoute: Journey = {
        id: 'j-1',
        from: { lat: 40, lng: -3 },
        to: { lat: 41, lng: -4 },
        steps: [{ kind: 'walk', from: { lat: 40, lng: -3 }, to: { lat: 40.01, lng: -3 }, distanceM: 100, durationS: 80 }],
        totalDurationS: 600,
        totalWalkM: 100,
        totalRideM: 0,
        boardings: 0,
        departAfterUtc: 0,
        arriveByUtc: 0,
        maxRequiredWalkSpeedMs: 0,
      };
      await useTripStore.getState().startTrip(ROUTE, { plannedRoute });
      expect(useTripStore.getState().plannedRoute).toBe(plannedRoute);
    });

    it('clears the previous plannedRoute when starting without one', async () => {
      mockedApiFetch.mockResolvedValueOnce({ tripId: 'trip-1' });
      await useTripStore.getState().startTrip(ROUTE, { plannedRoute: null });
      expect(useTripStore.getState().plannedRoute).toBeNull();

      mockedApiFetch.mockResolvedValueOnce({ tripId: 'trip-2' });
      await useTripStore.getState().startTrip(ROUTE);
      expect(useTripStore.getState().plannedRoute).toBeNull();
    });
  });

  describe('setLastSample', () => {
    it('updates lastSample without mutating the existing activeTrip reference', async () => {
      mockedApiFetch.mockResolvedValueOnce({ tripId: 't-1' });
      await useTripStore.getState().startTrip(ROUTE);
      const before = useTripStore.getState().activeTrip;
      const s = sampleFixture(1, 40, -3);
      useTripStore.getState().setLastSample(s);
      const after = useTripStore.getState().activeTrip;
      // The store uses mutation on purpose (samples is a ring buffer
      // reassigned in-place). The reference stays the same; we
      // assert that the ring buffer grew.
      expect(after).toBe(before);
      expect(after?.samples).toHaveLength(1);
      expect(useTripStore.getState().lastSample).toEqual(s);
    });

    it('caps the ring buffer at 100 samples', async () => {
      mockedApiFetch.mockResolvedValueOnce({ tripId: 't-1' });
      await useTripStore.getState().startTrip(ROUTE);
      for (let i = 0; i < 250; i++) {
        useTripStore.getState().setLastSample(sampleFixture(i, 40 + i * 1e-5, -3));
      }
      const trip = useTripStore.getState().activeTrip as Trip;
      expect(trip.samples).toHaveLength(100);
      // The most recent sample is kept (the ring drops the oldest).
      expect(trip.samples[99]?.ts).toBe(249);
      expect(trip.samples[0]?.ts).toBe(150);
    });

    it('still updates lastSample when there is no active trip', () => {
      const s = sampleFixture(1, 40, -3);
      useTripStore.getState().setLastSample(s);
      expect(useTripStore.getState().lastSample).toEqual(s);
      // No active trip, so nothing else changes.
      expect(useTripStore.getState().activeTrip).toBeNull();
    });
  });

  describe('endTrip', () => {
    it('POSTs /trips/:id/end with the reason and clears state', async () => {
      mockedApiFetch.mockResolvedValueOnce({ tripId: 'trip-end' });
      await useTripStore.getState().startTrip(ROUTE);
      mockedApiFetch.mockResolvedValueOnce({ ok: true });
      await useTripStore.getState().endTrip('manual');
      expect(mockedApiFetch).toHaveBeenLastCalledWith(
        '/trips/trip-end/end',
        expect.objectContaining({
          method: 'POST',
          signed: true,
          body: expect.objectContaining({ reason: 'manual' }),
        }),
      );
      const s = useTripStore.getState();
      expect(s.activeTrip).toBeNull();
      expect(s.route).toBeNull();
      expect(s.lastSample).toBeNull();
      expect(s.phase).toBe('ended');
      expect(s.plannedRoute).toBeNull();
    });

    it('swallows server errors and still clears local state', async () => {
      mockedApiFetch.mockResolvedValueOnce({ tripId: 'trip-net' });
      await useTripStore.getState().startTrip(ROUTE);
      mockedApiFetch.mockRejectedValueOnce(new Error('offline'));
      await expect(useTripStore.getState().endTrip('heuristic')).resolves.toBeUndefined();
      expect(useTripStore.getState().activeTrip).toBeNull();
      expect(useTripStore.getState().phase).toBe('ended');
    });

    it('is a no-op when there is no active trip', async () => {
      await useTripStore.getState().endTrip('manual');
      // No apiFetch call should have been issued.
      expect(mockedApiFetch).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('returns the store to its initial idle state', async () => {
      mockedApiFetch.mockResolvedValueOnce({ tripId: 't-r' });
      await useTripStore.getState().startTrip(ROUTE);
      useTripStore.getState().setLastSample(sampleFixture(1, 40, -3));
      await useTripStore.getState().endTrip('manual');
      // endTrip sets phase=ended; reset() should clear it.
      useTripStore.getState().reset();
      const s = useTripStore.getState();
      expect(s.phase).toBe('idle');
      expect(s.activeTrip).toBeNull();
      expect(s.route).toBeNull();
      expect(s.lastSample).toBeNull();
      expect(s.startedAt).toBeNull();
      expect(s.plannedRoute).toBeNull();
    });
  });
});