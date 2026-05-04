/**
 * One werift `RTCPeerConnection` per remote browser peer in a Room.
 *
 * Mirrors obelisk-dex/src/lib/voice/peer.ts at a structural level: per-peer
 * PC, kind-25050 SDP/ICE round-trips, sequence-numbered ICE batches,
 * out-of-band trackInfo. The browser code on the other end is identical
 * to the mesh path — that's the whole point of SFU-as-just-a-peer.
 *
 * Differences from the browser-side peer:
 *
 *   - **No rollback.** werift's setLocalDescription doesn't accept a
 *     'rollback' type. We avoid the need for it by being IMPOLITE in
 *     every SFU↔peer pair: on glare (offer collision) we drop the
 *     remote offer; the browser's perfect-negotiation rolls back its
 *     own offer if it's polite. If the browser is also impolite for
 *     this pair (browser_pk < sfu_pk) glare can stall — in practice
 *     it self-resolves on the next negotiation trigger because both
 *     sides only re-offer on track changes, not in tight loops.
 *
 *   - **Track lifecycle is coarse.** v0 treats forwarded tracks as
 *     alive until the originating peer's PC disconnects. A browser
 *     toggling camera-off mid-call will renegotiate (the transceiver
 *     goes to 'inactive'); we don't yet propagate that to the other
 *     forwarders. Punch-list — see docs/sfu-system.md §10.
 *
 *   - **No reconnect ladder.** On `'failed'` we close the PC and rely
 *     on the browser to redial. The browser already has the ladder.
 */
import {
  RTCPeerConnection,
  type MediaStreamTrack,
  type RTCRtpSender,
  type RTCIceServer,
} from 'werift';

import { createLogger } from './log.js';
import type { Hex, VoiceSignalPayload, VoiceTrackKind } from './types.js';

const log = createLogger('peer');

export interface PeerOptions {
  remotePubkey: Hex;
  selfPubkey: Hex;
  iceServers: RTCIceServer[];
  publicIp: string | null;
  rtpPortMin: number;
  rtpPortMax: number;
  send: (payload: VoiceSignalPayload) => Promise<void> | void;
  events: PeerEvents;
}

export interface PeerEvents {
  onConnected(): void;
  onDisconnected(): void;
  onTrack(track: MediaStreamTrack, kind: VoiceTrackKind): void;
  onTrackEnded(trackId: string): void;
}

function fallbackKind(rawKind: 'audio' | 'video'): VoiceTrackKind {
  return rawKind === 'audio' ? 'audio' : 'camera';
}

interface ForwardedSender {
  originPubkey: Hex;
  trackId: string;
  trackKind: VoiceTrackKind;
  sender: RTCRtpSender;
}

export class Peer {
  readonly remotePubkey: Hex;
  readonly sessionId: string;

  private readonly pc: RTCPeerConnection;
  private readonly events: PeerEvents;
  private readonly send: PeerOptions['send'];

  /** True while we have an outstanding `setLocalDescription` (offer). */
  private makingOffer = false;
  private outboundSeq = 0;

  /** trackId → kind, populated by inbound trackinfo events. */
  private remoteTrackKinds = new Map<string, VoiceTrackKind>();
  /** trackId → ForwardedSender, the senders we added to forward another peer's track. */
  private forwardedSenders = new Map<string, ForwardedSender>();

  private wasConnected = false;
  private closed = false;

  constructor(opts: PeerOptions) {
    this.remotePubkey = opts.remotePubkey;
    this.events = opts.events;
    this.send = opts.send;
    this.sessionId = randomSessionId();

    this.pc = new RTCPeerConnection({
      iceServers: opts.iceServers,
      bundlePolicy: 'max-bundle',
      iceTransportPolicy: 'all',
      // werift port range — pin RTP to the configured range so a host
      // firewall / cloud security group can pinhole exactly these ports.
      icePortRange: [opts.rtpPortMin, opts.rtpPortMax],
      // Advertise this as a candidate when set — needed for 1:1 NAT
      // hosts (AWS, GCP) where the host can't see its own public IP.
      ...(opts.publicIp ? { iceAdditionalHostAddresses: [opts.publicIp] } : {}),
    });

    this.attachListeners();
    log.info('peer constructed', {
      remote: this.remotePubkey.slice(0, 8),
      sessionId: this.sessionId,
    });
  }

  // ── public API ─────────────────────────────────────────────────────────

