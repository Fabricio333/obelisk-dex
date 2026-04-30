/**
 * Single `RTCPeerConnection` wrapper implementing the MDN perfect-negotiation
 * pattern. The owner (`VoiceClient`) decides polite/impolite by lexicographic
 * pubkey comparison and supplies a `send(payload)` callback wired to the
 * Nostr signaling transport.
 *
 * Track-kind announcements travel out-of-band as `trackInfo` on signaling
 * events because the receiver's `ontrack` only sees the bare track and we
 * need to know if it's `camera` vs `screen` vs `screen-audio` before slotting
 * it into the UI.
 */
import type { VoiceSignalPayload, VoiceTrackKind } from './types';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export interface PeerEvents {
  onRemoteTrack(track: MediaStreamTrack, stream: MediaStream, kind: VoiceTrackKind): void;
  onRemoteTrackEnded(trackId: string): void;
  onConnectionStateChange(state: RTCPeerConnectionState): void;
}

export interface PeerOptions {
  remotePubkey: string;
  /** True when our pubkey is lexicographically greater than the remote's;
   *  the polite peer rolls back on offer glare. */
  polite: boolean;
  sessionId: string;
  send: (payload: VoiceSignalPayload) => Promise<void> | void;
  events: PeerEvents;
}

export class Peer {
  readonly remotePubkey: string;
  readonly polite: boolean;
  private readonly send: PeerOptions['send'];
  private readonly events: PeerEvents;
  private readonly sessionId: string;

  pc: RTCPeerConnection;

  private makingOffer = false;
  private ignoreOffer = false;
  private outboundSeq = 0;
  /** Track-id → kind, applied in `ontrack`. Sender announces via `trackInfo`. */
  private remoteTrackKinds = new Map<string, VoiceTrackKind>();
  /** Senders we've added so we can replace/remove them when toggling cam/screen. */
  private localSenders = new Map<VoiceTrackKind, RTCRtpSender>();
  private remoteStreams = new Map<string, MediaStream>();
  private closed = false;

  constructor(opts: PeerOptions) {
    this.remotePubkey = opts.remotePubkey;
    this.polite = opts.polite;
    this.send = opts.send;
    this.events = opts.events;
    this.sessionId = opts.sessionId;
    this.pc = this.createPc();
  }

  private createPc(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onnegotiationneeded = async () => {
      // kickNegotiation + onnegotiationneeded can race when we add a track
      // to an already-connected peer. Whoever sets makingOffer first wins;
      // the other bails so we don't double-call setLocalDescription.
      if (this.makingOffer || pc.signalingState !== 'stable') {
        console.log('[voice] negotiationneeded skip — busy', pc.signalingState, 'peer', this.remotePubkey.slice(0, 8));
        return;
      }
      console.log('[voice] negotiationneeded for', this.remotePubkey.slice(0, 8), 'state=', pc.signalingState);
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          await this.sendSignal({
            type: 'offer',
            sdp: pc.localDescription.sdp,
            sessionId: this.sessionId,
            seq: ++this.outboundSeq,
          });
        }
      } catch (e) {
        console.error('[voice] negotiationneeded failed', e);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      void this.sendSignal({
        type: 'ice',
        candidates: [candidate.toJSON()],
        sessionId: this.sessionId,
        seq: ++this.outboundSeq,
      });
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.remoteStreams.set(ev.track.id, stream);
      const kind = this.remoteTrackKinds.get(ev.track.id)
        ?? (ev.track.kind === 'audio' ? 'audio' : 'camera');
      console.log('[voice] ontrack', kind, 'from', this.remotePubkey.slice(0, 8));
      ev.track.onended = () => {
        this.events.onRemoteTrackEnded(ev.track.id);
        this.remoteStreams.delete(ev.track.id);
        this.remoteTrackKinds.delete(ev.track.id);
      };
      this.events.onRemoteTrack(ev.track, stream, kind);
    };

    pc.onconnectionstatechange = () => {
      console.log('[voice] connectionState', pc.connectionState, 'peer', this.remotePubkey.slice(0, 8));
      this.events.onConnectionStateChange(pc.connectionState);
    };

