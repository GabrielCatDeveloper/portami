import { registerOneTool } from '../register';
// Geo tools — read the current GPS position. The watcher is the
// same one the app uses (geo/watcher.ts), which respects the
// testing-mode synthetic source and the collaborate flag.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { geoWatcher, type GeoPermission } from '@/geo/watcher';
import { empty } from '../schema';

export const geoTools: ModelContextTool[] = [
  {
    name: 'get_current_position',
    title: 'Get current GPS position',
    description:
      'Return the most recent GPS sample (or wait for one if none has arrived). May trigger the browser permission prompt on first call.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      const perm: GeoPermission = await geoWatcher.checkPermission();
      if (perm !== 'granted') {
        const requested = await geoWatcher.requestPermission();
        if (requested !== 'granted') {
          throw new Error(`geolocation permission not granted: ${requested}`);
        }
      }
      return new Promise<GeolocationPosition | null>((resolve) => {
        let leaseId: string | null = null;
        let settled = false;
        const finish = (position: GeolocationPosition | null) => {
          if (settled) return;
          settled = true;
          off();
          if (leaseId) geoWatcher.stop(leaseId);
          resolve(position);
        };
        const off = geoWatcher.onRaw((sample) => {
          finish({
            timestamp: sample.ts,
            coords: {
              latitude: sample.lat,
              longitude: sample.lng,
              accuracy: sample.acc,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: sample.speed ?? null,
              toJSON: () => ({}),
            } as GeolocationCoordinates,
            toJSON: () => ({}),
          } as GeolocationPosition);
        });
        leaseId = geoWatcher.start();
        queueMicrotask(() => {
          if (settled && leaseId) geoWatcher.stop(leaseId);
        });
        setTimeout(() => finish(null), 15_000);
      });
    },
  },

  {
    name: 'get_geolocation_permission',
    title: 'Get geolocation permission',
    description:
      'Return the current geolocation permission state without requesting it. One of: unknown, granted, denied, prompt, error.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      const perm = await geoWatcher.checkPermission();
      return { permission: perm };
    },
  },
];

export async function registerGeoTools(mc: ModelContext): Promise<void> {
  for (const t of geoTools) await registerOneTool(mc, t);
}
