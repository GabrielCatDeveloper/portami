// Trip sharing: reactive cache of `outgoingTripShares` and
// `incomingTripShares` (IndexedDB). The DB is the source of truth —
// the zustand store mirrors it so React components update when the
// underlying rows change (e.g. status transitions to `delivered`).
//
// Writes (start/stop sharing, retry, ack) happen in `sync/tripShare.ts`
// and update the DB; we re-read here to refresh the cache.
//
// "Rescue me" alerts (Hito 13) are NOT persisted to IndexedDB —
// they're transient, one-shot panic broadcasts. They live in a
// separate `rescues` map keyed by rescueId so the receiver UI can
// render a top-of-page alert that the user can acknowledge. We
// expire them from the store 5 minutes after the ack to avoid
// memory growth.

import { create } from 'zustand';
import type { LatLng, OutgoingTripShare, IncomingTripShare } from '@/api/types';
import { listIncomingShares, listActiveOutgoingShares } from '@/storage/tripSharesStorage';

export type SharedTrip = IncomingTripShare & { /** legacy alias kept for UI components. */ };
export type OutgoingShare = OutgoingTripShare;

/**
 * A "rescue me" alert received from a paired friend. Lives only
 * in memory (not persisted) so that the receiver doesn't have to
 * clean up after every alert.
 */
export type RescueAlert = {
  rescueId: string;
  fromAnonId: string;
  fromDeviceId: string;
  fromAlias?: string;
  ts: number;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  message?: string;
  /** True after the user has dismissed the alert in the UI. */
  acknowledged: boolean;
};

const RESCUE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type State = {
  /** Incoming shared trips, keyed by sender anonId. Mirrors `incomingTripShares`. */
  sharedTrips: Record<string, IncomingTripShare>;
  /** Active outgoing share (if any). Mirrors the active row in `outgoingTripShares`. */
  outgoing: OutgoingTripShare | null;
  /** Hydration flag — true after the first DB read on mount. */
  hydrated: boolean;
  /** Incoming rescue-me alerts, keyed by rescueId. */
  rescues: Record<string, RescueAlert>;

  /** Re-read both stores from IndexedDB. */
  hydrate(): Promise<void>;
  /** Replace the cached outgoing row (after DB write). */
  setOutgoing: (s: OutgoingTripShare | null) => void;
  /** Replace one cached incoming row. Pass null to remove. */
  setSharedTrip: (fromAnonId: string, s: IncomingTripShare | null) => void;
  /** Patch one cached incoming row (e.g. updated lastLocation). */
  updateSharedTrip: (fromAnonId: string, patch: Partial<IncomingTripShare>) => void;
  /** Add a new rescue alert (incoming). The sender's name is the key. */
  addRescue: (alert: RescueAlert) => void;
  /** Mark a rescue alert as acknowledged (locally — does not affect peers). */
  acknowledgeRescue: (rescueId: string) => void;
  /** Remove a rescue alert (e.g. when it expires or is dismissed). */
  removeRescue: (rescueId: string) => void;
};

export const useTripShareStore = create<State>((set) => ({
  sharedTrips: {},
  outgoing: null,
  hydrated: false,
  rescues: {},

  async hydrate() {
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

  addRescue: (alert) =>
    set((state) => ({ rescues: { ...state.rescues, [alert.rescueId]: alert } })),

  acknowledgeRescue: (rescueId) =>
    set((state) => {
      const cur = state.rescues[rescueId];
      if (!cur) return state;
      return { rescues: { ...state.rescues, [rescueId]: { ...cur, acknowledged: true } } };
    }),

  removeRescue: (rescueId) =>
    set((state) => {
      if (!(rescueId in state.rescues)) return state;
      const next = { ...state.rescues };
      delete next[rescueId];
      return { rescues: next };
    }),
}));

/**
 * Sweep expired rescue alerts. Called by a setInterval in the
 * Following page (or anywhere that mounts the rescue banner).
 * Exported for testing.
 */
export function pruneExpiredRescues(
  rescues: Record<string, RescueAlert>,
  now: number = Date.now(),
): Record<string, RescueAlert> {
  const cutoff = now - RESCUE_TTL_MS;
  let changed = false;
  const next: Record<string, RescueAlert> = {};
  for (const [id, r] of Object.entries(rescues)) {
    if (r.ts >= cutoff) {
      next[id] = r;
    } else {
      changed = true;
    }
  }
  return changed ? next : rescues;
}

/** Visible for tests. */
export { RESCUE_TTL_MS };

// ============================================================
// Pure helpers (testable, no React state)
// ============================================================

/**
 * Visual treatment (color variant + icon) for one recipient status.
 * The label is intentionally NOT included here — the caller picks
 * the i18n key and renders `t(key)` so that the chip is localised
 * alongside the rest of the page.
 */
export type RecipientChipVariant = 'success' | 'warning' | 'danger' | 'muted';

export const RECIPIENT_CHIP_KEYS = {
  delivered: { variant: 'success', icon: '✓', i18nKey: 'recipient.delivered' },
  pending: { variant: 'warning', icon: '⟳', i18nKey: 'recipient.pending' },
  failed: { variant: 'danger', icon: '✗', i18nKey: 'recipient.failed' },
  unreachable: { variant: 'muted', icon: '⚠', i18nKey: 'recipient.unreachable' },
} as const satisfies Record<
  OutgoingTripShare['recipients'][string]['status'],
  { variant: RecipientChipVariant; icon: string; i18nKey: string }
>;

export function recipientChip(status: OutgoingTripShare['recipients'][string]['status']): {
  variant: RecipientChipVariant;
  icon: string;
  i18nKey: string;
} {
  return RECIPIENT_CHIP_KEYS[status];
}

// LatLng re-export so other modules don't need a second type import.
export type { LatLng };
