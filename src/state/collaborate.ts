// ============================================================
// useCollaborateStore — opt-in flag for "GPS to server".
//
// Why a separate store from `useTestingStore` or `useTripStore`:
//   - It's persistent across reloads (different from testing,
//     which is session-only).
//   - It's about privacy posture, not about the app's runtime
//     mode.
//   - It's the single source of truth for the architectural rule
//     documented in `ROADMAP_FUTURE.md` → "Regla de oro de
//     privacidad": the GPS only goes to the server when this flag
//     is explicitly true. Everything else (P2P, trip persistence)
//     is on by default.
// ============================================================

import { create } from 'zustand';

const STORAGE_KEY = 'portami.collaborate';

type State = {
  /** When true, `geo/watcher.pushSample` posts each GPS sample
   *  to `POST /api/trips/:id/samples`. The server stores the last
   *  position per trip, available later to friends querying
   *  `GET /api/trips/:id/last-location` (Hito 4b). */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
};

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persist(v: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch {
    /* localStorage may be disabled — fail silently. */
  }
}

export const useCollaborateStore = create<State>((set) => ({
  enabled: load(),
  setEnabled: (v) => {
    persist(v);
    set({ enabled: v });
  },
}));

/**
 * Module-level helper used by the watcher (which is not a React
 * component) to read the current value without subscribing. The
 * trade-off is that the watcher doesn't re-render when the toggle
 * changes — it just reads the latest value at the moment of the
 * next sample. Acceptable because the GPS sample interval (10 s) is
 * much longer than the time it takes for the user to perceive the
 * toggle change.
 */
export function isCollaborateEnabled(): boolean {
  return useCollaborateStore.getState().enabled;
}