  async forwardTrack(
    track: MediaStreamTrack,
    originPubkey: Hex,
    kind: VoiceTrackKind,
  ): Promise<void> {
    if (this.closed) return;
    if (originPubkey === this.remotePubkey) return; // never echo back

    const trackId = trackIdOf(track);

    // Out-of-band trackinfo BEFORE the negotiation so the browser's
    // ontrack handler has the kind+origin lookup ready when the inbound
    // track materializes. Same posture as browser peer.ts.
    await this.send({
      type: 'trackinfo',
      trackInfo: {
        trackId,
        kind,
        originPubkey,
      },
      sessionId: this.sessionId,
      seq: this.outboundSeq++,
    });

    const sender = this.pc.addTrack(track);
    this.forwardedSenders.set(trackId, {
      originPubkey,
      trackId,
      trackKind: kind,
      sender,
    });
    log.debug('forwarded track added', {
      to: this.remotePubkey.slice(0, 8),
      from: originPubkey.slice(0, 8),
      kind,
    });

    // werift triggers `onnegotiationneeded` after addTrack; our handler
    // will create and send an offer. If we're already in the middle of
    // one, makingOffer suppresses the duplicate.
  }

  async stopForwardingTrack(originPubkey: Hex, trackId: string): Promise<void> {
    if (this.closed) return;
    const entry = this.forwardedSenders.get(trackId);
    if (!entry || entry.originPubkey !== originPubkey) return;

    try {
      this.pc.removeTrack(entry.sender);
    } catch (err) {
      log.debug('removeTrack threw (peer likely closed)', {
        err: (err as Error).message,
      });
    }
    this.forwardedSenders.delete(trackId);
    log.debug('forwarded track removed', {
      to: this.remotePubkey.slice(0, 8),
      from: originPubkey.slice(0, 8),
      trackId,
    });
  }

  async handleSignal(payload: VoiceSignalPayload): Promise<void> {
    if (this.closed) return;

    try {
      switch (payload.type) {
        case 'offer':
          return await this.handleOffer(payload);
        case 'answer':
          return await this.handleAnswer(payload);
        case 'ice':
          return await this.handleIce(payload);
        case 'trackinfo':
          if (payload.trackInfo) {
            this.remoteTrackKinds.set(payload.trackInfo.trackId, payload.trackInfo.kind);
          }
          return;
        case 'bye':
          log.info('peer bye', { remote: this.remotePubkey.slice(0, 8) });
          this.close();
          return;
        case 'requestReset':
          // Polite peer asking us to rebuild. v0: just close and wait
          // for redial. The browser's reconnect ladder kicks in.
          log.info('requestReset → closing for redial', {
            remote: this.remotePubkey.slice(0, 8),
          });
          this.close();
          return;
        case 'qualityhint':
          // v0 doesn't dynamically adjust outbound encoding params.
          return;
      }
    } catch (err) {
      log.warn('signal handler threw', {
        type: payload.type,
        remote: this.remotePubkey.slice(0, 8),
        err: (err as Error).message,
      });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      void this.pc.close();
    } catch (err) {
      log.debug('pc.close threw (ignored)', { err: (err as Error).message });
    }
    if (this.wasConnected) {
      this.wasConnected = false;
      this.events.onDisconnected();
    }
    log.info('peer closed', { remote: this.remotePubkey.slice(0, 8) });
  }

  // ── internal ───────────────────────────────────────────────────────────

  private attachListeners(): void {
    // Werift exposes some events as callback properties (browser-style)
    // and others as observables (`Event<T>` with .subscribe()). Use the
    // shape each one publishes — mixing styles isn't a typo.

    this.pc.onnegotiationneeded = () => {
      void this.makeOffer().catch((err) =>
        log.warn('makeOffer threw', { err: (err as Error).message }),
      );
    };

    this.pc.onIceCandidate.subscribe((candidate) => {
      if (!candidate) return; // null = end-of-candidates
      // `send` may be sync (returns void) or async (returns Promise);
      // wrap in Promise.resolve so the .catch lands either way.
      Promise.resolve(
        this.send({
          type: 'ice',
          candidates: [candidate.toJSON()],
          sessionId: this.sessionId,
          seq: this.outboundSeq++,
        }),
      ).catch((err) =>
        log.debug('ice send failed', { err: (err as Error).message }),
      );
    });

    this.pc.onTrack.subscribe((track) => {
      if (!track) return;
      const tid = trackIdOf(track);
      const kind = this.remoteTrackKinds.get(tid) ?? fallbackKind(track.kind as 'audio' | 'video');
      log.info('inbound track', {
        from: this.remotePubkey.slice(0, 8),
        trackId: tid,
        kind,
      });
      this.events.onTrack(track, kind);
      // Track-end detection isn't exposed on werift's MediaStreamTrack
      // directly; tracks are removed when the peer disconnects. v0
      // limitation — see file header.
    });

    this.pc.connectionStateChange.subscribe((state) => {
      log.debug('connection state', { remote: this.remotePubkey.slice(0, 8), state });
      if (state === 'connected' && !this.wasConnected) {
        this.wasConnected = true;
        this.events.onConnected();
      } else if ((state === 'failed' || state === 'closed' || state === 'disconnected') && this.wasConnected) {
        this.wasConnected = false;
        this.events.onDisconnected();
        if (state === 'failed') {
          log.info('peer failed — closing for redial', { remote: this.remotePubkey.slice(0, 8) });
          this.close();
        }
      }
    });
  }

