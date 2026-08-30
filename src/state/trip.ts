import { create } from 'zustand';
import type { Route, GPSSample, Trip } from '@/api/types';
import { apiFetch } from '@/api/client';
import { randomUUID } from '@/crypto';

export type TripPhase = 'idle' | 'starting' | 'onTrip' | 'ending' | 'ended';

type TripState = {
  activeTrip: Trip | null;
  route: Route | null;
  lastSample: GPSSample | null;
  phase: TripPhase;
  startedAt: number | null;
  startTrip(route: Route): Promise<void>;
  endTrip(reason: 'manual' | 'heuristic' | 'arrival'): Promise<void>;
  setLastSample(s: GPSSample): void;
  reset(): void;
};

export const useTripStore = create<TripState>((set, get) => ({
  activeTrip: null,
  route: null,
  lastSample: null,
  phase: 'idle',
  startedAt: null,

  async startTrip(route) {
    set({ phase: 'starting' });
    const { tripId } = await apiFetch<{ tripId: string }>('/trips/start', {
      method: 'POST',
      body: { routeId: route.id, ts: Date.now() },
      signed: true,
    });
    const trip: Trip = {
      id: tripId,
      routeId: route.id,
      routeVersionAtStart: route.version,
      startedAt: Date.now(),
      samples: [],
    };
    set({ activeTrip: trip, route, phase: 'onTrip', startedAt: trip.startedAt });
  },

  async endTrip(reason) {
    const trip = get().activeTrip;
    if (!trip) return;
    set({ phase: 'ending' });
    try {
      await apiFetch(`/trips/${trip.id}/end`, { method: 'POST', body: { ts: Date.now(), reason }, signed: true });
    } catch {
      // even if server fails, locally we treat as ended
    }
    set({
      activeTrip: null,
      route: null,
      lastSample: null,
      phase: 'ended',
      startedAt: null,
    });
  },

  setLastSample(s) {
    set({ lastSample: s });
    const trip = get().activeTrip;
    if (trip) {
      // Keep small ring buffer in memory; full history goes to server via watcher
      trip.samples = [...trip.samples.slice(-99), s];
    }
  },

  reset() {
    set({ activeTrip: null, route: null, lastSample: null, phase: 'idle', startedAt: null });
  },
}));