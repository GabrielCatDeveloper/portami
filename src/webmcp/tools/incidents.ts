import { registerOneTool } from '../register';
// Incidents tools — report + resolve service incidents on a route
// (cancellation, delay, diversion, other).

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { listIncidents, reportIncident, resolveIncident } from '@/api/incidents';
import { num, object, str } from '../schema';

const KINDS = ['cancellation', 'delay', 'diversion', 'other'] as const;

export const incidentsTools: ModelContextTool[] = [
  {
    name: 'list_incidents',
    title: 'List incidents',
    description:
      'List active service incidents. Optional routeId filter. Auto-hides resolved + auto-expired.',
    inputSchema: object({ routeId: str('Optional route id filter.') }),
    annotations: { readOnlyHint: true },
    async execute({ routeId }) {
      return listIncidents(typeof routeId === 'string' ? routeId : undefined);
    },
  },

  {
    name: 'report_incident',
    title: 'Report incident',
    description:
      'Report a service incident (cancellation, delay, diversion, other) on a route. Signed.',
    inputSchema: object({
      routeId: str('Route id.'),
      kind: str('Incident kind.', KINDS),
      reason: str('Free text explaining the incident (e.g. "Manifestación en Sol").'),
      endsAt: num('Optional auto-expiry timestamp (ms epoch).'),
    }, ['routeId', 'kind', 'reason']),
    async execute({ routeId, kind, reason, endsAt }) {
      const id = (await import('@/state/identity')).useIdentityStore.getState();
      if (!id.anonId) throw new Error('identity not initialised');
      const res = await reportIncident({
        routeId: routeId as string,
        kind: kind as 'cancellation' | 'delay' | 'diversion' | 'other',
        reason: reason as string,
        reportedBy: id.anonId,
        ...(endsAt != null ? { endsAt: Number(endsAt) } : {}),
      });
      return res;
    },
  },

  {
    name: 'resolve_incident',
    title: 'Resolve incident',
    description: 'Mark an incident as resolved. Signed.',
    inputSchema: object({ incidentId: str('Incident id.') }, ['incidentId']),
    async execute({ incidentId }) {
      await resolveIncident(incidentId as string);
      return { ok: true, incidentId };
    },
  },
];

export async function registerIncidentsTools(mc: ModelContext): Promise<void> {
  for (const t of incidentsTools) await registerOneTool(mc, t);
}
