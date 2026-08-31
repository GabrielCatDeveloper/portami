import { describe, it, expect } from 'vitest';
import { nextStopInfo } from '@/sync/tripShare';

const stops = [
  { id: 's1', name: 'Plaza Mayor', lat: 40.4150, lng: -3.7070 },
  { id: 's2', name: 'Sol',        lat: 40.4170, lng: -3.7035 },
  { id: 's3', name: 'Atocha',     lat: 40.4067, lng: -3.6907 },
];

describe('nextStopInfo', () => {
  it('returns the closest stop name and ETA at walking pace', () => {
    // Sample at Sol (same coords as s2)
    const r = nextStopInfo({ lat: 40.4170, lng: -3.7035, speed: 0 }, stops);
    expect(r).not.toBeNull();
    expect(r!.name).toBe('Sol');
    // ~0 m at 8 m/s fallback = 0 s
    expect(r!.etaS).toBe(0);
  });

  it('uses the sample speed when available', () => {
    // 1 km north of Sol at 10 m/s -> ~100 s
    const r = nextStopInfo({ lat: 40.4260, lng: -3.7035, speed: 10 }, stops);
    expect(r).not.toBeNull();
    expect(r!.etaS).toBeGreaterThan(80);
    expect(r!.etaS).toBeLessThan(130);
  });

  it('falls back to 8 m/s when speed is missing or too low', () => {
    // 1 km at 8 m/s = 125 s
    const r = nextStopInfo({ lat: 40.4260, lng: -3.7035, speed: 0 }, stops);
    expect(r).not.toBeNull();
    expect(r!.etaS).toBeGreaterThan(100);
    expect(r!.etaS).toBeLessThan(160);
  });

  it('returns null when stops array is empty', () => {
    expect(nextStopInfo({ lat: 0, lng: 0, speed: 5 }, [])).toBeNull();
  });
});
