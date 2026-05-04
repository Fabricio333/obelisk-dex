/**
 * Authorization checks. The four-layer model lives in docs/sfu-system.md §4:
 *   1. Operator   — full powers (set via SFU_OPERATOR_PUBKEY).
 *   2. SFU allow  — `start` events.
 *   3. Per-call   — restricts dials within a single call.
 *   4. NIP-29     — anyone outside member list is dropped at the door.
 */
import type { Config } from './config.js';
import type { Hex, RoomRules } from './types.js';

/** Layer 1: is this pubkey the operator? */
export function isOperator(cfg: Config, sfuPubkey: Hex, sender: Hex): boolean {
  // If no explicit operator key configured, the SFU's own pubkey is the
  // operator. Useful for solo deploys where the operator and SFU are the
  // same nsec.
  const op = cfg.operatorPubkey ?? sfuPubkey;
  return sender === op;
}

/** Layer 2: is this pubkey in the SFU's allow-list? */
export function isAllowedToStart(cfg: Config, sfuPubkey: Hex, sender: Hex): boolean {
  return isOperator(cfg, sfuPubkey, sender) || cfg.allowedPubkeys.has(sender);
}

/**
 * Layers 3 + 4: combined per-room dial check.
 *
 * Used at signaling intake: every incoming kind 25050 offer addressed to
 * the SFU is gated through this. NIP-29 membership is supplied by the
 * caller (membership tracker) since the SFU subscribes to 39002 per
 * channel — separating the lookup keeps this function pure for testing.
 */
export interface DialContext {
  rules: RoomRules;
  /** Current NIP-29 channel members (kind 39002). */
  members: ReadonlySet<Hex>;
  hostPubkey: Hex;
  sender: Hex;
}

export function canDialRoom(ctx: DialContext): { ok: true } | { ok: false; reason: string } {
  // Layer 4: must be a NIP-29 channel member. The host themselves is
  // exempted explicitly because some flows publish the start event before
  // the host appears on the 39002 list (e.g. they were just added) — but
  // since the host signed the start, they're trusted to dial.
  if (ctx.sender !== ctx.hostPubkey && !ctx.members.has(ctx.sender)) {
    return { ok: false, reason: 'not-a-channel-member' };
  }
  // Layer 3: per-call deny is absolute.
  if (ctx.rules.deny.includes(ctx.sender)) {
    return { ok: false, reason: 'denied' };
  }
  // Layer 3: per-call allow restricts further when set.
  if (ctx.rules.allow !== null && !ctx.rules.allow.includes(ctx.sender)) {
    return { ok: false, reason: 'not-in-allow' };
  }
  return { ok: true };
}

/**
 * Who can issue control events (`end`, `kick`, `update`) for an existing
 * room? The host who started it, plus the operator. Plain allow-list
 * membership is NOT enough — that lets anyone in the allow-list end
 * other people's calls, which is bad UX.
 */
export function canManageRoom(
  cfg: Config,
  sfuPubkey: Hex,
  sender: Hex,
  hostPubkey: Hex,
): boolean {
  return sender === hostPubkey || isOperator(cfg, sfuPubkey, sender);
}