  private async makeOffer(): Promise<void> {
    if (this.closed) return;
    if (this.pc.signalingState !== 'stable') {
      // We're in the middle of negotiation — let the current round-trip
      // finish; the browser's answer flips us back to stable and the
      // negotiationneeded that fires after this addTrack will already
      // be queued.
      return;
    }
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      const sdp = this.pc.localDescription?.sdp;
      if (!sdp) {
        log.warn('makeOffer: no localDescription after setLocalDescription');
        return;
      }
      await this.send({
        type: 'offer',
        sdp,
        sessionId: this.sessionId,
        seq: this.outboundSeq++,
      });
    } finally {
      this.makingOffer = false;
    }
  }

  private async handleOffer(payload: VoiceSignalPayload): Promise<void> {
    if (!payload.sdp) return;

    // Glare: if we're mid-offer or have a local-offer pending, we drop
    // the remote offer. werift can't roll back, so we play impolite.
    // Browser perfect-negotiation handles this when browser is polite
    // (browser_pk > sfu_pk) — it rolls its own offer back.
    if (this.makingOffer || this.pc.signalingState !== 'stable') {
      log.debug('drop remote offer (glare)', {
        remote: this.remotePubkey.slice(0, 8),
        state: this.pc.signalingState,
      });
      return;
    }

    await this.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
    await this.pc.setLocalDescription(); // produces answer
    const answerSdp = this.pc.localDescription?.sdp;
    if (!answerSdp) {
      log.warn('handleOffer: no answer SDP produced');
      return;
    }
    await this.send({
      type: 'answer',
      sdp: answerSdp,
      sessionId: this.sessionId,
      seq: this.outboundSeq++,
    });
  }

  private async handleAnswer(payload: VoiceSignalPayload): Promise<void> {
    if (!payload.sdp) return;
    if (this.pc.signalingState !== 'have-local-offer') {
      log.debug('drop answer: wrong signaling state', {
        state: this.pc.signalingState,
      });
      return;
    }
    await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
  }

  private async handleIce(payload: VoiceSignalPayload): Promise<void> {
    const cands = payload.candidates ?? [];
    for (const c of cands) {
      try {
        // werift's addIceCandidate is strict about undefined fields
        // (its RTCIceCandidateInit uses `string | null`). Browser
        // toJSON output uses `null` for unset, so normalize either way:
        // drop fields that are undefined, keep fields that are null.
        const init: {
          candidate?: string;
          sdpMid?: string | null;
          sdpMLineIndex?: number | null;
          usernameFragment?: string | null;
        } = {};
        if (c.candidate !== undefined) init.candidate = c.candidate;
        if (c.sdpMid !== undefined) init.sdpMid = c.sdpMid;
        if (c.sdpMLineIndex !== undefined) init.sdpMLineIndex = c.sdpMLineIndex;
        if (c.usernameFragment !== undefined) init.usernameFragment = c.usernameFragment;
        await this.pc.addIceCandidate(init);
      } catch (err) {
        // ICE candidates can race the SDP — werift may throw if the
        // remote description isn't applied yet. Drop and continue.
        log.debug('addIceCandidate failed (often benign)', {
          err: (err as Error).message,
        });
      }
    }
  }
}

/**
 * werift's MediaStreamTrack has both `id?: string` and `uuid: string`.
 * `id` is set when negotiated via SDP; `uuid` is always present. Prefer
 * `id` for parity with the browser's track.id (which is what trackInfo
 * payloads carry), fall back to `uuid` so we always have a stable key.
 */
function trackIdOf(track: MediaStreamTrack): string {
  return track.id ?? track.uuid;
}

function randomSessionId(): string {
  return Math.random().toString(36).slice(2, 10);
}
