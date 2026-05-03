#!/usr/bin/env node
// Obelisk price bot — Nostr client that publishes BTC stats and answers
// price queries in NIP-29 groups. No backend.
//
// Capabilities:
//   1. Profile ticker — publishes kind:0 metadata (display name = "BTC $123,456")
//      to every configured relay. The bot's profile is globally resolvable.
//   2. Group chat updates — periodically posts a kind 9 price summary to each
//      configured (relay, group) pair, gated on price change.
//   3. Slash-command listener — subscribes to kind 9 in each configured group
//      and replies to "!btc", "!price", "!ath" with fresh stats.
//   4. Multi-relay AUTH — signs NIP-42 challenges with the bot nsec.
//
// Configuration (env, typically `.env.local`):
//   BOT_NSEC          required. nsec1... or 64-char hex.
//   BOT_RELAYS        comma-separated relay URLs for kind:0 broadcast.
//                     default: wss://relay.obelisk.ar
//   BOT_GROUPS        comma-separated `relayUrl|groupId` pairs the bot posts
//                     chat into and listens for slash-commands on.
//                     default: <empty> (bot is profile-only)
//                     example: wss://relay.obelisk.ar|dab35d8ad892da76,wss://public.obelisk.ar|deadbeef1234
//   BOT_INTERVAL_MS         default 120000 — price refresh interval.
//   BOT_CHAT_EVERY_N_TICKS  default 0 (off). If >0, publishes kind 9 summary
//                           to every configured group every N price-change ticks.
//   BOT_DISPLAY             default "BTC ${price}" — kind:0 name template.
//
// Legacy: BOT_GROUP_ID still supported — treated as a single group on the
// first BOT_RELAYS entry.

