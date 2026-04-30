// Wrap nostr-bridge's signEventTemplate (works for nsec / nip07 / bunker)
// into the ZapRequestSigner interface used by buildZapRequest. Avoids the
// stale `ndk.signer` problem in the bridge-based login flow.

import { nostrActions } from '@/lib/nostr-bridge';
import type {
  ZapRequestSigner,
  ZapRequestSignedEvent,
  ZapRequestTemplate,
} from './zap-request';

export function bridgeZapRequestSigner(): ZapRequestSigner {
  return {
    signEvent: async (template: ZapRequestTemplate): Promise<ZapRequestSignedEvent> => {
      const signed = await nostrActions.signEventTemplate({
        kind: template.kind,
        content: template.content,
        tags: template.tags,
        created_at: template.created_at,
      });
      return {
        ...template,
        pubkey: signed.pubkey,
        id: signed.id,
        sig: signed.sig,
      };
    },
  };
}
