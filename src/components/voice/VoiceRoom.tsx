'use client';

/**
 * Voice channel room. Owns one VoiceClient and renders:
 *   - a video grid (one tile per video-active participant + you when cam-on)
 *   - audio-only badge tiles for participants with no video
 *   - a screen-share strip on top when anyone is sharing
 *   - a sticky bottom control bar (mic / deafen / cam / screen / leave)
 *
 * Authorization: subscribes to NIP-29 admins (39001) and members (39002) for
 * the channel. Until both feeds settle, we show a spinner. Admins are treated
 * as members for join eligibility — kind 39001 doesn't always duplicate into
 * 39002.
 *
 * Background-call wiring: on join we register the client in the active-client
 * singleton and mirror local-track / connection state into `useVoiceStore`,
 * so the sidebar `VoiceStatusBar` can drive the call after the user navigates
 * away.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VoiceClient, type RemoteTrack } from '@/lib/voice/client';
import { setActiveVoiceClient, getActiveVoiceClient } from '@/lib/voice/active-client';
import { getBridge } from '@/lib/nostr-bridge/client';
import type { NostrBridge } from '@/lib/nostr-bridge/types';
import { useVoiceStore } from '@/store/voice';
import { useUserMetadata } from '@/lib/nostr-bridge';
import VoiceControls from './VoiceControls';

interface Props {
  channelId: string;
  channelName?: string;
  /** Optional companion text-chat. Rendered as a sibling to the right of the
   *  voice room and toggled by the chat button on the control bar. */
  chatSlot?: React.ReactNode;
  isChatOpen?: boolean;
  onToggleChat?: () => void;
}

type AuthGate =
  | { phase: 'init' }
  | { phase: 'loading-roles' }
  | { phase: 'not-a-member' }
  | { phase: 'ready'; members: readonly string[]; admins: readonly string[] };

