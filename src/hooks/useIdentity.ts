/**
 * Single React-side surface for identity state. Backed by the
 * `nostr-bridge` (NIP-29 SimplePool wrapper). There is no server-validated
 * cookie or backend session anymore — Obelisk is fully Nostr/relays-only,
 * and identity comes straight from the in-memory bridge session that's
 * persisted to localStorage on login.
 *
 * Consumers should prefer this hook over reading individual bridge
 * subscriptions when they need a snapshot. For single-field reads,
 * use the bridge hooks directly (`useMyPubkey`, `useIsLoggedIn`, etc.)
 * to minimize re-renders.
 */

'use client';

import {
  useIsLoggedIn,
  useMyPubkey,
  useMyLoginMethod,
  useUserMetadata,
  useSignerReady,
  type JsUserMetadata,
} from '@/lib/nostr-bridge';

export interface IdentitySnapshot {
  /** Active session pubkey hex, or `null` when logged out. */
  pubkey: string | null;
  /**
   * Kind:0 metadata (display name, avatar, etc.) for the local user, or
   * `null` if not yet fetched. The bridge resolves this on login.
   */
  profile: JsUserMetadata | null;
  /** Login method used for the active session. */
  loginMethod: 'nsec' | 'nip07' | 'bunker' | null;
  /** The bridge has a connected relay session for the current user. */
  isConnected: boolean;
  /**
   * The bridge can sign + publish. Always `true` for nsec/NIP-07 once
   * logged in; for NIP-46 bunker it additionally requires the BunkerSigner
   * to have handshaken with its bunker relay.
   */
  signerReady: boolean;
}

export function useIdentity(): IdentitySnapshot {
  const pubkey = useMyPubkey();
  const profile = useUserMetadata(pubkey);
  const loginMethod = useMyLoginMethod();
  const isConnected = useIsLoggedIn();
  const signerReady = useSignerReady();

  return { pubkey, profile, loginMethod, isConnected, signerReady };
}
