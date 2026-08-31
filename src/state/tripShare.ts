// Trip sharing: sender broadcasts GPS every 60s to paired devices via
// the existing WebRTC data channel. Receiver stores the last known
// position so a friend can find the user if the bus is lost / battery
// dies / no internet.

import { create } from 'zustand';
import type { LatLng } from '@/api/types';

export type SharedTrip = {
  fromAnonId: string;
  fromAlias?: string;
  routeId?: string;
  routeName?: string;
  plannedRoute?: { steps: Array<{ kind: 'walk' | 'ride'; label: string }>; totalDurationS: number };
  startedAt: number;
  lastLocation?: LatLng & { ts: number; speed?: number };
  nextStopName?: string;
  etaNextStopS?: number;
  /** Set when the sender signals end of trip. */
  endedAt?: number;
  endReason?: string;
};

type State = {
  /** Incoming shared trips, keyed by sender anon id. */
  sharedTrips: Record<string, SharedTrip>;
  /** Outgoing share state (if I'm sharing). */
  outgoing: SharedTrip | null;
  setOutgoing: (s: SharedTrip | null) => void;
  setSharedTrip: (fromAnonId: string, s: SharedTrip | null) => void;
  updateSharedTrip: (fromAnonId: string, patch: Partial<SharedTrip>) => void;
};

export const useTripShareStore = create<State>((set) => ({
  sharedTrips: {},
  outgoing: null,
  setOutgoing: (s) => set({ outgoing: s }),
  setSharedTrip: (fromAnonId, s) =>
    set((state) => {
      const next = { ...state.sharedTrips };
      if (s === null) delete next[fromAnonId];
      else next[fromAnonId] = s;
      return { sharedTrips: next };
    }),
  updateSharedTrip: (fromAnonId, patch) =>
    set((state) => {
      const cur = state.sharedTrips[fromAnonId];
      if (!cur) return state;
      return {
        sharedTrips: { ...state.sharedTrips, [fromAnonId]: { ...cur, ...patch } },
      };
    }),
}));