// ============================================================
// Synthetic GPS source
//
// Emits GeolocationPosition-shaped objects on a timer so it can
// stand in for navigator.geolocation in testing mode. The path
// is a slow random walk around the centre of Madrid that
// periodically pauses (simulates stops / traffic lights) and
// occasionally jumps ~80m (simulates bus hops). All noise is
// bounded so the position stays within a city-sized box.
//
// The source mimics just enough of the Geolocation API to be a
// drop-in replacement: watchPosition returns a numeric id, clearWatch
// cancels it, and each "position" is the standard shape.
// ============================================================

const DEFAULT_CENTER = { lat: 40.4170, lng: -3.7035 }; // Sol, Madrid

/** Approx metres per degree latitude (good enough for city-scale noise). */
const M_PER_DEG_LAT = 111_320;

/** Convert metres to degrees longitude at a given latitude. */
function metersToLng(m: number, atLat: number): number {
  return m / (M_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180));
}

function metersToLat(m: number): number {
  return m / M_PER_DEG_LAT;
}

export type SyntheticSourceOptions = {
  /** Override the initial position (defaults to Sol, Madrid). */
  center?: { lat: number; lng: number };
  /** Sample interval, ms. Default 1000. */
  intervalMs?: number;
  /** Mean walking speed in m/s. Default 1.3 (~5 km/h). */
  speedMs?: number;
};

type Listener = (pos: GeolocationPosition) => void;

export class SyntheticGpsSource {
  private watchId = 0;
  private activeId: number | null = null;
  private timer: number | null = null;
  private pos: { lat: number; lng: number };
  private bearing: number; // degrees, 0 = north, 90 = east
  private ticksSinceBearingChange = 0;
  private ticksSincePauseToggle = 0;
  private paused = false;
  private listeners = new Map<number, Listener>();
  private opts: Required<SyntheticSourceOptions>;
  private startTs = Date.now();

  constructor(opts: SyntheticSourceOptions = {}) {
    this.opts = {
      center: opts.center ?? DEFAULT_CENTER,
      intervalMs: opts.intervalMs ?? 1000,
      speedMs: opts.speedMs ?? 1.3,
    };
    this.pos = { ...this.opts.center };
    this.bearing = Math.random() * 360;
  }

  /** Mimics `navigator.geolocation.watchPosition`. */
  watchPosition(onPos: Listener, _onErr?: unknown): number {
    this.watchId++;
    const id = this.watchId;
    this.listeners.set(id, onPos);
    if (this.listeners.size === 1) this.startTimer();
    // Fire one immediate sample so the caller doesn't have to wait
    // a full interval for the first fix.
    onPos(this.synthesize());
    return id;
  }

  clearWatch(id: number): void {
    this.listeners.delete(id);
    if (this.listeners.size === 0) this.stopTimer();
  }

  private startTimer() {
    if (this.timer !== null) return;
    this.startTs = Date.now();
    this.timer = window.setInterval(() => this.tick(), this.opts.intervalMs);
  }

  private stopTimer() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    // Simulate occasional stops (bus stop, traffic light).
    this.ticksSincePauseToggle++;
    if (this.ticksSincePauseToggle > 8 + Math.random() * 12) {
      this.paused = !this.paused;
      this.ticksSincePauseToggle = 0;
    }

    // Occasionally change bearing.
    this.ticksSinceBearingChange++;
    if (this.ticksSinceBearingChange > 6 + Math.random() * 10) {
      // Turn within ±60°.
      this.bearing += (Math.random() * 120) - 60;
      this.bearing = ((this.bearing % 360) + 360) % 360;
      this.ticksSinceBearingChange = 0;
    }

    if (!this.paused) {
      // Move forward `speed * interval` metres in the current bearing.
      const distM = this.opts.speedMs * (this.opts.intervalMs / 1000);
      const rad = (this.bearing * Math.PI) / 180;
      const dLat = metersToLat(distM * Math.cos(rad));
      const dLng = metersToLng(distM * Math.sin(rad), this.pos.lat);
      this.pos = {
        lat: this.pos.lat + dLat,
        lng: this.pos.lng + dLng,
      };
    }

    const sample = this.synthesize();
    for (const fn of this.listeners.values()) fn(sample);
  }

  /** Build a GeolocationPosition-shaped object for the current pos. */
  private synthesize(): GeolocationPosition {
    const ts = Date.now();
    const speed = this.paused ? 0 : this.opts.speedMs;
    return {
      timestamp: ts,
      coords: {
        latitude: this.pos.lat,
        longitude: this.pos.lng,
        accuracy: 8 + Math.random() * 6,
        altitude: null,
        altitudeAccuracy: null,
        heading: this.bearing,
        speed,
      } as GeolocationCoordinates,
      // Some browsers expose toJSON; we don't need it.
    } as GeolocationPosition;
  }

  /** Read-only snapshot for tests / debug. */
  snapshot(): { lat: number; lng: number; bearing: number; paused: boolean; uptimeMs: number } {
    return {
      lat: this.pos.lat,
      lng: this.pos.lng,
      bearing: this.bearing,
      paused: this.paused,
      uptimeMs: Date.now() - this.startTs,
    };
  }
}
