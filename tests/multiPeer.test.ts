// ============================================================
// Tests for multi-peer API of useSyncStore (Hito 7 — Fase 1)
//
// jsdom does not implement WebRTC, so we stub RTCPeerConnection
// and RTCDataChannel with in-memory fakes that wire two peers
// together when they're "connected".
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

// We register the stubs BEFORE importing the store so the store's
// `new RTCPeerConnection(...)` call picks them up.
class FakeDataChannel {
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  private other: FakeDataChannel | null = null;

  constructor(public label: string) {}

  setOther(other: FakeDataChannel) {
    this.other = other;
  }

  send(data: string) {
    if (!this.other || this.readyState !== 'open') return;
    // Synchronously deliver to the other side.
    queueMicrotask(() => {
      this.other?.onmessage?.({ data });
    });
  }

  close() {
    this.readyState = 'closed';
    this.onclose?.();
    if (this.other && this.other.readyState !== 'closed') {
      this.other.readyState = 'closed';
      this.other.onclose?.();
    }
  }
}

class FakePeerConnection {
  iceConnectionState: RTCIceConnectionState = 'new';
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: FakeDataChannel }) => void) | null = null;
  signalingState: RTCSignalingState = 'stable';
  private localChannels: FakeDataChannel[] = [];
  private partner: FakePeerConnection | null = null;
  remoteSet = false;

  constructor(_config?: RTCConfiguration) {}

  // Wire two FakePeerConnections together so their channels can talk.
  static pair(a: FakePeerConnection, b: FakePeerConnection) {
    a.partner = b;
    b.partner = a;
  }

  createDataChannel(label: string): FakeDataChannel {
    const ch = new FakeDataChannel(label);
    this.localChannels.push(ch);
    if (this.partner) {
      // Initiator-side channel — deliver to partner's ondatachannel.
      queueMicrotask(() => {
        const mirrored = new FakeDataChannel(label);
        // Mirror both ways
        ch.setOther(mirrored);
        mirrored.setOther(ch);
        this.partner!.ondatachannel?.({ channel: mirrored });
        this.localChannels.push(mirrored);
        // Open both channels
        ch.readyState = 'open';
        mirrored.readyState = 'open';
        ch.onopen?.();
        mirrored.onopen?.();
        this.iceConnectionState = 'connected';
        this.oniceconnectionstatechange?.();
        this.partner!.iceConnectionState = 'connected';
        this.partner!.oniceconnectionstatechange?.();
      });
    }
    return ch;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: `v=0\no=- 0 0 IN IP4 127.0.0.1\ns=-\nt=0 0\n` };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: `v=0\no=- 1 1 IN IP4 127.0.0.1\ns=-\nt=0 0\n` };
  }

  async setLocalDescription(_desc: RTCSessionDescriptionInit) {
    this.signalingState = this.localChannels.length > 0 ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(_desc: RTCSessionDescriptionInit) {
    this.remoteSet = true;
    this.signalingState = 'stable';
  }

  close() {
    for (const ch of this.localChannels) {
      try {
        ch.close();
      } catch {
        /* swallow */
      }
    }
    if (this.iceConnectionState !== 'closed' && this.iceConnectionState !== 'failed') {
      this.iceConnectionState = 'closed';
      this.oniceconnectionstatechange?.();
    }
  }
}

beforeEach(() => {
  // Minimal browser globals for navigator.userAgent-driven alias.
  if (!('navigator' in globalThis)) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'jsdom-test' },
      configurable: true,
    });
  }

  // Reset module-level singletons between tests.
  vi.resetModules();

  (globalThis as any).RTCPeerConnection = FakePeerConnection;
  (globalThis as any).RTCDataChannel = FakeDataChannel;
});

// ----------------------------------------------------------------

import { useSyncStore } from '@/sync';
import { Peer } from '@/sync/peer';

describe('useSyncStore — multi-peer API', () => {
  it('starts with empty peers and idle phase', () => {
    const s = useSyncStore.getState();
    expect(s.phase).toBe('idle');
    expect(s.peers).toEqual({});
    expect(s.listAllPeers()).toEqual([]);
    expect(s.listConnectedPeers()).toEqual([]);
  });

  it('getPeerStatus returns "disconnected" for unknown deviceId', () => {
    expect(useSyncStore.getState().getPeerStatus('unknown')).toBe('disconnected');
  });

  it('send and sendTo are no-ops when there are no connected peers', () => {
    const s = useSyncStore.getState();
    expect(() => s.send({ kind: 'ping', ts: 1 })).not.toThrow();
    expect(() => s.sendTo('nobody', { kind: 'ping', ts: 1 })).not.toThrow();
  });

  it('subscribe and subscribeToDevice return unsubscribe functions', () => {
    const s = useSyncStore.getState();
    const unsub1 = s.subscribe(() => {});
    const unsub2 = s.subscribeToDevice('nobody', () => {});
    expect(typeof unsub1).toBe('function');
    expect(typeof unsub2).toBe('function');
    unsub1();
    unsub2();
  });

  it('reset clears all peer entries', () => {
    // Inject a fake peer directly via the store's internal state.
    const s = useSyncStore.getState();
    // Simulate having a peer by mutating peers directly (this mimics
    // what bootstrapPeer would do).
    useSyncStore.setState({
      peers: {
        dev1: {
          deviceId: 'dev1',
          alias: 'Test 1',
          pubKey: 'pub1',
          status: 'connected',
        },
      },
    });
    expect(s.listAllPeers()).toEqual(['dev1']);
    s.reset();
    expect(useSyncStore.getState().peers).toEqual({});
    expect(useSyncStore.getState().listAllPeers()).toEqual([]);
  });

  it('revokeDevice updates status to "revoked"', async () => {
    const s = useSyncStore.getState();
    useSyncStore.setState({
      peers: {
        dev1: {
          deviceId: 'dev1',
          alias: 'Test 1',
          pubKey: 'pub1',
          status: 'connected',
        },
      },
    });
    await s.revokeDevice('dev1');
    expect(useSyncStore.getState().getPeerStatus('dev1')).toBe('revoked');
  });

  it('Peer class is reusable (no internal state leaks between instances)', () => {
    const a = new Peer(true);
    const b = new Peer(false);
    expect(a.isInitiator).toBe(true);
    expect(b.isInitiator).toBe(false);
    expect(a.ready).toBe(false);
    expect(b.ready).toBe(false);
  });
});
