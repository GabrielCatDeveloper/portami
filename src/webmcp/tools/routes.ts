import { registerOneTool } from '../register';
// Routes tools — read routes from the local IndexedDB cache, mark
// favorites, search the server for nearby routes, query active
// buses, read stop-request info.
//
// The local cache (`routes` object store) holds every route the
// user has ever seen (their own + favourite + cached from the
// server). The server endpoint `/routes/nearby` returns routes
// near a coordinate and merges them into the cache.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { apiFetch } from '@/api/client';
import { fetchAllActiveBuses, fetchActiveBusesOnRoute, type ActiveBusOnRoute } from '@/api/activeBuses';
import { getDB } from '@/storage/db';
import { updateStopRequest, getStopRequest as getStopRequestFromRoute } from '@/api/stopRequest';
import type { Route, StopRequestInfo, VehicleKind } from '@/api/types';
import { num, object, str } from '../schema';

type CachedRoute = Route & { isMine: boolean; isFavorite: boolean; cachedAt: number };

const VEHICLE_KINDS = ['bus', 'train', 'tram', 'metro', 'other'] as const;

export const routesTools: ModelContextTool[] = [
  {
    name: 'list_routes',
    title: 'List routes',
    description:
      'List routes from the local cache. Optional filters: only mine, only favourites, vehicle kind, name substring.',
    inputSchema: object({
      onlyMine: str('Filter to routes I created.', ['true', 'false']),
      onlyFavorites: str('Filter to favourite routes.', ['true', 'false']),
      vehicleKind: str('Filter by vehicle kind.', VEHICLE_KINDS),
      query: str('Case-insensitive substring match on the route name.'),
      limit: num('Max routes to return (default 100, max 500).', { minimum: 1, maximum: 500 }),
    }),
    annotations: { readOnlyHint: true },
    async execute({ onlyMine, onlyFavorites, vehicleKind, query, limit }) {
      const db = await getDB();
      const all = await db.getAll('routes');
      let xs: CachedRoute[] = all as CachedRoute[];
      if (onlyMine === 'true') xs = xs.filter((r) => r.isMine);
      if (onlyFavorites === 'true') xs = xs.filter((r) => r.isFavorite);
      if (vehicleKind) xs = xs.filter((r) => r.vehicleKind === (vehicleKind as VehicleKind));
      if (query) {
        const q = (query as string).toLowerCase();
        xs = xs.filter((r) => r.name.toLowerCase().includes(q));
      }
      const max = Math.min(Number(limit ?? 100), 500);
      return xs.slice(0, max);
    },
  },

  {
    name: 'get_route',
    title: 'Get route by id',
    description: 'Return a single route by id (from the local cache).',
    inputSchema: object({ routeId: str('The route id.') }, ['routeId']),
    annotations: { readOnlyHint: true },
    async execute({ routeId }) {
      const db = await getDB();
      const r = await db.get('routes', routeId as string);
      return r ?? null;
    },
  },

  {
    name: 'find_routes_nearby',
    title: 'Find routes nearby',
    description:
      'Query the server for routes near a coordinate. Results are merged into the local cache and returned.',
    inputSchema: object({
      lat: num('Latitude (WGS84).', { minimum: -90, maximum: 90 }),
      lng: num('Longitude (WGS84).', { minimum: -180, maximum: 180 }),
      radiusKm: num('Search radius in km (default 5).', { minimum: 0.1, maximum: 50 }),
    }, ['lat', 'lng']),
    async execute({ lat, lng, radiusKm }) {
      const r = Number(radiusKm ?? 5);
      const res = await apiFetch<{ routes: Route[] }>(
        `/routes/nearby?lat=${lat}&lng=${lng}&radiusKm=${r}`,
      );
      const db = await getDB();
      const now = Date.now();
      // Merge into cache so subsequent `list_routes` calls see them.
      const tx = db.transaction('routes', 'readwrite');
      for (const route of res.routes) {
        const existing = (await tx.store.get(route.id)) as CachedRoute | undefined;
        await tx.store.put({
          ...route,
          isMine: existing?.isMine ?? false,
          isFavorite: existing?.isFavorite ?? false,
          cachedAt: now,
        });
      }
      await tx.done;
      return res.routes;
    },
  },

  {
    name: 'mark_route_favorite',
    title: 'Mark route as favourite',
    description: 'Toggle a route\'s favourite flag in the local cache.',
    inputSchema: object({
      routeId: str('Route id.'),
      favorite: str('"true" to mark, "false" to unmark.', ['true', 'false']),
    }, ['routeId', 'favorite']),
    async execute({ routeId, favorite }) {
      const db = await getDB();
      const cur = (await db.get('routes', routeId as string)) as CachedRoute | undefined;
      if (!cur) throw new Error(`route ${routeId} not in cache — fetch it first with find_routes_nearby`);
      const next: CachedRoute = { ...cur, isFavorite: favorite === 'true' };
      await db.put('routes', next);
      return { routeId, isFavorite: next.isFavorite };
    },
  },

  {
    name: 'get_active_buses',
    title: 'Get active buses',
    description:
      'List buses currently on trips. Optionally filter by routeId. Returns trip id, route, anonId, position, speed, vehicle kind.',
    inputSchema: object({
      routeId: str('Optional. If set, return only buses on this route.'),
    }),
    annotations: { readOnlyHint: true },
    async execute({ routeId }) {
      const buses: ActiveBusOnRoute[] = routeId
        ? await fetchActiveBusesOnRoute(routeId as string)
        : await fetchAllActiveBuses();
      return buses;
    },
  },

  {
    name: 'get_stop_request',
    title: 'Get stop-request info for a route',
    description:
      'Return how to ask the driver to stop on a given route (button, shout, app, other/unknown) and the confirmation count.',
    inputSchema: object({ routeId: str('Route id.') }, ['routeId']),
    annotations: { readOnlyHint: true },
    async execute({ routeId }) {
      const db = await getDB();
      const r = (await db.get('routes', routeId as string)) as CachedRoute | undefined;
      if (!r) return null;
      return getStopRequestFromRoute(r);
    },
  },

  {
    name: 'set_stop_request',
    title: 'Set stop-request info for a route',
    description:
      'Propose new stop-request info for a route. The server increments the confirmation count if it already exists; otherwise it seeds a new entry.',
    inputSchema: object({
      routeId: str('Route id.'),
      type: str('Mechanism to request a stop.', ['button', 'shout', 'app', 'other', 'unknown']),
      notes: str('Free-text instructions (optional).'),
      buttonPhotoUrl: str('Data URL of a photo of the button (optional).'),
    }, ['routeId', 'type']),
    async execute({ routeId, type, notes, buttonPhotoUrl }) {
      const info: StopRequestInfo = {
        type: type as StopRequestInfo['type'],
      };
      if (typeof notes === 'string' && notes.length > 0) info.notes = notes;
      if (typeof buttonPhotoUrl === 'string' && buttonPhotoUrl.length > 0) info.buttonPhotoUrl = buttonPhotoUrl;
      const updated = await updateStopRequest(routeId as string, info);
      return updated ?? info;
    },
  },
];

export async function registerRoutesTools(mc: ModelContext): Promise<void> {
  for (const t of routesTools) await registerOneTool(mc, t);
}
