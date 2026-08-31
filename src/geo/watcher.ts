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
import { SyntheticGpsSource } from './syntheticGps';

type Listener = (sample: GPSSample) => void;

export type GeoPermission = 'unknown' | 'granted' | 'denied' | 'prompt' | 'error';

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
  private permission: GeoPermission = 'unknown';
  private currentTripId: string | null = null;
  private sendEveryMs: number;
  private maxAccuracyM: number;
  private source: GpsSource;
  private syntheticSource: SyntheticGpsSource | null = null;

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
    const wasRunning = this.watchId !== null;
    if (wasRunning) this.stop();
    this.source = source;
    if (wasRunning) this.start();
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
    if ('permissions' in navigator) {
      try {
        const status = await (navigator.permissions as any).query({ name: 'geolocation' });
        this.permission = status.state as GeoPermission;
        status.onchange = () => {
          this.permission = status.state as GeoPermission;
        };
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

  start(tripId?: string) {
    if (this.watchId !== null) return;
    this.currentTripId = tripId ?? this.currentTripId;
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

  stop() {
    if (this.watchId !== null) {
      this.source.clearWatch(this.watchId);
      this.watchId = null;
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

    // Dedup: skip if moved < 5m and < 5s passed
    if (this.lastPos) {
      const dt = sample.ts - this.lastPos.ts;
      const movedSq = (sample.lat - this.lastPos.lat) ** 2 + (sample.lng - this.lastPos.lng) ** 2;
      if (dt < 5000 && movedSq < 1e-9) return;
    }
    this.lastPos = sample;

    // Always notify local listeners (for UI + trip detector)
    this.listeners.forEach((fn) => fn(sample));

    // Throttled push to server if we have a trip
    if (this.currentTripId && sample.ts - this.lastSentTs >= this.sendEveryMs) {
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
