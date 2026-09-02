// ============================================================
// Invite deeplink generation + parsing (Hito 7 — Fase 6, Opción A)
//
// URLs:
//   /connect?o=<base64url(offer-sdp-json)>&u=<emitter-anonId>&a=<alias>&t=<tripShareId>&v=1
//     → Receiver opens this. portami generates the answer and shows
//       it in a URL the receiver can send back via WhatsApp.
//
//   /connect-back?a=<base64url(answer-sdp-json)>&for=<emitter-anonId>&v=1
//     → Emitter opens this. portami processes the answer and finishes
//       the pairing it had initiated.
//
// No server involvement: the SDPs ride inside URL params and travel
// over the messaging app the user picks (WhatsApp, Telegram, SMS…).
//
// Why an ephemeral RTCPeerConnection for offer generation:
//   We only need the SDP. The connection is created, offered,
//   ICE-gathered, and immediately closed. When the friend responds
//   with an answer, the real WebRTC peer is bootstrapped by
//   `useSyncStore.joinWithOffer(offer)` from the receiver side and
//   `useSyncStore.finishPairingAsInitiator(answer)` from the emitter
//   side. We don't try to reuse the throwaway PC.
// ============================================================

import { bytesToBase64Url, base64UrlToBytes } from '@/crypto';

/** Current schema version. Bump when the URL shape changes. */
export const INVITE_VERSION = '1';

/** STUN servers used while generating the throwaway offer. */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type ParsedInvite =
  | {
      ok: true;
      version: string;
      offer: string; // JSON-encoded RTCSessionDescriptionInit { type:'offer', sdp }
      emitterAnonId: string;
      emitterAlias?: string;
      tripShareId?: string;
    }
  | { ok: false; error: string };

export type ParsedAnswerBack =
  | {
      ok: true;
      version: string;
      answer: string; // JSON-encoded RTCSessionDescriptionInit { type:'answer', sdp }
      forAnonId: string;
    }
  | { ok: false; error: string };

/**
 * Generate an invite link. Creates a throwaway RTCPeerConnection
 * just to fabricate an offer SDP (with ICE candidates gathered).
 *
 * @param args.emitterAnonId  the sender's anonId (for verification)
 * @param args.emitterAlias   the sender's alias (optional, friendly display)
 * @param args.tripShareId    optional, the share to attach on accept
 * @param args.baseUrl        origin + base path; defaults to current location
 * @param args.iceServers     optional ICE config override
 */
export async function createInviteLink(args: {
  emitterAnonId: string;
  emitterAlias?: string;
  tripShareId?: string;
  baseUrl?: string;
  iceServers?: RTCIceServer[];
  iceGatherTimeoutMs?: number;
}): Promise<string> {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('WebRTC not supported in this environment');
  }
  const pc = new RTCPeerConnection({
    iceServers: args.iceServers ?? DEFAULT_ICE_SERVERS,
  });
  // Creating a data channel nudges the SDP to include media
  // section, so the receiver-side bootstrapPeer doesn't fail with
  // "m= section is mandatory".
  pc.createDataChannel('portami-invite');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // Best-effort wait for ICE gathering so the SDP includes candidates.
  // If gathering times out, we still send the (partial) SDP — modern
  // receivers can still complete the handshake via trickle ICE later.
  await waitForIceGathering(pc, args.iceGatherTimeoutMs ?? 3000);
  pc.close();

  if (!pc.localDescription) {
    throw new Error('Failed to produce local description');
  }

  const offerJson = JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
  const offerB64 = bytesToBase64Url(new TextEncoder().encode(offerJson));

  const params = new URLSearchParams({
    o: offerB64,
    u: args.emitterAnonId,
    a: args.emitterAlias ?? '',
    t: args.tripShareId ?? '',
    v: INVITE_VERSION,
  });

  const base = args.baseUrl ?? `${window.location.origin}${import.meta.env.BASE_PATH}`;
  return `${base}connect?${params.toString()}`;
}

/**
 * Parse a /connect URL (or its query string) into a structured object.
 * Never throws — returns `{ ok: false, error }` on bad input.
 */
