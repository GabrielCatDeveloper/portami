import { registerOneTool } from '../register';
// Trips tools — start, end, inspect active and recent trips.
// All trips live both in the Zustand `useTripStore` (active) and
// IndexedDB (`trips` object store) for persistence.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { useTripStore } from '@/state/trip';
import { getDB } from '@/storage/db';
import { apiFetch } from '@/api/client';
import type { Route, Trip, GPSSample } from '@/api/types';
import { num, object, str } from '../schema';

export const tripsTools: ModelContextTool[] = [
  {
    name: 'get_active_trip',
    title: 'Get active trip',
    description:
      'Return the currently active trip (or null). Includes route, startedAt, last sample.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      const s = useTripStore.getState();
      return {
        activeTrip: s.activeTrip,
        route: s.route,
        lastSample: s.lastSample,
        phase: s.phase,
        startedAt: s.startedAt,
        plannedRoute: s.plannedRoute,
      };
    },
  },

  {
    name: 'start_trip',
    title: 'Start a trip',
    description:
      'Start a new trip on a route. Requires the route to be in the local cache. Calls POST /trips/start (signed).',
    inputSchema: object({ routeId: str('Route id to start the trip on.') }, ['routeId']),
    async execute({ routeId }) {
      const db = await getDB();
      const route = (await db.get('routes', routeId as string)) as
        | (Route & { isMine: boolean; isFavorite: boolean; cachedAt: number })
        | undefined;
      if (!route) throw new Error(`route ${routeId} not in cache — fetch it first with find_routes_nearby`);
      // Strip the cache-only fields before passing to startTrip
      const clean: Route = {
        id: route.id,
        name: route.name,
        stops: route.stops,
        polyline: route.polyline,
        createdBy: route.createdBy,
        version: route.version,
        active: route.active,
        createdAt: route.createdAt,
        vehicleKind: route.vehicleKind,
        schedules: route.schedules,
        operator: route.operator,
        direction: route.direction,
        stopRequest: route.stopRequest,
      };
      await useTripStore.getState().startTrip(clean);
      const trip = useTripStore.getState().activeTrip;
      return { tripId: trip?.id, routeId: route.id, startedAt: trip?.startedAt };
    },
  },

  {
    name: 'end_trip',
    title: 'End active trip',
    description:
      'End the currently active trip. Also stops any in-flight trip-share. Reason is one of "manual" (user), "heuristic" (auto-end from trip detector), or "arrival" (got off at destination).',
    inputSchema: object({
      reason: str('Why the trip ended.', ['manual', 'heuristic', 'arrival']),
    }, ['reason']),
    async execute({ reason }) {
      const trip = useTripStore.getState().activeTrip;
      if (!trip) return { ok: false, reason: 'no active trip' };
      await useTripStore.getState().endTrip(reason as 'manual' | 'heuristic' | 'arrival');
      return { ok: true, tripId: trip.id, reason };
    },
  },

  {
    name: 'list_recent_trips',
    title: 'List recent trips',
    description: 'Return trips stored locally, newest first.',
    inputSchema: object({
      routeId: str('Optional routeId filter.'),
      limit: num('Max trips to return (default 20, max 100).', { minimum: 1, maximum: 100 }),
    }),
    annotations: { readOnlyHint: true },
    async execute({ routeId, limit }) {
      const db = await getDB();
      const all = routeId
        ? await db.getAllFromIndex('trips', 'by-route', routeId as string)
        : await db.getAllFromIndex('trips', 'by-startedAt').then((xs) => xs.reverse());
      const max = Math.min(Number(limit ?? 20), 100);
      // Strip the samples ring buffer to keep payloads small
      return all.slice(0, max).map((t) => ({
        ...t,
        samples: ((t as Trip).samples ?? []).slice(-1) as GPSSample[],
      }));
    },
  },

  {
    name: 'push_gps_sample',
    title: 'Push GPS sample to server',
    description:
      'Push a single GPS sample for the active trip to the server. Requires the "Modo colaborador" flag enabled in Settings and an active trip. Signed POST /trips/:id/samples.',
    inputSchema: object({
      ts: num('Sample timestamp (ms since epoch).'),
      lat: num('Latitude.', { minimum: -90, maximum: 90 }),
      lng: num('Longitude.', { minimum: -180, maximum: 180 }),
      acc: num('Accuracy in meters.'),
      speed: num('Speed in m/s (optional).'),
    }, ['ts', 'lat', 'lng', 'acc']),
    async execute({ ts, lat, lng, acc, speed }) {
      const trip = useTripStore.getState().activeTrip;
      if (!trip) throw new Error('no active trip — call start_trip first');
      const sample: GPSSample = {
        ts: Number(ts),
        lat: Number(lat),
        lng: Number(lng),
        acc: Number(acc),
        speed: speed != null ? Number(speed) : undefined,
      };
      await apiFetch(`/trips/${trip.id}/samples`, {
        method: 'POST',
        body: { samples: [sample] },
        signed: true,
      });
      return { ok: true, tripId: trip.id, ts: sample.ts };
    },
  },
];

export async function registerTripsTools(mc: ModelContext): Promise<void> {
  for (const t of tripsTools) await registerOneTool(mc, t);
}
