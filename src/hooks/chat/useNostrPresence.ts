'use client';

import { useEffect } from 'react';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { getNDK, connectNDK } from '@/lib/nostr';
import { useChatStore } from '@/store/chat';

/** A user counts as online if they published an event in this window. */
export const PRESENCE_WINDOW_MS = 15 * 60 * 1000;

/** How often the UI re-evaluates the window (so users fade to offline). */
const TICK_INTERVAL_MS = 30 * 1000;

/** Event kinds that mean "this user is alive on the relays right now". */
const ACTIVITY_KINDS = [
  0,     // metadata update
  1,     // text note
  3,     // contacts
  6,     // repost
  7,     // reaction
  9735,  // zap receipt
  30023, // long-form
];

/**
 * Subscribes to recent Nostr events authored by the given pubkeys to drive
 * the member-list online indicator. No server involved — relays only.
 *
 * Real human pubkeys are 64-char hex; we filter out bot ids (`bot:*`) that
 * live only in our store.
 */
export function useNostrPresence(pubkeys: string[]): void {
  const recordActivity = useChatStore((s) => s.recordActivity);
  const bumpPresenceTick = useChatStore((s) => s.bumpPresenceTick);

  // Stable join key so we re-subscribe only when the member set actually changes.
  const authors = pubkeys.filter((pk) => /^[0-9a-f]{64}$/i.test(pk)).sort();
  const key = authors.join(',');

  useEffect(() => {
    if (!authors.length) return;

    let cancelled = false;
    let sub: { stop: () => void } | null = null;

    (async () => {
      await connectNDK();
      if (cancelled) return;
      const ndk = getNDK();
      const since = Math.floor((Date.now() - PRESENCE_WINDOW_MS) / 1000);
      const s = ndk.subscribe(
        { kinds: ACTIVITY_KINDS, authors, since },
        { closeOnEose: false },
      );
      s.on('event', (ev: NDKEvent) => {
        const ts = (ev.created_at ?? 0) * 1000;
        if (ts > 0 && ev.pubkey) recordActivity(ev.pubkey, ts);
      });
      sub = s as unknown as { stop: () => void };
    })();

    return () => {
      cancelled = true;
      try { sub?.stop(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const id = window.setInterval(() => bumpPresenceTick(), TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [bumpPresenceTick]);
}
