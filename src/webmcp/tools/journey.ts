import { registerOneTool } from '../register';
// Journey planning — A → B with transfers.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { planJourney } from '@/api/journey';
import { num, object, str } from '../schema';

const VEHICLE_KINDS = ['bus', 'train', 'tram', 'metro', 'other'] as const;

export const journeyTools: ModelContextTool[] = [
  {
    name: 'plan_journey',
    title: 'Plan a journey (A → B)',
    description:
      'Plan a multi-leg journey from a coordinate A to coordinate B. Optional filters: departAfter (ms epoch), maxWalkSpeedMs (default 1.4), maxBoardings (default 3), walkRadiusM (default 600), excludeRouteIds (JSON array of strings), vehicleKinds (JSON array).',
    inputSchema: object({
      fromLat: num('Origin latitude.', { minimum: -90, maximum: 90 }),
      fromLng: num('Origin longitude.', { minimum: -180, maximum: 180 }),
      toLat: num('Destination latitude.', { minimum: -90, maximum: 90 }),
      toLng: num('Destination longitude.', { minimum: -180, maximum: 180 }),
      departAfterUtc: num('Depart after this timestamp (ms epoch). Defaults to now.'),
      maxWalkSpeedMs: num('Max walking speed in m/s (default 1.4).'),
      maxBoardings: num('Max boardings including the first (default 3).'),
      walkRadiusM: num('Search radius around from/to in meters (default 600).'),
      excludeRouteIdsJson: str('JSON array of route ids to exclude, e.g. ["r1","r2"].'),
      vehicleKindsJson: str(
        `JSON array of vehicle kinds to include, e.g. ["bus","train"]. Allowed: ${VEHICLE_KINDS.join(', ')}.`,
      ),
    }, ['fromLat', 'fromLng', 'toLat', 'toLng']),
    async execute({
      fromLat,
      fromLng,
      toLat,
      toLng,
      departAfterUtc,
      maxWalkSpeedMs,
      maxBoardings,
      walkRadiusM,
      excludeRouteIdsJson,
      vehicleKindsJson,
    }) {
      const body: {
        from: { lat: number; lng: number };
        to: { lat: number; lng: number };
        departAfterUtc?: number;
        maxWalkSpeedMs?: number;
        maxBoardings?: number;
        walkRadiusM?: number;
        excludeRouteIds?: string[];
        vehicleKinds?: typeof VEHICLE_KINDS[number][];
      } = {
        from: { lat: Number(fromLat), lng: Number(fromLng) },
        to: { lat: Number(toLat), lng: Number(toLng) },
      };
      if (departAfterUtc != null) body.departAfterUtc = Number(departAfterUtc);
      if (maxWalkSpeedMs != null) body.maxWalkSpeedMs = Number(maxWalkSpeedMs);
      if (maxBoardings != null) body.maxBoardings = Number(maxBoardings);
      if (walkRadiusM != null) body.walkRadiusM = Number(walkRadiusM);
      if (typeof excludeRouteIdsJson === 'string' && excludeRouteIdsJson.length > 0) {
        body.excludeRouteIds = JSON.parse(excludeRouteIdsJson) as string[];
      }
      if (typeof vehicleKindsJson === 'string' && vehicleKindsJson.length > 0) {
        body.vehicleKinds = JSON.parse(vehicleKindsJson) as typeof VEHICLE_KINDS[number][];
      }
      return planJourney(body);
    },
  },
];

export async function registerJourneyTools(mc: ModelContext): Promise<void> {
  for (const t of journeyTools) await registerOneTool(mc, t);
}
