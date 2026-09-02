import { registerOneTool } from '../register';
// Pairing tools — WebRTC device pairing, identity transfer, and
// friend list management.
//
// The pairing flow has two sides:
//   - Initiator: creates an SDP offer, sends it to the joiner out
//     of band (QR / paste / deeplink), receives an answer, finishes.
//   - Joiner: receives the offer, creates an answer, sends it back.
//
// The tools below expose the same imperative API the `/sync` page
// uses, so an agent can drive a pairing session end-to-end. Note
// that the SDP strings are large and opaque to an LLM — the
// intended UX is for the agent to print them to the console so the
// user can copy/paste them, or to share them via the existing
// `invite_link` helper below which embeds the offer in a deeplink.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { useSyncStore } from '@/sync';
import { useIdentityStore, useDeviceKeyStore } from '@/state/identity';
import { createInviteLink, buildAnswerBackUrl, defaultInviteText } from '@/sync/invite';
import { empty, object, str } from '../schema';

export const pairingTools: ModelContextTool[] = [
  {
    name: 'list_paired_devices',
    title: 'List paired devices',
    description:
      'List every WebRTC-paired device the user has, with last-seen timestamps.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      const sync = useSyncStore.getState();
      const devices = await sync.loadPairedDevices();
      return devices;
    },
  },

  {
    name: 'revoke_paired_device',
    title: 'Revoke paired device',
    description:
      'Remove a paired device from the local store and close its WebRTC connection. ⚠️ Destructive: you\'ll need to re-pair to share trips with them again.',
    inputSchema: object({ deviceId: str('Device id (== pubKey).') }, ['deviceId']),
    async execute({ deviceId }) {
      await useSyncStore.getState().revokeDevice(deviceId as string);
      return { ok: true, deviceId };
    },
  },

  {
    name: 'create_pairing_offer',
    title: 'Create pairing offer',
    description:
      'Initiate a pairing session: generate an SDP offer. The returned `offer` is an opaque JSON string — paste it into the friend\'s portami (or hand it to `join_with_offer`).',
    inputSchema: empty(),
    async execute() {
      const offer = await useSyncStore.getState().createOfferAndWait();
      return { offer, phase: 'awaiting-peer' };
    },
  },

  {
    name: 'join_with_pairing_offer',
    title: 'Join with pairing offer',
    description:
      'Joiner side: take an SDP offer from the initiator and produce an SDP answer to send back.',
    inputSchema: object({ offer: str('The SDP offer JSON string.') }, ['offer']),
    async execute({ offer }) {
      const answer = await useSyncStore.getState().joinWithOffer(offer as string);
      return { answer, phase: 'awaiting-peer' };
    },
  },

  {
    name: 'finish_pairing_as_initiator',
    title: 'Finish pairing as initiator',
    description:
      'Initiator side: paste the joiner\'s SDP answer here to complete the handshake.',
    inputSchema: object({ answer: str('The SDP answer JSON string.') }, ['answer']),
    async execute({ answer }) {
      await useSyncStore.getState().finishPairingAsInitiator(answer as string);
      return { ok: true };
    },
  },

  {
    name: 'reset_pairing',
    title: 'Reset pairing flow',
    description:
      'Abort the current pairing flow and clear all transient state. Useful when a flow stalls.',
    inputSchema: empty(),
    async execute() {
      useSyncStore.getState().reset();
      return { ok: true };
    },
  },

  {
    name: 'get_pairing_status',
    title: 'Get pairing status',
    description:
      'Return the current pairing phase (idle, awaiting-peer, verifying, transferring, syncing, success, error) and the pair-code for verification.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      const s = useSyncStore.getState();
      return {
        phase: s.phase,
        role: s.role,
        pairCode: s.pairCode,
        progress: s.progress,
        error: s.error,
        myAlias: s.myAlias,
        peerAlias: s.peerAlias,
      };
    },
  },

  {
    name: 'create_invite_link',
    title: 'Create invite link',
    description:
      'Create a /connect deeplink that bundles an SDP offer with the emitter\'s anonId + alias + optional tripShareId. The friend opens it in portami to pair + accept the trip share.',
    inputSchema: object({
      tripShareId: str('Optional tripShareId to auto-attach on accept.'),
      baseUrl: str('Override the origin (default: current location).'),
    }),
    async execute({ tripShareId, baseUrl }) {
      const id = useIdentityStore.getState();
      if (!id.anonId) throw new Error('identity not initialised');
      const device = await useDeviceKeyStore.getState().ensure();
      const url = await createInviteLink({
        emitterAnonId: id.anonId,
        emitterAlias: device.deviceId.slice(0, 6),
        tripShareId: typeof tripShareId === 'string' ? tripShareId : undefined,
        baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined,
      });
      return {
        inviteUrl: url,
        shareText: defaultInviteText({
          emitterAlias: device.deviceId.slice(0, 6),
          inviteUrl: url,
        }),
      };
    },
  },

  {
    name: 'build_answer_back_url',
    title: 'Build answer-back URL',
    description:
      'Joiner side: produce the /connect-back URL containing the SDP answer, to be opened by the initiator.',
    inputSchema: object({
      emitterAnonId: str('Initiator\'s anonId (the `for` parameter).'),
      answer: str('The SDP answer JSON string.'),
    }, ['emitterAnonId', 'answer']),
    async execute({ emitterAnonId, answer }) {
      const url = buildAnswerBackUrl({
        emitterAnonId: emitterAnonId as string,
        answer: answer as string,
      });
      return { url };
    },
  },
];

export async function registerPairingTools(mc: ModelContext): Promise<void> {
  for (const t of pairingTools) await registerOneTool(mc, t);
}
