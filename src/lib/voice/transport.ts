/**
 * Thin Nostr transport for voice channels: presence beacons + per-peer
 * signaling. Sits on top of the existing nostr-bridge so we share the relay
 * pool, signing, and NIP-42 auth retry path.
 *
 * v1 publishes signed plaintext ephemeral events (kinds 20078 / 25050).
 * We can swap to gift-wrap later without changing the transport surface.
 */
import { getBridge, getBridgeImpl } from '@/lib/nostr-bridge/client';
import {
  KIND_VOICE_PRESENCE,
  KIND_VOICE_SIGNAL,
} from '@/lib/nip-kinds';
import type { VoicePresence, VoiceSignalPayload } from './types';

const PRESENCE_TTL_SECONDS = 30;

async function bridge() {
  await getBridge();
  const impl = getBridgeImpl();
  if (!impl) throw new Error('nostr bridge not initialized');
  return impl;
}

/**
 * Publish a presence beacon for the given channel. Caller is responsible for
 * the cadence (every ~15s while in the channel).
 */
export async function publishPresenceBeacon(channelId: string): Promise<void> {
  const b = await bridge();
  const expiration = Math.floor(Date.now() / 1000) + PRESENCE_TTL_SECONDS;
  await b.publishEvent({
    kind: KIND_VOICE_PRESENCE,
    content: '',
    tags: [
      ['e', channelId],
      ['t', 'obelisk-voice-presence'],
      ['expiration', String(expiration)],
    ],
  });
  console.log('[voice] beacon published for', channelId.slice(0, 8));
}

/**
 * Subscribe to presence beacons for a channel. Calls `onChange` with the
 * fresh roster (pubkeys with non-expired beacons) whenever it updates.
 */
export async function subscribeRoster(
  channelId: string,
  onChange: (roster: VoicePresence[]) => void,
): Promise<() => void> {
  const b = await bridge();
  // Per-pubkey newest beacon. We only keep the most recent beacon for each
  // pubkey so that a peer's expiry is driven by their latest publication.
  const latest = new Map<string, VoicePresence>();

  function emit() {
    const now = Math.floor(Date.now() / 1000);
    const live = Array.from(latest.values()).filter((p) => p.expiresAt > now);
    onChange(live);
  }

  // Sweep stale entries roughly twice per TTL so leavers disappear from the
  // roster even if no new beacons arrive.
  const sweep = window.setInterval(emit, (PRESENCE_TTL_SECONDS / 2) * 1000);

  const unsub = b.subscribeFilter(
    {
      kinds: [KIND_VOICE_PRESENCE],
      '#e': [channelId],
    },
    (ev) => {
      console.log('[voice] beacon ←', ev.pubkey.slice(0, 8), 'created_at', ev.created_at);
      const expirationTag = ev.tags.find((t) => t[0] === 'expiration')?.[1];
      const expiresAt = expirationTag
        ? parseInt(expirationTag, 10)
        : ev.created_at + PRESENCE_TTL_SECONDS;
      if (!Number.isFinite(expiresAt)) return;
      const prev = latest.get(ev.pubkey);
      if (prev && prev.createdAt >= ev.created_at) return;
      latest.set(ev.pubkey, {
        pubkey: ev.pubkey,
        channelId,
        createdAt: ev.created_at,
        expiresAt,
      });
      emit();
    },
  );

  emit();

  return () => {
    window.clearInterval(sweep);
    unsub();
  };
}

/**
 * Publish a directed signaling event (offer / answer / ICE / bye) to a peer.
 */
export async function sendSignal(
  channelId: string,
  toPubkey: string,
  payload: VoiceSignalPayload,
): Promise<void> {
  const b = await bridge();
  await b.publishEvent({
    kind: KIND_VOICE_SIGNAL,
    content: JSON.stringify(payload),
    tags: [
      ['p', toPubkey],
      ['e', channelId],
      ['t', 'obelisk-voice-signal'],
    ],
  });
  console.log('[voice] →', payload.type, 'to', toPubkey.slice(0, 8), 'seq', payload.seq);
}

/**
 * Subscribe to incoming signaling events addressed to the local user in the
 * given channel. The bridge filters by the relay's `#p` index, so non-targeted
 * events never hit the callback.
 */
export async function subscribeSignals(
  channelId: string,
  selfPubkey: string,
  onSignal: (fromPubkey: string, payload: VoiceSignalPayload) => void,
): Promise<() => void> {
  const b = await bridge();
  // We deliberately do NOT filter on `#p` here. Some relays don't index
  // p-tags for ephemeral kinds (25050) and silently fail to route addressed
  // signals. We subscribe by `#e` (channel) only and gate by p-tag in the
  // handler — same effect, broader compatibility.
  const since = Math.floor(Date.now() / 1000) - 60;
  return b.subscribeFilter(
    {
      kinds: [KIND_VOICE_SIGNAL],
      '#e': [channelId],
      since,
    },
    (ev) => {
      if (ev.pubkey === selfPubkey) return;
      const targets = ev.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
      if (targets.length > 0 && !targets.includes(selfPubkey)) return;
      try {
        const payload = JSON.parse(ev.content) as VoiceSignalPayload;
        console.log('[voice] ←', payload.type, 'from', ev.pubkey.slice(0, 8), 'seq', payload.seq);
        onSignal(ev.pubkey, payload);
      } catch (e) {
        console.warn('[voice] malformed signal', e);
      }
    },
  );
}

export function getSelfPubkey(): string | null {
  return getBridgeImpl()?.getPublicKey() ?? null;
}
