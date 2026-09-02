import { registerOneTool } from '../register';
// Trip-share tools — start/stop P2P trip sharing, inspect
// outgoing + incoming shares, retry a recipient.
//
// P2P trip sharing is the Hito 7 feature: when a trip is active,
// portami broadcasts a `trip-share-start` message to every
// connected peer, then `trip-share-location` every 60s, and
// `trip-share-end` when the trip ends. All over WebRTC data
// channels — no server in the middle.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { tripShareController } from '@/sync';
import { useTripShareStore } from '@/state/tripShare';
import {
  listOutgoingShares,
  listIncomingShares,
} from '@/storage/tripSharesStorage';
import { useSyncStore } from '@/sync';
import type { Journey } from '@/api/types';
import { empty, object, str } from '../schema';

export const tripShareTools: ModelContextTool[] = [
  {
    name: 'start_trip_share',
    title: 'Start trip sharing',
    description:
      'Begin broadcasting the active trip to all connected paired peers. Requires an active trip (call start_trip first). Returns the share id and per-recipient status.',
    inputSchema: object({
      plannedRouteJson: str(
        'Optional JSON-encoded Journey plan (pass to override the trip\'s attached plan).',
      ),
    }),
    async execute({ plannedRouteJson }) {
      const ctx = tripShareController.getActiveCtx();
      if (!ctx) throw new Error('no active trip context — call start_trip first');
      const override = plannedRouteJson
        ? (JSON.parse(plannedRouteJson as string) as Journey)
        : null;
      const share = await tripShareController.startSharing(override);
      if (!share) throw new Error('could not start sharing — check identity + sync store');
      return share;
    },
  },

  {
    name: 'stop_trip_share',
    title: 'Stop trip sharing',
    description: 'Stop broadcasting the active trip and notify recipients.',
    inputSchema: object({
      reason: str('Why sharing stopped.', ['manual', 'heuristic', 'arrival', 'trip-ended']),
    }),
    async execute({ reason }) {
      await tripShareController.stopSharing((reason as string) || 'manual');
      return { ok: true };
    },
  },

  {
    name: 'get_outgoing_share',
    title: 'Get active outgoing share',
    description:
      'Return the currently active outgoing share (or null if not sharing). Includes per-recipient delivery status.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      return useTripShareStore.getState().outgoing ?? null;
    },
  },

  {
    name: 'list_incoming_shares',
    title: 'List incoming shared trips',
    description:
      'List trips friends are currently sharing with you (Following). Includes last known location, planned route, ETA to next stop.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      return listIncomingShares();
    },
  },

  {
    name: 'list_outgoing_share_history',
    title: 'List outgoing share history',
    description: 'Return the last 20 outgoing trip shares (newest first).',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      const xs = await listOutgoingShares();
      return xs.slice(0, 20);
    },
  },

  {
    name: 'retry_trip_share_recipient',
    title: 'Retry a trip-share recipient',
    description:
      'Manually retry sending the trip-share-start message to a specific paired device (by deviceId). No-op if the peer is disconnected.',
    inputSchema: object({ deviceId: str('Paired device id (== pubKey).') }, ['deviceId']),
    async execute({ deviceId }) {
      await tripShareController.retryRecipient(deviceId as string);
      return { ok: true, deviceId };
    },
  },

  {
    name: 'get_friend_location',
    title: 'Get a friend\'s last location',
    description:
      'Return the most recent location received from a specific friend (by their anonId).',
    inputSchema: object({ fromAnonId: str('Friend anonId.') }, ['fromAnonId']),
    annotations: { readOnlyHint: true },
    async execute({ fromAnonId }) {
      const all = await listIncomingShares();
      return all.find((s) => s.fromAnonId === fromAnonId) ?? null;
    },
  },

  {
    name: 'remove_incoming_share',
    title: 'Remove an incoming shared trip',
    description:
      'Delete the local record of an incoming shared trip. The friend keeps sharing — you just stop following.',
    inputSchema: object({ fromAnonId: str('Friend anonId.') }, ['fromAnonId']),
    async execute({ fromAnonId }) {
      useTripShareStore.getState().setSharedTrip(fromAnonId as string, null);
      return { ok: true };
    },
  },

  {
    name: 'is_sharing',
    title: 'Is sharing active?',
    description: 'Return true iff the user is currently broadcasting a trip.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      return { isSharing: tripShareController.isSharing() };
    },
  },

  // Helper to give the agent the WebRTC peer state for each paired
  // device. Without this, the agent has no way to know whether a
  // particular recipient will actually receive the broadcast.
  {
    name: 'list_peer_statuses',
    title: 'List WebRTC peer statuses',
    description:
      'Return the current WebRTC connection status of every paired device: disconnected, connecting, connected, reconnecting, unreachable, revoked, error.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      const sync = useSyncStore.getState();
      const peers = sync?.peers ?? {};
      return Object.values(peers);
    },
  },
];

export async function registerTripShareTools(mc: ModelContext): Promise<void> {
  for (const t of tripShareTools) await registerOneTool(mc, t);
}