export default function VoiceRoom({ channelId, channelName, chatSlot, isChatOpen, onToggleChat }: Props) {
  const router = useRouter();
  const clientRef = useRef<VoiceClient | null>(null);
  const [gate, setGate] = useState<AuthGate>({ phase: 'init' });
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [remoteTracks, setRemoteTracks] = useState<RemoteTrack[]>([]);
  const [local, setLocal] = useState<{ mic: boolean; camera: boolean; screen: boolean }>({ mic: false, camera: false, screen: false });
  const [selfPubkey, setSelfPubkey] = useState<string>('');
  // Whether the user has explicitly joined this channel's call. Navigating
  // into a voice channel only shows a join landing — actual mic/peer logic
  // starts when the user clicks "Join voice channel". If we mount and find
  // an existing active call on this channel, we auto-flip this to true.
  const [joined, setJoined] = useState<boolean>(() => {
    const c = getActiveVoiceClient();
    return !!(c && c.channelId === channelId && c.isJoined());
  });

  // Phase 1 — bridge + role subscriptions, gate decision.
  useEffect(() => {
    let cancelled = false;
    let bridgeRef: NostrBridge | null = null;
    let unsubMembers: (() => void) | null = null;
    let unsubAdmins: (() => void) | null = null;

    let latestMembers: readonly string[] = [];
    let latestAdmins: readonly string[] = [];
    let membersSeen = false;
    let adminsSeen = false;
    let resolveTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    setGate({ phase: 'loading-roles' });

    (async () => {
      try {
        const bridge = await getBridge();
        if (cancelled) return;
        bridgeRef = bridge;
        const pk = bridge.getPublicKey();
        if (!pk) {
          setError('You must be logged in to join voice.');
          return;
        }
        setSelfPubkey(pk);

        const decide = () => {
          if (cancelled) return;
          clientRef.current?.updateRoles(latestMembers, latestAdmins);
          if (latestMembers.includes(pk) || latestAdmins.includes(pk)) {
            setGate({ phase: 'ready', members: latestMembers, admins: latestAdmins });
          } else {
            setGate({ phase: 'not-a-member' });
          }
        };

        const tryResolve = () => {
          if (cancelled || !membersSeen) return;
          // Resolve immediately if already a match on members, or if both
          // feeds have arrived. Otherwise hold for a brief grace window so
          // an admin-only user isn't denied because 39001 lagged 39002.
          if (latestMembers.includes(pk) || adminsSeen) {
            if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
            decide();
            return;
          }
          if (!graceTimer) {
            graceTimer = setTimeout(() => { graceTimer = null; decide(); }, 1500);
          }
        };

        unsubMembers = bridge.subscribeMembers(channelId, (members) => {
          latestMembers = members;
          membersSeen = true;
          tryResolve();
        });
        unsubAdmins = bridge.subscribeAdmins(channelId, (admins) => {
          latestAdmins = admins;
          adminsSeen = true;
          tryResolve();
        });

        resolveTimer = setTimeout(() => {
          if (!cancelled && !membersSeen) {
            setError('Could not load channel membership. Is this a valid channel id?');
          }
        }, 8000);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      if (resolveTimer) clearTimeout(resolveTimer);
      if (graceTimer) clearTimeout(graceTimer);
      unsubMembers?.();
      unsubAdmins?.();
      void bridgeRef;
    };
  }, [channelId]);

  // Phase 2 — once gated AND the user has explicitly joined, attach to an
  // existing call on this channel or start a fresh one. We deliberately do
  // NOT call `leave()` on unmount so the call survives navigating away (the
  // persistent VoiceStatusBar in the sidebar drives it from the background).
  // Only the explicit Leave button tears the call down.
  useEffect(() => {
    if (gate.phase !== 'ready') return;
    if (!joined) return;
    let cancelled = false;
    const store = useVoiceStore.getState();
    store.setError(null);

    const events = {
      onParticipantsChange: (p: string[]) => { if (!cancelled) setParticipants(p); },
      onRemoteTracksChange: (t: RemoteTrack[]) => { if (!cancelled) setRemoteTracks(t); },
      onLocalTracksChange: (l: { mic: boolean; camera: boolean; screen: boolean }) => {
        if (cancelled) return;
        setLocal(l);
        const s = useVoiceStore.getState();
        s.setMuted(!l.mic);
        s.setCameraOn(l.camera);
        s.setScreenSharing(l.screen);
      },
      onError: (m: string) => {
        if (cancelled) return;
        setError(m);
        useVoiceStore.getState().setError(m);
      },
    };

    const existing = getActiveVoiceClient();
    if (existing && existing.channelId === channelId && existing.isJoined()) {
      // Reattach to the live call.
      existing.setEvents(events);
      clientRef.current = existing;
      setParticipants(existing.getParticipants());
      setRemoteTracks(existing.getRemoteTracks());
      const tracks = existing.getLocalTracks();
      const localState = { mic: !!tracks.mic, camera: !!tracks.camera, screen: !!tracks.screen };
      setLocal(localState);
      const s = useVoiceStore.getState();
      s.setMuted(!localState.mic);
      s.setCameraOn(localState.camera);
      s.setScreenSharing(localState.screen);
      s.setVoiceChannel(channelId);
      s.setConnecting(false);
      return () => {
        cancelled = true;
        // Leave the active client running. Just stop receiving events here.
        if (clientRef.current === existing) {
          existing.setEvents({});
          clientRef.current = null;
        }
      };
    }

    // Different channel or no active call → if there's a stale call on a
    // different channel, leave it before starting a new one.
    if (existing && existing.channelId !== channelId) {
      void existing.leave();
      setActiveVoiceClient(null);
    }

    store.setConnecting(true);
    let client: VoiceClient | null = null;

    (async () => {
      try {
        client = new VoiceClient(channelId, { members: gate.members, admins: gate.admins, events });
        clientRef.current = client;
        setActiveVoiceClient(client);
        await client.join();
        if (cancelled) return;
        const s = useVoiceStore.getState();
        s.setVoiceChannel(channelId);
        s.setConnecting(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          setError(msg);
          useVoiceStore.getState().setError(msg);
          useVoiceStore.getState().setConnecting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Detach from React state but keep the call running. Explicit leave
      // is via the Leave button (which calls our `leave` callback below).
      if (clientRef.current) {
        clientRef.current.setEvents({});
        clientRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.phase, channelId, joined]);

  const leave = useCallback(async () => {
    const c = clientRef.current ?? getActiveVoiceClient();
    clientRef.current = null;
    if (c) await c.leave();
    setActiveVoiceClient(null);
    useVoiceStore.getState().leaveVoice();
    setJoined(false);
    setParticipants([]);
    setRemoteTracks([]);
    setLocal({ mic: false, camera: false, screen: false });
  }, []);

  // Bucket tracks by pubkey + kind for tile rendering.
  const tracksByPubkey = useMemo(() => {
    const m = new Map<string, { audio?: RemoteTrack; camera?: RemoteTrack; screen?: RemoteTrack; screenAudio?: RemoteTrack }>();
    for (const t of remoteTracks) {
      const slot = m.get(t.pubkey) ?? {};
      if (t.kind === 'audio') slot.audio = t;
      else if (t.kind === 'camera') slot.camera = t;
      else if (t.kind === 'screen') slot.screen = t;
      else if (t.kind === 'screen-audio') slot.screenAudio = t;
      m.set(t.pubkey, slot);
    }
    return m;
  }, [remoteTracks]);

  const localCamStream = useMemo(() => {
    const cam = clientRef.current?.getLocalTracks().camera ?? null;
    return cam ? new MediaStream([cam]) : null;
  }, [local.camera]);
  const localScreenStream = useMemo(() => {
    const s = clientRef.current?.getLocalTracks().screen ?? null;
    return s ? new MediaStream([s]) : null;
  }, [local.screen]);

  // Split participants: those with a video track go in the video grid; the
  // rest get audio-only tiles. Local user joins video grid when cam is on.
  const videoPubkeys: string[] = [];
  const audioPubkeys: string[] = [];
  if (local.camera) videoPubkeys.push(selfPubkey);
  else audioPubkeys.push(selfPubkey);
  for (const pk of participants) {
    if (tracksByPubkey.get(pk)?.camera) videoPubkeys.push(pk);
    else audioPubkeys.push(pk);
  }

  const screenSharers: { pubkey: string; track: RemoteTrack | null; isLocal: boolean }[] = [];
  if (local.screen && localScreenStream) screenSharers.push({ pubkey: selfPubkey, track: null, isLocal: true });
  for (const pk of participants) {
    const s = tracksByPubkey.get(pk)?.screen;
    if (s) screenSharers.push({ pubkey: pk, track: s, isLocal: false });
  }

  if (gate.phase === 'init' || gate.phase === 'loading-roles') {
    return (
      <CenteredPanel>
        <Spinner />
        <div className="mt-3 text-sm text-neutral-300">Loading channel membership…</div>
        <div className="mt-1 font-mono text-xs text-neutral-500 break-all">{channelId}</div>
        {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
      </CenteredPanel>
    );
  }
  if (gate.phase === 'not-a-member') {
    return (
      <CenteredPanel>
        <div className="text-lg font-semibold">You aren&apos;t a member of this channel.</div>
        <div className="mt-2 text-sm text-neutral-400">Ask an admin to add you, then refresh this page.</div>
        <div className="mt-4 font-mono text-xs text-neutral-500 break-all">{channelId}</div>
        <button
          onClick={() => router.push('/app')}
          className="mt-6 px-4 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 text-sm"
        >
          Back
        </button>
      </CenteredPanel>
    );
  }

  if (!joined) {
    return (
      <div className="flex-1 flex min-h-0 p-2 gap-2" data-testid="voice-channel">
        <div className="flex-1 flex flex-col min-h-0 bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-800 relative overflow-hidden rounded-xl border border-lc-border shadow-xl">
          <div
            className="absolute inset-0 z-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
              backgroundSize: '60px 60px',
            }}
          />
          <div className="relative z-10 px-4 py-2.5 text-white/90">
            <div className="text-[10px] uppercase tracking-wider text-white/60">Voice channel</div>
            <div className="font-medium truncate">{channelName ?? `${channelId.slice(0, 16)}…`}</div>
          </div>
          <div className="relative z-10 flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-white/80">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <div className="text-lg font-semibold text-white mb-1">{channelName ?? 'Voice channel'}</div>
              <div className="text-sm text-white/60 mb-6">No one&apos;s connected here yet — or click below to join.</div>
              <button
                onClick={() => setJoined(true)}
                className="bg-white hover:bg-white/90 text-lc-black px-6 py-2.5 rounded-full text-sm font-semibold transition-colors"
                data-testid="join-voice-btn"
              >
                Join voice channel
              </button>
              {error && <div className="mt-4 text-xs text-red-300">{error}</div>}
            </div>
          </div>
        </div>
        {chatSlot && isChatOpen && chatSlot}
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 p-2 gap-2" data-testid="voice-channel">
      {/* Voice room (gradient background, video grid, audio badges, controls) */}
      <div className="flex-1 flex flex-col min-h-0 bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-800 relative overflow-hidden rounded-xl border border-lc-border shadow-xl">
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        <div className="relative z-10 px-4 py-2.5 flex items-center justify-between text-white/90">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-white/60">Voice channel</div>
            <div className="font-medium truncate">{channelName ?? `${channelId.slice(0, 16)}…`}</div>
          </div>
          <div className="text-xs text-white/70">{participants.length + 1}/4</div>
        </div>

        {error && (
          <div className="relative z-10 mx-4 mb-2 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-500/30 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="relative z-10 flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
          {/* Screen-share strip */}
          {screenSharers.length > 0 && (
            <div className="space-y-3" data-testid="screen-share-area">
              {screenSharers.map((s) => (
                <ScreenTile
                  key={`screen-${s.pubkey}`}
                  pubkey={s.pubkey}
                  isLocal={s.isLocal}
                  videoStream={s.isLocal ? localScreenStream : (s.track?.stream ?? null)}
                  audioStream={s.isLocal ? null : (tracksByPubkey.get(s.pubkey)?.screenAudio?.stream ?? null)}
                />
              ))}
            </div>
          )}

          {/* Video grid */}
          {videoPubkeys.length > 0 && (
            <div
              className={
                'grid gap-3 ' +
                (videoPubkeys.length === 1
                  ? 'grid-cols-1 max-w-2xl mx-auto'
                  : videoPubkeys.length === 2
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4')
              }
              data-testid="video-grid"
            >
              {videoPubkeys.map((pk) => (
                <VideoTile
                  key={pk}
                  pubkey={pk}
                  isLocal={pk === selfPubkey}
                  videoStream={pk === selfPubkey ? localCamStream : (tracksByPubkey.get(pk)?.camera?.stream ?? null)}
                  audioStream={pk === selfPubkey ? null : (tracksByPubkey.get(pk)?.audio?.stream ?? null)}
                />
              ))}
            </div>
          )}

          {/* Audio-only participants */}
          {audioPubkeys.length > 0 && (
            <div data-testid="audio-participants">
              {videoPubkeys.length > 0 && <p className="mb-2 text-xs text-white/60">Audio only</p>}
              <div
                className={
                  videoPubkeys.length > 0
                    ? 'flex flex-wrap gap-2'
                    : audioPubkeys.length === 1
                      ? 'grid grid-cols-1 max-w-2xl mx-auto gap-3'
                      : audioPubkeys.length === 2
                        ? 'grid grid-cols-1 md:grid-cols-2 gap-3'
                        : audioPubkeys.length <= 4
                          ? 'grid grid-cols-2 gap-3'
                          : 'grid grid-cols-2 md:grid-cols-3 gap-3'
                }
              >
                {audioPubkeys.map((pk) => (
                  <AudioTile
                    key={pk}
                    pubkey={pk}
                    isLocal={pk === selfPubkey}
                    audioStream={pk === selfPubkey ? null : (tracksByPubkey.get(pk)?.audio?.stream ?? null)}
                    compact={videoPubkeys.length > 0}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative z-10">
          <VoiceControls onLeave={leave} isChatOpen={isChatOpen} onToggleChat={onToggleChat} />
        </div>
      </div>

      {chatSlot && isChatOpen && chatSlot}
    </div>
  );
}

// ---- Tiles ---------------------------------------------------------------

function VideoTile({ pubkey, isLocal, videoStream, audioStream }: {
  pubkey: string;
  isLocal: boolean;
  videoStream: MediaStream | null;
  audioStream: MediaStream | null;
}) {
  const meta = useUserMetadata(pubkey);
  const name = meta?.displayName || meta?.name || pubkey.slice(0, 8);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    console.log('[voice] video attach', pubkey.slice(0, 8), 'hasStream=', !!videoStream, 'isLocal=', isLocal);
    el.srcObject = videoStream;
    if (videoStream) el.play().catch((e) => console.warn('[voice] video play() rejected', e?.name));
  }, [videoStream, pubkey, isLocal]);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = audioStream;
    if (audioStream) el.play().catch((e) => console.warn('[voice] tile audio play() rejected', e?.name));
  }, [audioStream]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-lc-border bg-black aspect-video" data-testid="video-tile">
      {videoStream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">{name}</div>
      )}
      {!isLocal && <audio ref={audioRef} autoPlay />}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 flex items-center gap-2">
        <span className="text-xs text-white font-medium truncate">
          {isLocal ? `You · ${name}` : name}
        </span>
      </div>
    </div>
  );
}

function AudioTile({ pubkey, isLocal, audioStream, compact }: {
  pubkey: string;
  isLocal: boolean;
  audioStream: MediaStream | null;
  compact: boolean;
}) {
  const meta = useUserMetadata(pubkey);
  const name = meta?.displayName || meta?.name || pubkey.slice(0, 8);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    console.log('[voice] audio attach', pubkey.slice(0, 8), 'hasStream=', !!audioStream, 'tracks=', audioStream?.getAudioTracks().length);
    el.srcObject = audioStream;
    if (audioStream) {
      el.play()
        .then(() => console.log('[voice] audio playing for', pubkey.slice(0, 8)))
        .catch((e) => console.warn('[voice] audio play() rejected for', pubkey.slice(0, 8), e?.name, e?.message));
    }
  }, [audioStream, pubkey]);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-lc-dark border-lc-border" data-testid="voice-participant">
        <Avatar pubkey={pubkey} picture={meta?.picture} name={name} size={8} />
        <span className="text-xs text-lc-white font-medium truncate">{isLocal ? `You · ${name}` : name}</span>
        {!isLocal && <audio ref={audioRef} autoPlay />}
      </div>
    );
  }
  return (
    <div className="relative aspect-video rounded-xl overflow-hidden bg-lc-dark ring-1 ring-lc-border" data-testid="voice-participant">
      <div className="absolute inset-0 flex items-center justify-center">
        <Avatar pubkey={pubkey} picture={meta?.picture} name={name} size={24} />
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur px-2 py-0.5 rounded-md">
        <span className="text-xs text-lc-white font-medium truncate max-w-[12rem]">{isLocal ? `You · ${name}` : name}</span>
      </div>
      {!isLocal && <audio ref={audioRef} autoPlay />}
    </div>
  );
}

function ScreenTile({ pubkey, isLocal, videoStream, audioStream }: {
  pubkey: string;
  isLocal: boolean;
  videoStream: MediaStream | null;
  audioStream: MediaStream | null;
}) {
  const meta = useUserMetadata(pubkey);
  const name = meta?.displayName || meta?.name || pubkey.slice(0, 8);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = videoStream;
    if (videoStream) void el.play().catch(() => {});
  }, [videoStream]);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = audioStream;
    if (audioStream) void el.play().catch(() => {});
  }, [audioStream]);
  return (
    <div className="rounded-xl overflow-hidden border border-lc-green/30 bg-lc-dark">
      <div className="px-3 py-1.5 bg-lc-green/10 border-b border-lc-green/20 text-xs text-lc-green font-medium">
        {isLocal ? 'You are sharing your screen' : `${name} is sharing their screen`}
      </div>
      <div className="relative w-full aspect-video bg-black">
        <video ref={videoRef} autoPlay playsInline muted={isLocal} className="w-full h-full object-contain" />
        {!isLocal && <audio ref={audioRef} autoPlay />}
      </div>
    </div>
  );
}

function Avatar({ pubkey, picture, name, size }: { pubkey: string; picture?: string | null; name: string; size: number }) {
  const px = `${size * 4}px`;
  if (picture) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={picture} alt={name} className="rounded-full object-cover" style={{ width: px, height: px }} />;
  }
  return (
    <div
      className="rounded-full bg-lc-olive flex items-center justify-center text-lc-green font-semibold"
      style={{ width: px, height: px, fontSize: `${Math.max(12, size * 1.5)}px` }}
    >
      {(name[0] ?? pubkey[0])?.toUpperCase()}
    </div>
  );
}

function CenteredPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-black text-white p-6">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-xl p-6 text-center">
        {children}
      </div>
    </div>
  );
}

function Spinner() {
  return <div className="w-6 h-6 border-2 border-neutral-700 border-t-emerald-500 rounded-full animate-spin mx-auto" aria-label="loading" />;
}