import { SimplePool, finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

const INTERVAL = Number(process.env.BOT_INTERVAL_MS) || 120_000;
const TEMPLATE = process.env.BOT_DISPLAY || 'BTC ${price}';
const CHAT_EVERY_N = Math.max(0, Number(process.env.BOT_CHAT_EVERY_N_TICKS) || 0);

const RELAYS = (process.env.BOT_RELAYS || 'wss://relay.obelisk.ar')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function parseGroups() {
  const out = [];
  const raw = process.env.BOT_GROUPS;
  if (raw) {
    for (const entry of raw.split(',')) {
      const [relay, groupId] = entry.trim().split('|');
      if (!relay || !groupId) continue;
      out.push({ relay: relay.trim(), groupId: groupId.trim() });
    }
  }
  // Legacy single-group fallback.
  if (process.env.BOT_GROUP_ID && out.length === 0) {
    out.push({ relay: RELAYS[0], groupId: process.env.BOT_GROUP_ID.trim() });
  }
  return out;
}
const GROUPS = parseGroups();

function parseSecret(input) {
  const v = input.trim();
  if (v.startsWith('nsec1')) {
    const { type, data } = nip19.decode(v);
    if (type !== 'nsec') throw new Error('BOT_NSEC: not an nsec');
    return data;
  }
  if (/^[0-9a-f]{64}$/i.test(v)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(v.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  throw new Error('BOT_NSEC must be nsec1... or 64-char hex');
}

async function fetchBtcStats() {
  const url =
    'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = await r.json();
  const m = j.market_data;
  return {
    price: Math.round(m.current_price.usd),
    high24: Math.round(m.high_24h.usd),
    low24: Math.round(m.low_24h.usd),
    change24Pct: m.price_change_percentage_24h,
    ath: Math.round(m.ath.usd),
    athChangePct: m.ath_change_percentage.usd,
  };
}

const fmt = (n) => n.toLocaleString('en-US');
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

function summary(s) {
  return [
    `BTC/USD: $${fmt(s.price)} (${pct(s.change24Pct)} 24h)`,
    `24h range: $${fmt(s.low24)} – $${fmt(s.high24)}`,
    `ATH: $${fmt(s.ath)} (${pct(s.athChangePct)} from ATH)`,
    `Updated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`,
  ].join('\n');
}

function commandReply(cmd, s) {
  switch (cmd) {
    case 'price':
    case 'btc':
      return `⚡ BTC/USD $${fmt(s.price)} (${pct(s.change24Pct)} 24h)`;
    case 'ath':
      return `🏔 ATH $${fmt(s.ath)} (${pct(s.athChangePct)} from ATH, currently $${fmt(s.price)})`;
    case 'stats':
      return summary(s);
    case 'help':
      return 'Commands: !btc, !price, !ath, !stats, !help';
    default:
      return null;
  }
}

function sigTerm() {
  console.log('[price-bot] shutting down…');
  process.exit(0);
}

async function main() {
  if (!process.env.BOT_NSEC) {
    console.log('[price-bot] BOT_NSEC not set — bot disabled.');
    return;
  }
  const sk = parseSecret(process.env.BOT_NSEC);
  const pk = getPublicKey(sk);
  const npub = nip19.npubEncode(pk);

  console.log(`[price-bot] pubkey hex:  ${pk}`);
  console.log(`[price-bot] pubkey npub: ${npub}`);
  console.log(`[price-bot] relays:      ${RELAYS.join(', ')}`);
  console.log(`[price-bot] groups:      ${GROUPS.map((g) => `${g.relay}|${g.groupId}`).join(', ') || '(none)'}`);
  console.log(`[price-bot] interval:    ${INTERVAL}ms; chat every ${CHAT_EVERY_N} ticks`);

  // NIP-42 AUTH: sign challenges with the bot nsec on every relay.
  const pool = new SimplePool({
    automaticallyAuth: () => async (evt) => finalizeEvent(evt, sk),
  });

  process.on('SIGINT', sigTerm);
  process.on('SIGTERM', sigTerm);

  // ── Slash-command listener (per group) ──────────────────────────────
  // Subscribes to kind 9 with `#h=groupId` on each group's relay and replies
  // to known commands. Uses an in-memory `seen` set so re-deliveries on
  // reconnect don't re-trigger.
  const seen = new Set();
  for (const { relay, groupId } of GROUPS) {
    pool.subscribe(
      [relay],
      { kinds: [9], '#h': [groupId], since: Math.floor(Date.now() / 1000) - 60 },
      {
        onevent: async (ev) => {
          if (ev.pubkey === pk) return;
          if (seen.has(ev.id)) return;
          seen.add(ev.id);
          const m = ev.content.trim().match(/^!(\w+)/);
          if (!m) return;
          try {
            const s = await fetchBtcStats();
            const reply = commandReply(m[1].toLowerCase(), s);
            if (!reply) return;
            const ev2 = finalizeEvent(
              {
                kind: 9,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['h', groupId], ['e', ev.id], ['p', ev.pubkey]],
                content: reply,
              },
              sk,
            );
            await Promise.any(pool.publish([relay], ev2));
            console.log(`[price-bot] replied !${m[1]} on ${relay} group ${groupId.slice(0, 8)}`);
          } catch (err) {
            console.warn(`[price-bot] command !${m[1]} failed:`, err?.message || err);
          }
        },
      },
    );
  }

  // ── Group hello + join-request, once per group at startup ───────────
  for (const { relay, groupId } of GROUPS) {
    const join = finalizeEvent(
      {
        kind: 9021,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['h', groupId]],
        content: 'price bot join',
      },
      sk,
    );
    try {
      await Promise.any(pool.publish([relay], join));
      console.log(`[price-bot] join-request sent: ${relay} ${groupId.slice(0, 8)}`);
    } catch (err) {
      console.warn(`[price-bot] join-request failed on ${relay}:`, err?.message || err);
    }
    const hello = finalizeEvent(
      {
        kind: 9,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['h', groupId]],
        content:
          '⚡ price bot online — try !btc, !price, !ath, !stats, !help. Add me with kind 9000 to surface me in the member list.',
      },
      sk,
    );
    try {
      await Promise.any(pool.publish([relay], hello));
      console.log(`[price-bot] hello sent: ${relay} ${groupId.slice(0, 8)}`);
    } catch (err) {
      console.warn(`[price-bot] hello failed on ${relay} (likely not admitted yet):`, err?.message || err);
    }
  }

  // ── Price tick: kind:0 ticker, optional periodic kind 9 summary ─────
  let lastPrice = null;
  let priceChangeCount = 0;
  const tick = async () => {
    let s;
    try {
      s = await fetchBtcStats();
    } catch (err) {
      console.warn('[price-bot] tick fetch failed:', err?.message || err);
      return;
    }
    if (s.price === lastPrice) return;
    lastPrice = s.price;
    priceChangeCount += 1;

    const name = TEMPLATE.replace('${price}', fmt(s.price));
    const meta = finalizeEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify({
          name,
          display_name: name,
          about: summary(s),
          picture:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/1280px-Bitcoin.svg.png',
        }),
      },
      sk,
    );
    try {
      await Promise.any(pool.publish(RELAYS, meta));
      console.log(`[price-bot] kind:0 → ${name} (${pct(s.change24Pct)} 24h)`);
    } catch (err) {
      console.warn('[price-bot] kind:0 publish failed:', err?.message || err);
    }

    if (CHAT_EVERY_N > 0 && priceChangeCount % CHAT_EVERY_N === 0) {
      for (const { relay, groupId } of GROUPS) {
        const ev = finalizeEvent(
          {
            kind: 9,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['h', groupId]],
            content: summary(s),
          },
          sk,
        );
        try {
          await Promise.any(pool.publish([relay], ev));
          console.log(`[price-bot] kind:9 → ${relay} ${groupId.slice(0, 8)}`);
        } catch (err) {
          console.warn(`[price-bot] kind:9 publish failed on ${relay}:`, err?.message || err);
        }
      }
    }
  };

  await tick();
  setInterval(tick, INTERVAL);
}

main().catch((err) => {
  console.error('[price-bot] fatal:', err);
  process.exit(1);
});
