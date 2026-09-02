// ============================================================
// Tests for the architectural rule:
//   "GPS only goes to the server when the user has explicitly
//   enabled Modo colaborador".
//
// Concretely:
//   - With `isCollaborateEnabled() === false` (the default), the
//     `geo/watcher` must NOT call `apiFetch` to push samples.
//   - With it === true, it DOES call `apiFetch` (positive case
//     that proves the wiring is correct, not just stubbed out).
//
// These are the regression tests for the "regla de oro de
// privacidad" documented in ROADMAP_FUTURE.md. If anyone ever
// reverts the conditional in `watcher.ts`, these tests fail.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API client BEFORE the watcher module is imported.
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

// Mock the testing store so we don't pull in localStorage.
vi.mock('@/state/testing', () => ({
  shouldUseSyntheticGps: () => false,
}));

// Mock the geolocation API (jsdom doesn't expose navigator.geolocation).
const mockWatch = vi.fn();
const mockClearWatch = vi.fn();
Object.defineProperty(globalThis.navigator, 'geolocation', {
  configurable: true,
  value: {
    watchPosition: mockWatch,
    clearWatch: mockClearWatch,
    getCurrentPosition: vi.fn(),
  },
});

import { apiFetch } from '@/api/client';
import { GeoWatcher } from '@/geo/watcher';
import { isCollaborateEnabled, useCollaborateStore } from '@/state/collaborate';
import type { GPSSample } from '@/api/types';

const mockedApiFetch = vi.mocked(apiFetch);

function makeSample(ts: number): GPSSample {
  return { ts, lat: 40.417, lng: -3.703, acc: 5, speed: 8 };
}

function triggerWatcherSample(_watcher: GeoWatcher, sample: GPSSample): void {
  // The watcher's internal handle is held by `mockWatch`. We don't
  // need to actually call watchPosition — we can just emit a
  // position by calling the callback that the watcher registered
  // with `navigator.geolocation.watchPosition`.
  expect(mockWatch).toHaveBeenCalled();
  const cb = mockWatch.mock.calls[0]?.[0] as (p: GeolocationPosition) => void;
  cb({ coords: { latitude: sample.lat, longitude: sample.lng, accuracy: sample.acc, speed: sample.speed, altitude: null, altitudeAccuracy: null, heading: null }, timestamp: sample.ts } as GeolocationPosition);
}

describe('GPS-to-server privacy rule', () => {
  beforeEach(() => {
    mockWatch.mockClear();
    mockClearWatch.mockClear();
    mockedApiFetch.mockReset();
    mockedApiFetch.mockResolvedValue({} as never);
    // Reset the collaborate store to the default (off).
    useCollaborateStore.setState({ enabled: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT post to the server when collaborate is off (default)', async () => {
    expect(isCollaborateEnabled()).toBe(false);
    const watcher = new GeoWatcher({ sendEveryMs: 10 });
    watcher.start('trip-1');

    // Fire a few samples over time.
    triggerWatcherSample(watcher, makeSample(1_000));
    triggerWatcherSample(watcher, makeSample(20_000));
    triggerWatcherSample(watcher, makeSample(40_000));

    // Wait for any microtasks (pushSample is fire-and-forget).
    await new Promise((r) => setTimeout(r, 50));

    expect(mockedApiFetch).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('DOES post to the server when collaborate is on', async () => {
    useCollaborateStore.getState().setEnabled(true);
    expect(isCollaborateEnabled()).toBe(true);

    const watcher = new GeoWatcher({ sendEveryMs: 10 });
    watcher.start('trip-1');

    triggerWatcherSample(watcher, makeSample(20_000));
    await new Promise((r) => setTimeout(r, 50));

    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/trips/trip-1/samples',
      expect.objectContaining({
        method: 'POST',
        signed: true,
      }),
    );
    watcher.stop();
  });

  it('flipping the toggle mid-trip does not post previous samples', async () => {
    // Off → first sample is dropped.
    const watcher = new GeoWatcher({ sendEveryMs: 10 });
    watcher.start('trip-1');
    triggerWatcherSample(watcher, makeSample(1_000));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockedApiFetch).not.toHaveBeenCalled();

    // On → next sample is sent.
    useCollaborateStore.getState().setEnabled(true);
    triggerWatcherSample(watcher, makeSample(20_000));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);

    // Off again → no more posts.
    useCollaborateStore.getState().setEnabled(false);
    triggerWatcherSample(watcher, makeSample(40_000));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);

    watcher.stop();
  });
});