// ============================================================
// Geolocation watcher with throttling + queue
//
// Uses a swappable "source" so the testing mode can swap in a
// synthetic GPS source (see syntheticGps.ts) at runtime without
// callers needing to know.
// ============================================================
import type { GPSSample } from '@/api/types';
import { apiFetch } from '@/api/client';
import { shouldUseSyntheticGps } from '@/state/testing';
import { isCollaborateEnabled } from '@/state/collaborate';
import { SyntheticGpsSource } from './syntheticGps';

type Listener = (sample: GPSSample) => void;
type RawListener = (sample: GPSSample) => void;

export type GeoPermission = 'unknown' | 'granted' | 'denied' | 'prompt' | 'error';

export type LeaseId = string;

/**
 * Minimal surface of a GPS source. Both `navigator.geolocation` and
 * `SyntheticGpsSource` satisfy this.
 */
export interface GpsSource {
  watchPosition(
    onPos: (pos: GeolocationPosition) => void,
    onErr?: (err: unknown) => void,
    opts?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
}

function newLeaseId(): LeaseId {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class RealGpsSource implements GpsSource {
  watchPosition(
    onPos: (pos: GeolocationPosition) => void,
    onErr?: (err: unknown) => void,
    opts?: PositionOptions,
  ): number {
    return navigator.geolocation.watchPosition(
      onPos,
      onErr as unknown as PositionErrorCallback,
      opts,
    );
  }
  clearWatch(id: number): void {
    navigator.geolocation.clearWatch(id);
  }
}

export class GeoWatcher {
  private watchId: number | null = null;
  private lastSentTs = 0;
  private lastPos: GPSSample | null = null;
  private listeners = new Set<Listener>();
  private rawListeners = new Set<RawListener>();
  private permission: GeoPermission = 'unknown';
  private currentTripId: string | null = null;
  private sendEveryMs: number;
  private maxAccuracyM: number;
  private source: GpsSource;
  private syntheticSource: SyntheticGpsSource | null = null;
  private leases = new Set<LeaseId>();

  constructor(opts?: { sendEveryMs?: number; maxAccuracyM?: number; source?: GpsSource }) {
    this.sendEveryMs = opts?.sendEveryMs ?? 10_000;
    this.maxAccuracyM = opts?.maxAccuracyM ?? 50;
    this.source = opts?.source ?? this.createSource();
  }

  /**
   * Pick the right source for the current testing state.
   * Real geolocation in normal mode; synthetic in testing+simulated.
   */
  private createSource(): GpsSource {
    if (shouldUseSyntheticGps()) {
      this.syntheticSource = new SyntheticGpsSource();
      return this.syntheticSource;
    }
    this.syntheticSource = null;
    return new RealGpsSource();
  }

  /**
   * Hot-swap the source at runtime (used when the user toggles the
   * testing option in Settings while the watcher is running). Safe
   * to call multiple times — restarts the underlying watch if needed.
   */
  setSource(source: GpsSource): void {
    const watchId = this.watchId;
    if (watchId !== null) {
      this.source.clearWatch(watchId);
      this.watchId = null;
    }
    this.source = source;
    if (watchId !== null) {
      this.watchId = source.watchPosition(
        (pos) => this.handlePosition(pos),
        (err) => console.warn('geo error', err),
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15_000,
        },
      );
    }
  }

  /** Re-evaluate testing state and swap source if needed. */
  refreshSource(): void {
    this.setSource(this.createSource());
  }

  async checkPermission(): Promise<GeoPermission> {
    // Synthetic source doesn't need permission — claim granted so the
    // UI flow can proceed without an interactive prompt.
    if (this.syntheticSource) {
      this.permission = 'granted';
      return this.permission;
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.permission = 'error';
      return this.permission;
    }
    // Permission values that the Permissions API can actually return
// for `geolocation`. `'error'` is our internal state for browsers
// that don't expose this descriptor; we never set it from here.
type ReportedPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

function isReportedPermission(s: string): s is ReportedPermission {
  return s === 'granted' || s === 'denied' || s === 'prompt' || s === 'unknown';
}

function narrow(s: string): GeoPermission {
  return isReportedPermission(s) ? s : 'unknown';
}

if ('permissions' in navigator) {
      try {
        // The Permissions API typings in lib.dom.d.ts don't include
        // the geolocation descriptor; cast through unknown to a
        // minimal interface that captures only what we use.
        const perms = navigator.permissions as unknown as {
          query?: (opts: { name: string }) => Promise<{ state: string; onchange?: (() => void) | null }>;
        };
        if (typeof perms.query !== 'function') {
          this.permission = 'unknown';
        } else {
          const status = await perms.query({ name: 'geolocation' });
          this.permission = narrow(status.state);
          if (status.onchange) {
            const handler = () => {
              this.permission = narrow(status.state);
            };
            status.onchange = handler;
          }
        }
      } catch {
        this.permission = 'unknown';
      }
    }
    return this.permission;
  }

  async requestPermission(): Promise<GeoPermission> {
    if (this.syntheticSource) {
      this.permission = 'granted';
      return this.permission;
    }
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        this.permission = 'error';
        resolve('error');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => {
          this.permission = 'granted';
          resolve('granted');
        },
        (err) => {
          this.permission = err.code === err.PERMISSION_DENIED ? 'denied' : 'error';
          resolve(this.permission);
        },
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    });
  }

  start(tripId?: string): LeaseId {
    const leaseId = newLeaseId();
    this.leases.add(leaseId);
    if (tripId !== undefined) this.currentTripId = tripId;
    if (this.watchId === null) {
      this.watchId = this.source.watchPosition(
        (pos) => this.handlePosition(pos),
        (err) => console.warn('geo error', err),
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15_000,
        },
      );
    }
    return leaseId;
  }

  stop(leaseId?: LeaseId): void {
    if (leaseId !== undefined) {
      this.leases.delete(leaseId);
      if (this.leases.size === 0) {
        if (this.watchId !== null) {
          this.source.clearWatch(this.watchId);
          this.watchId = null;
        }
      }
    } else {
      this.leases.clear();
      if (this.watchId !== null) {
        this.source.clearWatch(this.watchId);
        this.watchId = null;
      }
    }
  }

  attachTrip(tripId: string) {
    this.currentTripId = tripId;
  }

  detachTrip() {
    this.currentTripId = null;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onRaw(fn: RawListener): () => void {
    this.rawListeners.add(fn);
    return () => this.rawListeners.delete(fn);
  }

  private handlePosition(pos: GeolocationPosition) {
    const sample: GPSSample = {
      ts: pos.timestamp,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      acc: pos.coords.accuracy,
      speed: pos.coords.speed ?? undefined,
    };

    if (sample.acc > this.maxAccuracyM) {
      // too inaccurate, skip but keep last position for UI
      return;
    }

    this.rawListeners.forEach((fn) => fn(sample));

    // Dedup: skip if moved less than ~5 m AND less than 5 s passed.
    // We compare (lat² + lng²) deltas to avoid the cost of sqrt + cos
    // for haversine on every sample; this is a coarse approximation
    // around Madrid latitudes. 5 m at 40°N ≈ 5/111_320 deg lat ≈ 4.5e-5
    // so the squared delta threshold for "moved 5 m" is ≈ 2e-9. We
    // round to 1e-9 to leave headroom for noise — meaning we actually
    // dedup movements < ~3 m. Bump if you need stricter 5 m gating.
    if (this.lastPos) {
      const dt = sample.ts - this.lastPos.ts;
      const movedSq = (sample.lat - this.lastPos.lat) ** 2 + (sample.lng - this.lastPos.lng) ** 2;
      if (dt < 5000 && movedSq < 1e-9) return;
    }
    this.lastPos = sample;

    // Always notify local listeners (for UI + trip detector)
    this.listeners.forEach((fn) => fn(sample));

    // Throttled push to server if we have a trip AND the user has
    // explicitly opted in to "Modo colaborador" (Settings). The flag
    // is OFF by default — we MUST NOT post GPS to the server
    // unless the user actively enabled it. P2P friend sharing
    // (useTripShareBridge) is a separate, opt-in flow that doesn't
    // touch the server. See ROADMAP_FUTURE.md → "Regla de oro de
    // privacidad" for the full rule.
    if (
      this.currentTripId &&
      sample.ts - this.lastSentTs >= this.sendEveryMs &&
      isCollaborateEnabled()
    ) {
      this.lastSentTs = sample.ts;
      void this.pushSample(this.currentTripId, sample);
    }
  }

  private async pushSample(tripId: string, sample: GPSSample) {
    try {
      await apiFetch(`/trips/${tripId}/samples`, {
        method: 'POST',
        body: { samples: [sample] },
        signed: true,
      });
    } catch (err) {
      // Will be retried on next online / next sample if we add a local queue
      console.warn('Failed to push sample', err);
    }
  }
}

export const geoWatcher = new GeoWatcher();
