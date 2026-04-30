'use client';

import { useMemo, useState } from 'react';
import { useDMStore } from '@/store/dm';
import { useAuthStore } from '@/store/auth';
import { npubToHex, formatPubkey } from '@/lib/nostr';
import { useProfile } from '@/lib/nostr-hooks';
import { useNostrUserSearch, type UserHit } from '@/lib/hooks/useNostrUserSearch';

interface DMComposerProps {
  onClose: () => void;
  /** Optional fallback display name/picture for direct-paste pubkeys that
   *  haven't shown up on relays yet. */
  profileCache?: Map<string, { name?: string; picture?: string }>;
}

interface RowProfile {
  pubkey: string;
  displayName: string | null;
  picture: string | null;
  nip05?: string | null;
}

function resolveToHex(input: string): string | null {
  return input.trim() ? npubToHex(input) : null;
}

function ResultRow({
  profile,
  badge,
  onClick,
}: {
  profile: RowProfile;
  badge?: string;
  onClick: () => void;
}) {
  const name = profile.displayName ?? formatPubkey(profile.pubkey);
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-lc-border/40 transition-colors text-left"
      data-testid="dm-search-result"
      data-pubkey={profile.pubkey}
    >
      {profile.picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.picture} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-lc-olive flex items-center justify-center text-lc-green text-xs font-semibold shrink-0">
          {(name[0] || '?').toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-lc-white truncate">{name}</span>
          {badge && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-lc-green/15 text-lc-green border border-lc-green/30 shrink-0">
              {badge}
            </span>
          )}
        </div>
        {profile.nip05 ? (
          <p className="text-[11px] text-lc-muted truncate">{profile.nip05}</p>
        ) : (
          <p className="text-[11px] text-lc-muted truncate font-mono">{formatPubkey(profile.pubkey)}</p>
        )}
      </div>
    </button>
  );
}