export function parseInviteLink(input: string | URLSearchParams): ParsedInvite {
  const params = input instanceof URLSearchParams ? input : new URL(input).searchParams;
  const version = params.get('v') ?? '';
  if (version !== INVITE_VERSION) {
    return { ok: false, error: `unsupported invite version: ${version || '(missing)'}` };
  }
  const offerB64 = params.get('o');
  const emitterAnonId = params.get('u');
  if (!offerB64 || !emitterAnonId) {
    return { ok: false, error: 'invite missing required fields (o, u)' };
  }
  let offer: string;
  try {
    offer = new TextDecoder().decode(base64UrlToBytes(offerB64));
    // Validate JSON shape.
    const parsed = JSON.parse(offer);
    if (parsed?.type !== 'offer' || typeof parsed?.sdp !== 'string') {
      return { ok: false, error: 'invite offer is malformed' };
    }
  } catch {
    return { ok: false, error: 'invite offer is not valid base64/JSON' };
  }
  return {
    ok: true,
    version,
    offer,
    emitterAnonId,
    emitterAlias: params.get('a') || undefined,
    tripShareId: params.get('t') || undefined,
  };
}

/**
 * Build the URL the receiver will send back to the emitter with the
 * answer SDP embedded.
 */
export function buildAnswerBackUrl(args: {
  emitterAnonId: string;
  answer: string;
  baseUrl?: string;
}): string {
  const answerB64 = bytesToBase64Url(new TextEncoder().encode(args.answer));
  const params = new URLSearchParams({
    a: answerB64,
    for: args.emitterAnonId,
    v: INVITE_VERSION,
  });
  const base = args.baseUrl ?? `${window.location.origin}${import.meta.env.BASE_PATH}`;
  return `${base}connect-back?${params.toString()}`;
}

/**
 * Parse a /connect-back URL. Never throws.
 */
export function parseAnswerBackLink(input: string | URLSearchParams): ParsedAnswerBack {
  const params = input instanceof URLSearchParams ? input : new URL(input).searchParams;
  const version = params.get('v') ?? '';
  if (version !== INVITE_VERSION) {
    return { ok: false, error: `unsupported version: ${version || '(missing)'}` };
  }
  const answerB64 = params.get('a');
  const forAnonId = params.get('for');
  if (!answerB64 || !forAnonId) {
    return { ok: false, error: 'answer-back missing required fields (a, for)' };
  }
  let answer: string;
  try {
    answer = new TextDecoder().decode(base64UrlToBytes(answerB64));
    const parsed = JSON.parse(answer);
    if (parsed?.type !== 'answer' || typeof parsed?.sdp !== 'string') {
      return { ok: false, error: 'answer is malformed' };
    }
  } catch {
    return { ok: false, error: 'answer is not valid base64/JSON' };
  }
  return { ok: true, version, answer, forAnonId };
}

// ----------------------------------------------------------------
// Pre-filled text for the messaging app
// ----------------------------------------------------------------

/**
 * Human-friendly text the emitter sends to the friend, including the
 * deeplink. Callers can pass it through `navigator.share` or paste it
 * into WhatsApp / Telegram / SMS intents.
 */
export function defaultInviteText(args: {
  emitterAlias?: string;
  inviteUrl: string;
  language?: 'es' | 'ca' | 'en';
}): string {
  const lang = args.language ?? 'es';
  // The link opens portami and the two devices pair P2P via WebRTC.
  // We make the "no server" promise explicit so the recipient
  // knows their friend's location won't be relayed through any
  // third party — including ours.
  if (lang === 'en') {
    return `Open portami and I'll share my trip with you live, directly device-to-device (no server in between): ${args.inviteUrl}`;
  }
  if (lang === 'ca') {
    return `Obre'm portami i comparteixo el meu viatge en directe, directe entre dispositius (sense servidor pel mig): ${args.inviteUrl}`;
  }
  return `Ábreme portami y te comparto mi viaje en directo, directo entre dispositivos (sin servidor por el medio): ${args.inviteUrl}`;
}

/**
 * Text the receiver sends back to the emitter with the answer URL.
 */
export function defaultAnswerBackText(args: {
  emitterAlias?: string;
  answerBackUrl: string;
  language?: 'es' | 'ca' | 'en';
}): string {
  const lang = args.language ?? 'es';
  if (lang === 'en') {
    return `Here's the answer for portami: ${args.answerBackUrl}`;
  }
  if (lang === 'ca') {
    return `Aquí tens la resposta per a portami: ${args.answerBackUrl}`;
  }
  return `Aquí tienes la respuesta para portami: ${args.answerBackUrl}`;
}

/**
 * Web Share / WhatsApp / Telegram / SMS URL builders.
 * All encode the text for safe inclusion in the URL.
 */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
export function telegramShareUrl(text: string, url: string): string {
  // Telegram prefers separate url + text params.
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}
export function smsShareUrl(text: string): string {
  return `sms:?body=${encodeURIComponent(text)}`;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', onChange);
        clearTimeout(timer);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve(); // give up; SDP may be partial
    }, timeoutMs);
  });
}
