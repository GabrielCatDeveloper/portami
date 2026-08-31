// Trip sharing: reactive cache of `outgoingTripShares` and
// `incomingTripShares` (IndexedDB). The DB is the source of truth —
// the zustand store mirrors it so React components update when the
// underlying rows change (e.g. status transitions to `delivered`).
//
// Writes (start/stop sharing, retry, ack) happen in `sync/tripShare.ts`
// and update the DB; we re-read here to refresh the cache.

import { create } from 'zustand';
import type { LatLng, OutgoingTripShare, IncomingTripShare } from '@/api/types';

export type SharedTrip = IncomingTripShare & { /** legacy alias kept for UI components. */ };
export type OutgoingShare = OutgoingTripShare;

type State = {
  /** Incoming shared trips, keyed by sender anonId. Mirrors `incomingTripShares`. */
  sharedTrips: Record<string, IncomingTripShare>;
  /** Active outgoing share (if any). Mirrors the active row in `outgoingTripShares`. */
  outgoing: OutgoingTripShare | null;
  /** Hydration flag — true after the first DB read on mount. */
  hydrated: boolean;

  /** Re-read both stores from IndexedDB. */
  hydrate(): Promise<void>;
  /** Replace the cached outgoing row (after DB write). */
  setOutgoing: (s: OutgoingTripShare | null) => void;
  /** Replace one cached incoming row. Pass null to remove. */
  setSharedTrip: (fromAnonId: string, s: IncomingTripShare | null) => void;
  /** Patch one cached incoming row (e.g. updated lastLocation). */
  updateSharedTrip: (fromAnonId: string, patch: Partial<IncomingTripShare>) => void;
};

export const useTripShareStore = create<State>((set) => ({
  sharedTrips: {},
  outgoing: null,
  hydrated: false,

  async hydrate() {
    // Lazy import to avoid a circular dep at module init
    // (`tripSharesStorage` imports `db`, which is fine — but keeping
    // the dynamic import here keeps the surface clean and lets us
    // mock the storage layer in tests if needed).
    const { listIncomingShares, listActiveOutgoingShares } = await import('@/storage/tripSharesStorage');
    const [incoming, activeOutgoing] = await Promise.all([
      listIncomingShares(),
      listActiveOutgoingShares(),
    ]);
    const sharedTrips: Record<string, IncomingTripShare> = {};
    for (const s of incoming) sharedTrips[s.fromAnonId] = s;
    set({
      sharedTrips,
      outgoing: activeOutgoing[0] ?? null,
      hydrated: true,
    });
  },

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

// ============================================================
// Pure helpers (testable, no React state)
// ============================================================

/**
 * Compute a human-readable status string for one recipient in an
 * outgoing share. The UI uses this to render chips/labels.
 */
export function recipientChip(status: OutgoingTripShare['recipients'][string]['status']): {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'muted';
  icon: string;
} {
  switch (status) {
    case 'delivered':
      return { label: 'entregado', variant: 'success', icon: '✓' };
    case 'pending':
      return { label: 'reintentando…', variant: 'warning', icon: '⟳' };
    case 'failed':
      return { label: 'fallido', variant: 'danger', icon: '✗' };
    case 'unreachable':
      return { label: 'sin conexión', variant: 'muted', icon: '⚠' };
  }
}

// LatLng re-export so other modules don't need a second type import.
export type { LatLng };
