// src/lib/wallet/webln-zap.ts
// Zap a message via NIP-57 + WebLN. Resolves the recipient's lud16, builds a
// signed kind 9734 zap-request tagged with the message's `e` id, fetches an
// invoice from the LNURL callback, and pays it through window.webln.
//
// Why WebLN: the lowest-friction path that doesn't need NWC provisioning —
// any user with Alby (or another WebLN extension) can zap immediately.

import { resolveLightningAddress, requestInvoice } from './lnurl-pay';
import { buildZapRequest, type ZapRequestSigner } from './zap-request';

interface WebLNProvider {
  enable(): Promise<void>;
  sendPayment(invoice: string): Promise<{ preimage: string }>;
}

declare global {
  interface Window {
    webln?: WebLNProvider;
  }
}

export function isWebLNAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.webln;
}

export interface ZapMessageOpts {
  signer: ZapRequestSigner;
  recipientPubkey: string;
  recipientLud16: string;
  /** Omit to zap the user (no `e` tag). */
  messageId?: string;
  amountSats: number;
  relays: string[];
  comment?: string;
}

export async function zapMessageViaWebLN(opts: ZapMessageOpts): Promise<{ preimage: string }> {
  if (!isWebLNAvailable()) throw new Error('No WebLN extension found (try Alby).');
  const webln = window.webln!;
  await webln.enable();

  const params = await resolveLightningAddress(opts.recipientLud16);
  const amountMsat = opts.amountSats * 1000;
  if (amountMsat < params.minSendable || amountMsat > params.maxSendable) {
    throw new Error(
      `Amount out of range (${Math.ceil(params.minSendable / 1000)}–${Math.floor(params.maxSendable / 1000)} sats).`,
    );
  }

  const zapRequest = await buildZapRequest(opts.signer, {
    recipientPubkey: opts.recipientPubkey,
    amountMsat,
    relays: opts.relays.length > 0 ? opts.relays : ['wss://relay.damus.io', 'wss://nos.lol'],
    messageId: opts.messageId,
    comment: opts.comment,
  });

  const { invoice } = await requestInvoice(params.callback, amountMsat, opts.comment, zapRequest);
  return webln.sendPayment(invoice);
}
