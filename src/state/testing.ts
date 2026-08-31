// ============================================================
// Testing mode store
//
// When enabled, the app operates entirely on local mocks: MSW
// intercepts all API calls and the GPS source can be either the
// real navigator.geolocation or a synthetic one. No data ever
// leaves the device while testing is on.
//
// Use cases:
//   - Demo / sales: show the full UI without real GPS.
//   - CI: deterministic behaviour without a backend.
//   - Development when the backend is down or unreachable
//     (e.g. CORS not configured for your deploy origin).
//
// Persistence: localStorage (key: `portami.testing`). Survives
// reloads so you can flip it once and demo for a while.
// ============================================================

import { create } from 'zustand';

export type GpsMode = 'real' | 'simulated';

export type TestingState = {
  enabled: boolean;
  gpsMode: GpsMode;
  setEnabled: (v: boolean) => void;
  setGpsMode: (m: GpsMode) => void;
};

const STORAGE_KEY = 'portami.testing';

type PersistedShape = { enabled: boolean; gpsMode: GpsMode };

function loadPersisted(): PersistedShape {
  if (typeof localStorage === 'undefined') {
    return { enabled: false, gpsMode: 'simulated' };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false, gpsMode: 'simulated' };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    return {
      enabled: !!parsed.enabled,
      gpsMode: parsed.gpsMode === 'real' ? 'real' : 'simulated',
    };
  } catch {
    return { enabled: false, gpsMode: 'simulated' };
  }
}

function persist(s: PersistedShape): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage quota / disabled — silently ignore.
  }
}

export const useTestingStore = create<TestingState>((set, get) => ({
  ...loadPersisted(),

  setEnabled(enabled) {
    set({ enabled });
    persist({ enabled, gpsMode: get().gpsMode });
  },

  setGpsMode(gpsMode) {
    set({ gpsMode });
    persist({ enabled: get().enabled, gpsMode });
  },
}));

/**
 * Convenience selector used in main.tsx and geo/watcher.ts to decide
 * whether the app should treat everything as a mock. Kept as a
 * plain function (not a hook) so it can be called from non-React
 * code paths.
 */
export function isTestingEnabled(): boolean {
  return useTestingStore.getState().enabled;
}

/**
 * Same idea for the GPS sub-option. When testing is on AND this is
 * 'simulated', the geo watcher uses the synthetic source. When
 * 'real', it uses navigator.geolocation (potentially with mocked
 * permission flow on browsers that allow it).
 */
export function shouldUseSyntheticGps(): boolean {
  const s = useTestingStore.getState();
  return s.enabled && s.gpsMode === 'simulated';
}
