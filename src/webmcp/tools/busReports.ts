import { registerOneTool } from '../register';
// Bus reports — observations about specific buses on a route
// (license plate, presence/absence of stop button, photo, notes).

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { listBusReports, addBusReport } from '@/api/busReports';
import { num, object, str } from '../schema';

export const busReportsTools: ModelContextTool[] = [
  {
    name: 'list_bus_reports',
    title: 'List bus reports',
    description:
      'List observations about specific buses on a route, newest first.',
    inputSchema: object({
      routeId: str('Route id.'),
      limit: num('Max reports to return (default 20, max 100).', { minimum: 1, maximum: 100 }),
    }, ['routeId']),
    annotations: { readOnlyHint: true },
    async execute({ routeId, limit }) {
      const max = Math.min(Number(limit ?? 20), 100);
      return listBusReports(routeId as string, max);
    },
  },

  {
    name: 'report_bus',
    title: 'Report a bus',
    description:
      'Record an observation about a specific bus on a route (license plate, stop button presence, photo, notes). Signed.',
    inputSchema: object({
      routeId: str('Route id.'),
      plate: str('License plate / fleet number.'),
      hasStopButton: str('"true" if the bus has a stop button.', ['true', 'false']),
      notes: str('Free notes (optional).'),
      buttonPhotoUrl: str('Data URL of a photo of the button (optional).'),
    }, ['routeId', 'plate']),
    async execute({ routeId, plate, hasStopButton, notes, buttonPhotoUrl }) {
      const id = (await import('@/state/identity')).useIdentityStore.getState();
      if (!id.anonId) throw new Error('identity not initialised');
      const res = await addBusReport({
        routeId: routeId as string,
        plate: plate as string,
        hasStopButton: hasStopButton === 'true',
        notes: typeof notes === 'string' ? notes : undefined,
        buttonPhotoUrl: typeof buttonPhotoUrl === 'string' ? buttonPhotoUrl : undefined,
        reportedBy: id.anonId,
      });
      return res;
    },
  },
];

export async function registerBusReportsTools(mc: ModelContext): Promise<void> {
  for (const t of busReportsTools) await registerOneTool(mc, t);
}
