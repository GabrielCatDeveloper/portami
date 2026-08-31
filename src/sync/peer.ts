// ============================================================
// WebRTC peer wrapper for device sync
// ============================================================
import type { SyncMessage } from '@/api/types';

export type PeerEvent = 'open' | 'close' | 'message' | 'error';

export class Peer {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private listeners = new Map<PeerEvent, Set<(arg?: any) => void>>();

  constructor(public readonly isInitiator: boolean) {
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed') {
        this.emit('close');
      }
    };
    if (isInitiator) {
      this.channel = this.pc.createDataChannel('portami-sync', { ordered: true });
      this.bindChannel(this.channel);
    } else {
      this.pc.ondatachannel = (e) => {
        this.channel = e.channel;
        this.bindChannel(this.channel);
      };
    }
  }

  on(event: PeerEvent, fn: (arg?: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)!.delete(fn);
  }

  private emit(event: PeerEvent, arg?: any) {
    this.listeners.get(event)?.forEach((fn) => fn(arg));
  }

  private bindChannel(ch: RTCDataChannel) {
    ch.onopen = () => this.emit('open');
    ch.onclose = () => this.emit('close');
    ch.onerror = (e) => this.emit('error', e);
    ch.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as SyncMessage;
        this.emit('message', msg);
      } catch {
        // ignore non-JSON
      }
    };
  }

  async createOffer(): Promise<string> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return JSON.stringify({ type: 'offer', sdp: offer });
  }

  async acceptAnswer(sdp: string): Promise<void> {
    const parsed = JSON.parse(sdp);
    await this.pc.setRemoteDescription(parsed.sdp);
  }

  async createAnswer(offerSdp: string): Promise<string> {
    const parsed = JSON.parse(offerSdp);
    await this.pc.setRemoteDescription(parsed.sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return JSON.stringify({ type: 'answer', sdp: answer });
  }

  send(msg: SyncMessage) {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(msg));
    }
  }

  close() {
    this.channel?.close();
    this.pc.close();
    this.emit('close');
  }

  get ready() {
    return this.channel?.readyState === 'open';
  }
}