export default function DMComposer({ onClose, profileCache }: DMComposerProps) {
  const [pubkey, setPubkey] = useState('');
  const [error, setError] = useState('');

  const { addThread, setActiveDM } = useDMStore();
  const myPubkey = useAuthStore((s) => s.profile?.pubkey ?? null);

  const partnerHex = useMemo(() => resolveToHex(pubkey), [pubkey]);
  const profileEntry = useProfile(myPubkey, partnerHex);

  // Reuse the standards-only Nostr search hook (NIP-19 / NIP-05 / NIP-50).
  // The hook handles its own debounce and skips when the input is already
  // a parseable identity, so we just feed it the raw text.
  const { nip05Hit, nostrResults, loading: searchLoading } = useNostrUserSearch(pubkey);

  // Pull the kind-0 profile for a resolved NIP-05 hit so we can render an
  // avatar + display name instead of just the bare pubkey.
  const nip05Profile = useProfile(myPubkey, nip05Hit?.pubkey ?? null);

  const showSearchSections = pubkey.trim().length >= 2 && !partnerHex;

  const filteredNostrResults = useMemo<RowProfile[]>(() => {
    return nostrResults
      .filter((r) => !myPubkey || r.pubkey !== myPubkey)
      .filter((r) => r.pubkey !== nip05Hit?.pubkey);
  }, [nostrResults, myPubkey, nip05Hit]);

  const startChatWith = (pk: string, profile?: { displayName?: string | null; picture?: string | null }) => {
    addThread({
      pubkey: pk,
      displayName: profile?.displayName ?? pk.slice(0, 8) + '...',
      picture: profile?.picture ?? undefined,
      unreadCount: 0,
    });
    setActiveDM(pk);
    onClose();
  };

  const handleStart = () => {
    const pk = resolveToHex(pubkey);
    if (!pk) return;
    const liveParsed = partnerHex === pk ? profileEntry?.parsed : undefined;
    const legacy = profileCache?.get(pk);
    const displayName = liveParsed?.displayName ?? liveParsed?.name ?? legacy?.name ?? pk.slice(0, 8) + '...';
    const picture = liveParsed?.picture ?? legacy?.picture;
    startChatWith(pk, { displayName, picture });
  };

  const previewParsed = profileEntry?.parsed;
  const previewName = previewParsed?.displayName ?? previewParsed?.name;
  const previewPicture = previewParsed?.picture;

  const nip05Row: RowProfile | null = nip05Hit
    ? {
        pubkey: nip05Hit.pubkey,
        displayName: nip05Profile?.parsed?.displayName ?? nip05Profile?.parsed?.name ?? null,
        picture: nip05Profile?.parsed?.picture ?? null,
        nip05: nip05Hit.nip05,
      }
    : null;
  const noResults =
    showSearchSections &&
    !searchLoading &&
    !nip05Row &&
    filteredNostrResults.length === 0;

  return (
    <div
      className="absolute left-0 right-0 z-20 flex flex-col bg-lc-dark/95 backdrop-blur-sm border-b border-lc-border shadow-lg"
      data-testid="dm-composer"
    >
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={pubkey}
            onChange={(e) => { setPubkey(e.target.value); setError(''); }}
            placeholder="Search by name, nip-05, npub or hex"
            className="w-full pl-3 pr-9 py-2 rounded-lg bg-lc-black border border-lc-border text-lc-white text-sm placeholder:text-lc-muted focus:border-lc-green focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            autoFocus
            data-testid="new-dm-pubkey-input"
          />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-lc-muted hover:text-lc-white hover:bg-lc-border/60 transition-colors"
            aria-label="Close search"
            data-testid="dm-composer-cancel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {partnerHex && (
          <div
            className="flex items-center gap-2.5 mt-2 p-2 rounded-lg bg-lc-black/60 border border-lc-border"
            data-testid="new-dm-preview"
          >
            {previewPicture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewPicture} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-lc-border" />
            )}
            <span className="text-sm text-lc-white truncate flex-1">
              {previewName ?? formatPubkey(partnerHex)}
            </span>
            <button
              onClick={handleStart}
              className="lc-pill-primary px-3 py-1 text-xs font-medium shrink-0"
              data-testid="start-dm-btn"
            >
              Start
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-400 mt-2" data-testid="new-dm-error">{error}</p>}
      </div>

      {showSearchSections && (
        <div className="max-h-72 overflow-y-auto px-2 pt-1 pb-2 border-t border-lc-border bg-lc-black/30" data-testid="dm-search-results">
          {nip05Row && (
            <section className="mb-2" data-testid="dm-search-nip05-section">
              <header className="flex items-center justify-between px-1 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-lc-muted">
                  NIP-05 lookup
                </span>
              </header>
              <ResultRow
                profile={nip05Row}
                badge="NIP-05"
                onClick={() => startChatWith(nip05Row.pubkey, { displayName: nip05Row.displayName, picture: nip05Row.picture })}
              />
            </section>
          )}

          <section>
            <header className="flex items-center justify-between px-1 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-lc-muted">
                On Nostr
              </span>
              {searchLoading && (
                <span className="text-[10px] text-lc-muted" data-testid="dm-search-nostr-loading">
                  Searching…
                </span>
              )}
            </header>
            {filteredNostrResults.length === 0 && !searchLoading ? (
              <p className="px-1 text-xs text-lc-muted">No relay matches yet</p>
            ) : (
              <div className="flex flex-col" data-testid="dm-search-nostr-results">
                {filteredNostrResults.map((r) => (
                  <ResultRow
                    key={`nostr-${r.pubkey}`}
                    profile={r}
                    onClick={() => startChatWith(r.pubkey, { displayName: r.displayName, picture: r.picture })}
                  />
                ))}
              </div>
            )}
          </section>

          {noResults && (
            <p className="px-1 mt-2 text-xs text-lc-muted" data-testid="dm-search-empty">
              Nothing found. Paste an npub or hex pubkey to message anyone directly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
