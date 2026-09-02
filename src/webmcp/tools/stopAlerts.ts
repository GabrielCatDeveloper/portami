import { registerOneTool } from '../register';
// Stop alerts — local-only, stored in a separate IndexedDB
// (`portami-stop-alerts`). When the active trip gets within ETA or
// distance threshold, portami fires a strong notification.
//
// Note: triggers fire client-side via `useStopAlertWatcher`. The
// add/remove tools only manage the data; firing happens while a
// trip is active.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import {
  listAlertsForRoute,
  listAllAlerts,
  addAlert,
  deleteAlert,
  resetTriggered,
  clearAllAlerts,
} from '@/storage/stopAlerts';
import { empty, num, object, str } from '../schema';

export const stopAlertsTools: ModelContextTool[] = [
  {
    name: 'list_stop_alerts',
    title: 'List stop alerts',
    description:
      'List local stop alerts. Either pass a routeId to filter, or omit to list every alert on the device.',
    inputSchema: object({ routeId: str('Route id filter (omit for all).') }),
    annotations: { readOnlyHint: true },
    async execute({ routeId }) {
      if (typeof routeId === 'string' && routeId.length > 0) {
        return listAlertsForRoute(routeId);
      }
      return listAllAlerts();
    },
  },

  {
    name: 'add_stop_alert',
    title: 'Add stop alert',
    description:
      'Add a stop alert. Provide either `triggerMinutes` (ETA-based) or `triggerDistanceM` (distance-based) or both.',
    inputSchema: object({
      routeId: str('Route id this alert belongs to.'),
      stopId: str('Stop id within the route.'),
      stopName: str('Stop name (human-readable, used in the notification).'),
      triggerMinutes: num('Fire when ETA ≤ this many minutes.'),
      triggerDistanceM: num('Fire when distance ≤ this many meters.'),
    }, ['routeId', 'stopId', 'stopName']),
    async execute({ routeId, stopId, stopName, triggerMinutes, triggerDistanceM }) {
      const id = await addAlert({
        tripRouteId: routeId as string,
        stopId: stopId as string,
        stopName: stopName as string,
        triggerMinutes: triggerMinutes != null ? Number(triggerMinutes) : undefined,
        triggerDistanceM: triggerDistanceM != null ? Number(triggerDistanceM) : undefined,
      });
      return { id, routeId, stopId };
    },
  },

  {
    name: 'remove_stop_alert',
    title: 'Remove stop alert',
    description: 'Delete a stop alert by id.',
    inputSchema: object({ id: num('Alert id (autoincrement).') }, ['id']),
    async execute({ id }) {
      await deleteAlert(Number(id));
      return { ok: true };
    },
  },

  {
    name: 'reset_stop_alerts_for_route',
    title: 'Reset stop alerts for a route',
    description:
      'Reset the "triggered" flag on every alert for a route so they\'ll fire again on the next trip.',
    inputSchema: object({ routeId: str('Route id.') }, ['routeId']),
    async execute({ routeId }) {
      await resetTriggered(routeId as string);
      return { ok: true };
    },
  },

  {
    name: 'clear_stop_alerts',
    title: 'Clear all stop alerts',
    description: 'Delete every stop alert on the device. ⚠️ Destructive.',
    inputSchema: empty(),
    async execute() {
      await clearAllAlerts();
      return { ok: true };
    },
  },
];

export async function registerStopAlertsTools(mc: ModelContext): Promise<void> {
  for (const t of stopAlertsTools) await registerOneTool(mc, t);
}
