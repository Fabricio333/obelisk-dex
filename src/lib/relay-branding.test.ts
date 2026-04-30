import { describe, it, expect } from 'vitest';
import type { Event as NostrEvent } from 'nostr-tools';
import { parseBranding, toTags, EMPTY_BRANDING, type RelayBranding } from './relay-branding';

const RELAY = 'wss://relay.example';

function fakeEvent(tags: string[][], created_at = 1000): NostrEvent {
  return {
    id: 'x',
    pubkey: 'p',
    created_at,
    kind: 30078,
    tags,
    content: '',
    sig: 's',
  } as NostrEvent;
}

describe('relay-branding', () => {
  it('parses tags into branding fields', () => {
    const ev = fakeEvent([
      ['d', `obelisk:branding:${RELAY}`],
      ['icon', 'https://e/i.png'],
      ['banner', 'https://e/b.png'],
      ['name', 'Relay Name'],
      ['description', 'A relay'],
    ]);
    expect(parseBranding(ev)).toEqual({
      icon: 'https://e/i.png',
      banner: 'https://e/b.png',
      name: 'Relay Name',
      description: 'A relay',
      updatedAt: 1000,
    });
  });

  it('handles missing fields', () => {
    const ev = fakeEvent([['d', `obelisk:branding:${RELAY}`]]);
    expect(parseBranding(ev)).toEqual({ ...EMPTY_BRANDING, updatedAt: 1000 });
  });

  it('round-trips via toTags + parseBranding', () => {
    const b: RelayBranding = {
      icon: 'i', banner: 'b', name: 'n', description: 'd', updatedAt: 42,
    };
    const tags = toTags(b, RELAY);
    expect(tags[0]).toEqual(['d', `obelisk:branding:${RELAY}`]);
    const parsed = parseBranding(fakeEvent(tags, 42));
    expect(parsed).toEqual(b);
  });

  it('omits empty fields from tags', () => {
    const tags = toTags({ ...EMPTY_BRANDING, icon: 'i', updatedAt: 0 }, RELAY);
    const keys = tags.map((t) => t[0]);
    expect(keys).toEqual(['d', 'icon']);
  });
});