    return pc;
  }

  private async sendSignal(payload: VoiceSignalPayload): Promise<void> {
    try {
      await this.send(payload);
    } catch (e) {
      console.error('[voice] signal send failed', e);
    }
  }

  /**
   * Add or replace a local track of a given kind. Returns the RTCRtpSender
   * so the caller can later stop/remove it.
   */
  async setLocalTrack(kind: VoiceTrackKind, track: MediaStreamTrack | null): Promise<void> {
    if (this.closed) return;
    const existing = this.localSenders.get(kind);
    if (track === null) {
      if (existing) {
        try { this.pc.removeTrack(existing); } catch { /* may already be gone */ }
        this.localSenders.delete(kind);
      }
      return;
    }
    // Announce kind out-of-band so the receiver's `ontrack` knows the slot.
    // Sent as a dedicated `trackinfo` event so receivers don't confuse it
    // with a real SDP offer.
    await this.sendSignal({
      type: 'trackinfo',
      trackInfo: { trackId: track.id, kind },
      sessionId: this.sessionId,
      seq: ++this.outboundSeq,
    });
    // Re-check after the await — sendSignal can take a relay round-trip and
    // the peer may have been closed in the meantime (roster churn, leave).
    if (this.closed || this.pc.signalingState === 'closed') return;
    if (existing) {
      try { await existing.replaceTrack(track); } catch (e) { console.warn('[voice] replaceTrack failed', e); }
    } else {
      try {
        const sender = this.pc.addTrack(track);
        this.localSenders.set(kind, sender);
      } catch (e) {
        console.warn('[voice] addTrack failed', e);
        return;
      }
    }
    // `addTrack` should fire `onnegotiationneeded` automatically, but the
    // event is best-effort: some browsers debounce or skip it when called
    // immediately after PC creation. Kick negotiation explicitly so the
    // first offer reliably reaches the remote.
    queueMicrotask(() => { void this.kickNegotiation(); });
  }

  /**
   * Force an SDP offer if the PC is stable and we haven't sent one. No-op
   * during ongoing negotiation — `onnegotiationneeded` will run when stable.
   */
  private async kickNegotiation(): Promise<void> {
    if (this.closed) return;
    if (this.makingOffer) {
      console.log('[voice] kickNegotiation skip — already making offer for', this.remotePubkey.slice(0, 8));
      return;
    }
    if (this.pc.signalingState !== 'stable') {
      console.log('[voice] kickNegotiation skip — state=', this.pc.signalingState, 'for', this.remotePubkey.slice(0, 8));
      return;
    }
    console.log('[voice] kickNegotiation forcing offer to', this.remotePubkey.slice(0, 8));
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        await this.sendSignal({
          type: 'offer',
          sdp: this.pc.localDescription.sdp,
          sessionId: this.sessionId,
          seq: ++this.outboundSeq,
        });
      }
    } catch (e) {
      console.error('[voice] kickNegotiation failed', e);
    } finally {
      this.makingOffer = false;
    }
  }

  /**
   * Handle an incoming signaling payload from the remote peer. Implements
   * the MDN perfect-negotiation pattern: polite side rolls back on glare;
   * impolite side ignores the conflicting remote offer.
   */
  async handleSignal(payload: VoiceSignalPayload): Promise<void> {
    if (this.closed) return;

    if (payload.trackInfo) {
      this.remoteTrackKinds.set(payload.trackInfo.trackId, payload.trackInfo.kind);
    }

    try {
      if (payload.type === 'offer' && payload.sdp) {
        const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
        this.ignoreOffer = !this.polite && offerCollision;
        console.log('[voice] handleOffer from', this.remotePubkey.slice(0, 8), 'polite=', this.polite, 'collision=', offerCollision, 'ignored=', this.ignoreOffer);
        if (this.ignoreOffer) return;
        // Explicit rollback before applying the remote offer when our own
        // offer is in flight. The spec says setRemoteDescription({offer}) in
        // 'have-local-offer' state should implicitly roll back, but some
        // browsers leave the SDP setup attr in a bad state ("Answerer must
        // use active or passive"). Explicit rollback avoids that.
        if (offerCollision && this.pc.signalingState === 'have-local-offer') {
          try { await this.pc.setLocalDescription({ type: 'rollback' }); }
          catch (e) { console.warn('[voice] explicit rollback failed', e); }
        }
        await this.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          await this.sendSignal({
            type: 'answer',
            sdp: this.pc.localDescription.sdp,
            sessionId: this.sessionId,
            seq: ++this.outboundSeq,
          });
        }
      } else if (payload.type === 'answer' && payload.sdp) {
        if (this.pc.signalingState === 'have-local-offer') {
          try {
            await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
            console.log('[voice] applied answer from', this.remotePubkey.slice(0, 8));
          } catch (e) {
            // Most common cause: race where our own offer was sent late so
            // the remote actually answered an earlier (rolled-back) offer
            // and the setup attr no longer matches. Discard and let the
            // next negotiation cycle recover.
            console.warn('[voice] answer apply failed — will renegotiate', e);
            try { await this.pc.setLocalDescription({ type: 'rollback' }); }
            catch { /* already stable */ }
          }
        } else {
          console.warn('[voice] dropping answer in state', this.pc.signalingState, 'from', this.remotePubkey.slice(0, 8));
        }
      } else if (payload.type === 'ice' && payload.candidates?.length) {
        for (const cand of payload.candidates) {
          try {
            await this.pc.addIceCandidate(cand);
          } catch (err) {
            if (!this.ignoreOffer) console.warn('[voice] addIceCandidate failed', err);
          }
        }
      } else if (payload.type === 'bye') {
        this.close();
      }
    } catch (e) {
      console.error('[voice] handleSignal error', e);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.sendSignal({
      type: 'bye',
      sessionId: this.sessionId,
      seq: ++this.outboundSeq,
    }).catch(() => {});
    try { this.pc.close(); } catch { /* ignore */ }
  }
}
