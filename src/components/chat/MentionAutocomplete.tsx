'use client';

import { useEffect, useRef } from 'react';
import type { MemberInfo } from '@/lib/mentions';

interface Props {
  members: MemberInfo[];
  selectedIndex: number;
  onSelect: (member: MemberInfo) => void;
  onHover: (index: number) => void;
  onClose: () => void;
}

export default function MentionAutocomplete({ members, selectedIndex, onSelect, onHover, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (members.length === 0) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-48 overflow-y-auto rounded-xl border border-lc-border bg-lc-dark shadow-lg"
      data-testid="mention-autocomplete"
    >
      {members.map((m, i) => (
        <button
          key={m.pubkey}
          ref={(el) => { itemRefs.current[i] = el; }}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onSelect(m); }}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
            i === selectedIndex ? 'bg-lc-border/60' : 'hover:bg-lc-border/40'
          }`}
          data-testid="mention-option"
        >
          {m.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.picture} alt="" className="h-6 w-6 rounded-full object-cover" />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-lc-border text-xs font-semibold text-lc-green">
              {m.displayName[0]?.toUpperCase() || '?'}
            </div>
          )}
          <span className="truncate text-sm font-medium text-lc-white">{m.displayName}</span>
          <span className="ml-auto truncate text-xs text-lc-muted">{m.pubkey.slice(0, 8)}…</span>
        </button>
      ))}
    </div>
  );
}
