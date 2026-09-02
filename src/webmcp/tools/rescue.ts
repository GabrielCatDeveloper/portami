import { registerOneTool } from '../register';
// Rescue-me tools — broadcast a panic alert to all paired peers
// (top-of-screen banner + ack). The receiver side is wired into
// the trip-share controller's receiver listener, so WebMCP agents
// can both send and acknowledge rescues.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { useSyncStore } from '@/sync';
import { useIdentityStore, useDeviceKeyStore } from '@/state/identity';
import { useTripShareStore } from '@/state/tripShare';
import { num, object, str } from '../schema';

export const rescueTools: ModelContextTool[] = [
  {
    name: 'send_rescue_me',
    title: 'Send a rescue-me alert',
    description:
      'Broadcast a panic alert to every connected paired peer. Use ONLY when the user is in trouble. The receivers see a top-of-screen banner with the user\'s last location.',
    inputSchema: object({
      message: str('Short message included in the alert (optional).'),
      lat: num('Optional current latitude to attach.'),
      lng: num('Optional current longitude to attach.'),
      accuracyM: num('Optional accuracy in meters.'),
    }),
    async execute({ message, lat, lng, accuracyM }) {
      const sync = useSyncStore.getState();
      const id = useIdentityStore.getState();
      const device = useDeviceKeyStore.getState();
      if (!id.anonId || !device.deviceId) {
        throw new Error('identity or device key not initialised');
      }
      const rescueId = crypto.randomUUID();
      const payload: Record<string, unknown> = {
        kind: 'trip-share-rescue',
        rescueId,
        fromAnonId: id.anonId,
        fromDeviceId: device.deviceId,
        fromAlias: 'Yo',
        ts: Date.now(),
      };
      if (typeof message === 'string' && message.length > 0) payload['message'] = message;
      if (lat != null && lng != null) {
        payload['lat'] = Number(lat);
        payload['lng'] = Number(lng);
        if (accuracyM != null) payload['accuracyM'] = Number(accuracyM);
      }
      sync.send(payload as never);
      return { rescueId, sentTo: sync.listConnectedPeers() };
    },
  },

  {
    name: 'list_pending_rescues',
    title: 'List pending rescue alerts',
    description:
      'List rescue alerts received from paired friends that have not yet been acknowledged.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      const rescues = useTripShareStore.getState().rescues;
      return Object.values(rescues).filter((r) => !r.acknowledged);
    },
  },

  {
    name: 'list_all_rescues',
    title: 'List all rescue alerts',
    description: 'List every rescue alert currently in memory (acknowledged + pending).',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      return Object.values(useTripShareStore.getState().rescues);
    },
  },

  {
    name: 'acknowledge_rescue',
    title: 'Acknowledge a rescue alert',
    description:
      'Locally mark a rescue alert as acknowledged (no effect on the sender). Use `remove_rescue` to also drop it from memory.',
    inputSchema: object({ rescueId: str('Rescue id.') }, ['rescueId']),
    async execute({ rescueId }) {
      useTripShareStore.getState().acknowledgeRescue(rescueId as string);
      return { ok: true };
    },
  },

  {
    name: 'remove_rescue',
    title: 'Remove a rescue alert',
    description: 'Drop a rescue alert from the in-memory store.',
    inputSchema: object({ rescueId: str('Rescue id.') }, ['rescueId']),
    async execute({ rescueId }) {
      useTripShareStore.getState().removeRescue(rescueId as string);
      return { ok: true };
    },
  },

  // expose the constants so an agent can size payloads.
  {
    name: 'get_rescue_ttl_ms',
    title: 'Get rescue TTL',
    description:
      'Return the in-memory TTL (ms) applied to rescue alerts after acknowledgement. Default 5 minutes.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      return { ttlMs: 5 * 60 * 1000 };
    },
  },
];

export async function registerRescueTools(mc: ModelContext): Promise<void> {
  for (const t of rescueTools) await registerOneTool(mc, t);
}
