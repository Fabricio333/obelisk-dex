/**
 * Thin wrapper over nostr-tools `SimplePool` — the SFU's only Nostr surface.
 *
 * Why not the obelisk-dex bridge? The bridge is React/browser-shaped: it
 * holds session state, manages NIP-46 bunkers, dispatches into Zustand
 * stores. The SFU just needs to publish/subscribe with one fixed local
 * key. SimplePool directly is the right altitude.
 *
 * NIP-42 AUTH is not implemented here. Most public relays don't require
 * it; if your SFU's chosen relay does, you'll see `AUTH-required` notices
 * in the logs and need to point at a different relay or wire up the
 * `automaticallyAuth` callback (nostr-tools docs).
 */
import { SimplePool, type Event, type Filter, type EventTemplate, type VerifiedEvent } from 'nostr-tools';

import { createLogger } from './log.js';
import type { Identity } from './identity.js';

const log = createLogger('relay');

export class RelayPool {
  private readonly pool: SimplePool;
  private closed = false;

  constructor(
    private readonly relays: string[],
    private readonly identity: Identity,
  ) {
    this.pool = new SimplePool();
  }

  get pubkey(): string {
    return this.identity.pubkey;
  }

  /**
   * Sign + publish to all configured relays. Best-effort: a relay
   * rejecting one event is logged but doesn't throw.
   */
  async publish(template: EventTemplate): Promise<VerifiedEvent> {
    const event = this.identity.sign(template);
    const results = this.pool.publish(this.relays, event);

    let firstAck: string | null = null;
    let firstErr: unknown = null;
    await Promise.allSettled(
      results.map((p, i) =>
        p
          .then(() => {
            const relayUrl = this.relays[i];
            if (relayUrl && !firstAck) firstAck = relayUrl;
          })
          .catch((err) => {
            if (!firstErr) firstErr = err;
            log.debug('publish relay rejected', {
              relay: this.relays[i] ?? '(unknown)',
              kind: event.kind,
              err: (err as Error)?.message,
            });
          }),
      ),
    );

    if (!firstAck) {
      log.warn('publish: all relays rejected', { kind: event.kind, err: String(firstErr) });
    } else {
      log.debug('publish ok', { kind: event.kind, ack: firstAck });
    }
    return event;
  }

  /**
   * Subscribe to a filter across all relays. Returns an `unsub` fn.
   * `subscribeMany` in nostr-tools 2.x takes a SINGLE filter — the
   * handler is called once per unique event id across all relays.
   */
  subscribe(
    filter: Filter,
    onEvent: (ev: Event) => void,
    onEose?: () => void,
  ): () => void {
    if (this.closed) {
      log.warn('subscribe after close — no-op');
      return () => undefined;
    }
    const sub = this.pool.subscribeMany(this.relays, filter, {
      onevent: onEvent,
      ...(onEose ? { oneose: onEose } : {}),
    });
    return () => sub.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pool.close(this.relays);
    log.info('relay pool closed');
  }
}
