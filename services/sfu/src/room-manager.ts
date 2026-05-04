/**
 * Owns the set of active rooms. Single instance, holds the `Map<channelId, Room>`.
 * Concurrency note: all event-driven code in this service runs on the
 * Node main thread, so plain Map mutation is safe — no locks needed.
 */
import { createLogger } from './log.js';
import { Room } from './room.js';
import type { Config } from './config.js';
import type { MembershipTracker } from './membership.js';
import type { RelayPool } from './relay.js';
import type { Hex, RoomRules, RoomSnapshot } from './types.js';

const log = createLogger('rooms');

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly cfg: Config,
    private readonly relay: RelayPool,
    private readonly membership: MembershipTracker,
  ) {}

  size(): number {
    return this.rooms.size;
  }

  get(channelId: string): Room | undefined {
    return this.rooms.get(channelId);
  }

  list(): RoomSnapshot[] {
    return Array.from(this.rooms.values()).map((r) => r.snapshot());
  }

  async start(channelId: string, hostPubkey: Hex, rules: RoomRules): Promise<Room> {
    if (this.rooms.has(channelId)) {
      throw new Error(`room already active for channel ${channelId}`);
    }
    const room = new Room({
      channelId,
      hostPubkey,
      rules,
      cfg: this.cfg,
      relay: this.relay,
      membership: this.membership,
      onClosed: (id) => this.rooms.delete(id),
    });
    this.rooms.set(channelId, room);
    try {
      await room.start();
    } catch (err) {
      this.rooms.delete(channelId);
      throw err;
    }
    return room;
  }

  async end(channelId: string): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room) return;
    await room.close();
  }

  /**
   * Drain — stop accepting new rooms, let existing ones finish naturally.
   * Used by SIGUSR1.
   */
  setDraining(): void {
    log.info('drain requested — no new rooms will be accepted (existing rooms continue)');
    // call-listener checks `size()` against `cfg.maxRooms`; we don't have
    // a separate "no-more-starts" flag here. Simplest implementation:
    // raise the floor to current size so additional starts are refused.
    // Implemented as a private flag so the listener can consult it.
    this.draining = true;
  }

  isDraining(): boolean {
    return this.draining;
  }

  private draining = false;

  async closeAll(): Promise<void> {
    log.info('closing all rooms', { count: this.rooms.size });
    const all = Array.from(this.rooms.values());
    await Promise.allSettled(all.map((r) => r.close()));
    this.rooms.clear();
  }
}
