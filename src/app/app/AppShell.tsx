'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  nostrActions,
  useIsLoggedIn,
  useConnectionState,
  useCurrentRelayUrl,
  useGroups,
  useMessages,
  useUserMetadata,
  useReactions,
  useChildrenByParent,
  useDirectMessages,
  useAdmins,
  useMembers,
  type JsGroup,
  type JsMessage,
  type JsUserMetadata,
} from '@/lib/nostr-bridge';
import { faviconFor, fetchRelayInfo } from '@/lib/relay-info';
import ServerRail from './ServerRail';
import DMList from './DMList';
import LoginModal from './LoginModal';
import UserPanel from './UserPanel';
import SearchBar from './SearchBar';
import MessageContent from '@/components/chat/MessageContent';
import MemberList from '@/components/chat/MemberList';
import VoiceRoom from '@/components/voice/VoiceRoom';
import VoiceStatusBar from '@/components/voice/VoiceStatusBar';
import { useVoiceStore } from '@/store/voice';
import { useVoiceChatPane } from '@/hooks/chat/useVoiceChatPane';
import { useChatStore } from '@/store/chat';
import type { MemberInfo } from '@/lib/mentions';

type View =
  | { kind: 'group'; groupId: string }
  | { kind: 'dm'; peer: string | null }
  | { kind: 'empty' };

const SIDEBAR_KEY = 'obelisk-dex/sidebar-width';
const MEMBERS_KEY = 'obelisk-dex/members-width';
const SHOW_MEMBERS_KEY = 'obelisk-dex/show-members';

export default function AppShell() {
  const isLoggedIn = useIsLoggedIn();
  const conn = useConnectionState();
  const relay = useCurrentRelayUrl();
  const [view, setView] = useState<View>({ kind: 'empty' });

  useEffect(() => {
    if (view.kind === 'group') nostrActions.setActiveGroup(view.groupId);
    else nostrActions.setActiveGroup(null);
  }, [view]);

  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);

  // Deep-link: ?c=<groupId>[&m=<messageId>] auto-selects a channel on first
  // render and (when m is present) scrolls/flashes the target message.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const c = params.get('c');
    const m = params.get('m');
    if (c) setView({ kind: 'group', groupId: c });
    if (m) setPendingMessageId(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL in sync with the active group so refresh / share works.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (view.kind === 'group') url.searchParams.set('c', view.groupId);
    else url.searchParams.delete('c');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [view]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showMembers, setShowMembers] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const v = window.localStorage.getItem(SHOW_MEMBERS_KEY);
    return v === null ? true : v === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SHOW_MEMBERS_KEY, showMembers ? '1' : '0');
  }, [showMembers]);

  if (!isLoggedIn) return <LoginModal />;

  const railMode: { kind: 'dm' } | { kind: 'relay'; url: string } =
    view.kind === 'dm' ? { kind: 'dm' } : { kind: 'relay', url: relay };

  const closeDrawer = () => setSidebarOpen(false);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-lc-black text-lc-white">
      <RelayTopBar relay={relay} onOpenSidebar={() => setSidebarOpen(true)} />
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={closeDrawer}
            aria-hidden
          />
        )}
        {/* Sidebar drawer: fixed on mobile, inline on desktop */}
        <div
          className={
            'flex max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-2xl ' +
            'max-md:transform max-md:transition-transform max-md:duration-200 max-md:ease-in-out ' +
            (sidebarOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full')
          }
        >
          <ServerRail
            mode={railMode}
            onPickDM={() => { setView({ kind: 'dm', peer: null }); closeDrawer(); }}
            onPickRelay={async (url) => {
              if (url !== relay) await nostrActions.switchRelay(url);
              setView({ kind: 'empty' });
              closeDrawer();
            }}
          />
          <ResizablePane storageKey={SIDEBAR_KEY} defaultWidth={264} min={200} max={500}>
            {view.kind === 'dm' ? (
              <DMList
                activePeer={view.peer}
                onPick={(p) => { setView({ kind: 'dm', peer: p }); closeDrawer(); }}
              />
            ) : (
              <Sidebar
                relay={relay}
                conn={conn}
                view={view}
                setView={(v) => { setView(v); closeDrawer(); }}
              />
            )}
          </ResizablePane>
        </div>
        <main className="flex flex-1 flex-col overflow-hidden bg-lc-dark min-w-0 border-l border-t border-r border-lc-border">
          {view.kind === 'group' ? (
            <ChatLayout
              groupId={view.groupId}
              showMembers={showMembers}
              onToggleMembers={() => setShowMembers((v) => !v)}
              pendingMessageId={pendingMessageId}
              onConsumePendingMessageId={() => setPendingMessageId(null)}
            />
          ) : view.kind === 'dm' ? (
            <DMPanel peer={view.peer} onPickPeer={(p) => setView({ kind: 'dm', peer: p })} />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}

function RelayTopBar({ relay, onOpenSidebar }: { relay: string; onOpenSidebar?: () => void }) {
  const [info, setInfo] = useState<{ name?: string; icon?: string } | null>(null);
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setIconFailed(false);
    fetchRelayInfo(relay).then((r) => {
      if (!alive) return;
      setInfo({ name: r?.name, icon: r?.icon || faviconFor(relay) || undefined });
    });
    return () => {
      alive = false;
    };
  }, [relay]);
  const displayName = info?.name || shortHost(relay);
  const iconUrl = info?.icon;
  return (
    <div
      className="h-10 shrink-0 bg-lc-black px-3"
      style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {onOpenSidebar && (
        <button
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-lc-muted hover:text-lc-white hover:bg-lc-border/50 transition-colors md:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      )}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
        <button
          className="p-1.5 rounded-lg text-lc-muted hover:text-lc-white hover:bg-lc-border/40 transition-colors"
          title="Inbox"
          aria-label="Inbox"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        </button>
        <a
          href="/"
          className="p-1.5 rounded-lg text-lc-muted hover:text-lc-white hover:bg-lc-border/40 transition-colors inline-flex"
          title="Help"
          aria-label="Help"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </a>
      </div>
      <div className="flex items-center gap-2 min-w-0 max-w-[60%]">
        {iconUrl && !iconFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={iconUrl}
            alt=""
            onError={() => setIconFailed(true)}
            className="w-5 h-5 rounded-full shrink-0 object-cover"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-lc-olive flex items-center justify-center text-lc-green text-[10px] font-bold shrink-0">
            {displayName[0]?.toUpperCase() || 'R'}
          </div>
        )}
        <span className="text-xs font-semibold text-lc-white truncate">{displayName}</span>
      </div>
    </div>
  );
}

// -- Resizable pane -----------------------------------------------------

function ResizablePane({
  storageKey,
  defaultWidth,
  min,
  max,
  side = 'right',
  children,
}: {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  side?: 'right' | 'left';
  children: React.ReactNode;
}) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultWidth;
    const v = window.localStorage.getItem(storageKey);
    const n = v ? parseInt(v, 10) : defaultWidth;
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : defaultWidth;
  });
  const startRef = useRef<{ x: number; w: number } | null>(null);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    startRef.current = { x: e.clientX, w: width };
    function onMove(ev: MouseEvent) {
      if (!startRef.current) return;
      const delta = ev.clientX - startRef.current.x;
      const next = side === 'right'
        ? startRef.current.w + delta
        : startRef.current.w - delta;
      const clamped = Math.max(min, Math.min(max, next));
      setWidth(clamped);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.localStorage.setItem(storageKey, String(width));
      startRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  const handle = (
    <div
      onMouseDown={onMouseDown}
      className="group/handle relative w-1 cursor-col-resize bg-transparent hover:bg-lc-green/40 active:bg-lc-green/60 max-md:hidden"
      title="Drag to resize"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );

  return (
    <>
      {side === 'left' && handle}
      <div
        style={{ ['--pane-w' as string]: `${width}px` }}
        className="flex shrink-0 flex-col overflow-hidden bg-lc-dark border-l border-t border-r border-lc-border rounded-tl-xl w-[var(--pane-w)] max-md:w-[min(72vw,300px)]"
      >
        {children}
      </div>
      {side === 'right' && handle}
    </>
  );
}

// -- Login --------------------------------------------------------------

// -- Sidebar ------------------------------------------------------------

function Sidebar({
  relay,
  conn,
  view,
  setView,
}: {
  relay: string;
  conn: string;
  view: View;
  setView: (v: View) => void;
}) {
  const groups = useGroups();
  const childrenByParent = useChildrenByParent();
  const groupsById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const roots = useMemo(
    () => groups.filter((g) => !g.parent || !groupsById[g.parent]),
    [groups, groupsById],
  );

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-lc-border px-4 shadow-sm">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-lc-white">{shortHost(relay)}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-lc-muted">
            <span
              className={
                'inline-block h-1.5 w-1.5 rounded-full ' +
                (conn === 'Connected' ? 'bg-lc-green' : conn === 'Connecting' ? 'bg-yellow-500' : 'bg-red-500')
              }
            />
            {conn}
          </div>
        </div>
      </div>

      <CreateGroupSection
        count={groups.length}
        onCreated={(id) => setView({ kind: 'group', groupId: id })}
      />

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <div className="px-2 py-3 text-xs text-lc-muted">Discovering channels… (kind 39000)</div>
        )}
        {roots.map((g) => (
          <GroupNode
            key={g.id}
            group={g}
            depth={0}
            childrenByParent={childrenByParent}
            groupsById={groupsById}
            view={view}
            onSelect={(id) => setView({ kind: 'group', groupId: id })}
          />
        ))}
      </div>

      <div className="shrink-0 border-t border-lc-border bg-lc-card/50">
        <VoiceStatusBar />
        <div className="p-2">
          <SidebarMe />
        </div>
      </div>
    </>
  );
}

function CreateGroupSection({ count, onCreated }: { count: number; onCreated: (groupId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const id = await nostrActions.createGroup({ name: name.trim(), isPublic: true, isOpen: true });
      setName('');
      setOpen(false);
      onCreated(id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 shrink-0">
      <div className="flex items-center justify-between px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-lc-muted">
        <span className="truncate">Channels · {count}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded px-1 text-base leading-none text-lc-muted hover:text-lc-green"
          title={open ? 'Cancel' : 'Create channel'}
          aria-label={open ? 'Cancel' : 'Create channel'}
        >
          {open ? '×' : '+'}
        </button>
      </div>
      {open && (
        <form onSubmit={submit} className="mb-1 flex flex-col gap-1 px-3 pb-1">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="channel name"
              className="min-w-0 flex-1 rounded border border-lc-border bg-lc-black px-2 py-1 text-xs text-lc-white outline-none focus:border-lc-green"
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="shrink-0 rounded bg-lc-green px-2 py-1 text-[11px] font-semibold text-lc-black disabled:opacity-50"
            >
              {busy ? '…' : 'Create'}
            </button>
          </div>
          {err && <span className="break-words text-[10px] text-red-400">{err}</span>}
        </form>
      )}
    </div>
  );
}

function GroupNode({
  group,
  depth,
  childrenByParent,
  groupsById,
  view,
  onSelect,
}: {
  group: JsGroup;
  depth: number;
  childrenByParent: Readonly<Record<string, ReadonlyArray<string>>>;
  groupsById: Record<string, JsGroup>;
  view: View;
  onSelect: (id: string) => void;
}) {
  const childIds = childrenByParent[group.id] ?? [];
  const active = view.kind === 'group' && view.groupId === group.id;
  return (
    <>
      <button
        onClick={() => onSelect(group.id)}
        style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}
        className={
          'flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left text-sm transition ' +
          (active
            ? 'bg-lc-olive text-lc-white'
            : 'text-lc-muted hover:bg-lc-card hover:text-lc-white')
        }
      >
        {depth > 0 && <span className="text-lc-muted">↳</span>}
        <span className="text-lc-muted">#</span>
        <span className="flex-1 truncate">{group.name ?? group.id.slice(0, 12)}</span>
        {!group.isPublic && <span title="Private" className="text-[10px]">🔒</span>}
        {!group.isOpen && <span title="Closed (invite only)" className="text-[10px]">⊝</span>}
      </button>
      {childIds.map((cid) => {
        const child = groupsById[cid];
        if (!child) return null;
        return (
          <GroupNode
            key={cid}
            group={child}
            depth={depth + 1}
            childrenByParent={childrenByParent}
            groupsById={groupsById}
            view={view}
            onSelect={onSelect}
          />
        );
      })}
    </>
  );
}

function useMyPubkey(): string | null {
  return useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem('obelisk-dex/session')
        ?? window.localStorage.getItem('obeliskord/session');
      return raw ? (JSON.parse(raw) as { pubKeyHex: string }).pubKeyHex : null;
    } catch {
      return null;
    }
  }, []);
}

function SidebarMe() {
  const myPubkey = useMyPubkey();
  const meta = useUserMetadata(myPubkey);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!myPubkey) return null;
  return (
    <div className="relative flex items-center gap-2 px-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded p-1 text-left hover:bg-lc-card"
        title="Account"
      >
        <Avatar pubkey={myPubkey} size={9} picture={meta?.picture ?? null} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-lc-white">
            {meta?.displayName || meta?.name || 'You'}
          </div>
          <div className="truncate font-mono text-[10px] text-lc-muted">{myPubkey.slice(0, 16)}…</div>
        </div>
      </button>
      <button
        onClick={() => setEditing(true)}
        className="shrink-0 rounded p-1.5 text-lc-muted hover:bg-lc-card hover:text-lc-white transition-colors"
        title="Settings"
        aria-label="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
      {open && (
        <UserPanel
          pubkey={myPubkey}
          isMe
          onClose={() => setOpen(false)}
          onLogout={() => { nostrActions.logout(); setOpen(false); }}
        />
      )}
      {editing && (
        <UserPanel
          pubkey={myPubkey}
          isMe
          initialEditing
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// -- Chat layout (chat + member list) -----------------------------------

function ChatLayout({
  groupId,
  showMembers,
  onToggleMembers,
  pendingMessageId,
  onConsumePendingMessageId,
}: {
  groupId: string;
  showMembers: boolean;
  onToggleMembers: () => void;
  pendingMessageId: string | null;
  onConsumePendingMessageId: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChatPanel
        groupId={groupId}
        showMembers={showMembers}
        onToggleMembers={onToggleMembers}
        pendingMessageId={pendingMessageId}
        onConsumePendingMessageId={onConsumePendingMessageId}
      />
    </div>
  );
}

function ChatPanel({
  groupId,
  showMembers,
  onToggleMembers,
  pendingMessageId,
  onConsumePendingMessageId,
}: {
  groupId: string;
  showMembers: boolean;
  onToggleMembers: () => void;
  pendingMessageId: string | null;
  onConsumePendingMessageId: () => void;
}) {
  const messages = useMessages(groupId);
  const reactions = useReactions(groupId);
  const groups = useGroups();
  const group = groups.find((g) => g.id === groupId);
  const admins = useAdmins(groupId);
  const myPubkey = useMyPubkey();
  const isAdmin = !!myPubkey && admins.includes(myPubkey);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<JsMessage | null>(null);
  useEffect(() => { setReplyingTo(null); }, [groupId]);

  useEffect(() => {
    if (!myPubkey || isAdmin) return;
    const key = `obelisk:auto-claim-admin:${groupId}:${myPubkey}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key)) return;
    try { sessionStorage?.setItem(key, '1'); } catch {}
    nostrActions.putUser(groupId, myPubkey, ['admin']).catch(() => {});
  }, [groupId, myPubkey, isAdmin]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceMainRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const voiceChatOpen = useVoiceStore((s) => s.isVoiceChatOpen);
  const setVoiceChatOpen = useVoiceStore((s) => s.setVoiceChatOpen);
  const { voiceChatWidth, onVoiceChatResize: onResize } = useVoiceChatPane(voiceChatOpen, voiceMainRef);

  useEffect(() => {
    if (pendingMessageId) return; // wait for the deep-link scroll instead
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, groupId, pendingMessageId]);

  useEffect(() => {
    if (!pendingMessageId) return;
    const exists = messages.some((m) => m.id === pendingMessageId);
    if (!exists) return; // message not loaded yet — try again on next batch
    const el = document.querySelector(`[data-msg-id="${pendingMessageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-1', 'ring-lc-green');
    setTimeout(() => el.classList.remove('ring-1', 'ring-lc-green'), 1800);
    // Strip ?m= so a refresh doesn't re-trigger.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('m');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
    onConsumePendingMessageId();
  }, [pendingMessageId, messages, onConsumePendingMessageId]);

  const [uploadingMedia, setUploadingMedia] = useState(false);
  async function onPickFile(file: File) {
    setUploadingMedia(true);
    setSendError(null);
    try {
      const { uploadToBlossom } = await import('@/lib/blossom');
      const url = await uploadToBlossom(file);
      // Inline-attach: append the Blossom URL to the draft on its own line.
      // Renderers detect bare image/video URLs and render them as media — same
      // convention used everywhere else in the chat (NIP-92-style).
      setDraft((d) => (d.trim() ? `${d.trim()}\n${url}` : url));
    } catch (err) {
      setSendError((err as Error).message || 'Upload failed');
    } finally {
      setUploadingMedia(false);
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setSendError(null);
    try {
      await nostrActions.sendMessage(
        groupId,
        content,
        replyingTo ? { id: replyingTo.id, pubkey: replyingTo.pubkey } : null,
      );
      setDraft('');
      setReplyingTo(null);
    } catch (err) {
      console.error('send failed', err);
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-lc-border bg-lc-dark px-5 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-xl text-lc-muted">#</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-bold text-lc-white">
                {group?.name ?? groupId.slice(0, 12)}
              </span>
              {isAdmin && (
                <span className="rounded-full bg-lc-green/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-lc-green">
                  Admin
                </span>
              )}
            </div>
            {group?.about && <div className="truncate text-xs text-lc-muted">{group.about}</div>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <button
              onClick={() => setShowSettings(true)}
              className="rounded p-1.5 text-lc-muted hover:bg-lc-card hover:text-lc-white"
              title="Channel settings"
              aria-label="Channel settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          )}
          <button
            onClick={onToggleMembers}
            className={
              'rounded p-1.5 hover:bg-lc-card ' +
              (showMembers ? 'text-lc-green' : 'text-lc-muted hover:text-lc-white')
            }
            title={showMembers ? 'Hide member list' : 'Show member list'}
            aria-label={showMembers ? 'Hide member list' : 'Show member list'}
            aria-pressed={showMembers}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
          <CopyInviteLinkButton groupId={groupId} />
          <SearchBar
            serverName={group?.name ?? 'channel'}
            activeGroupId={groupId}
          />
        </div>
      </header>
      {/* Channel banner intentionally hidden — re-enable once we have a proper layout. */}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
      {(() => {
        const textBody = (
      <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-lc-muted">
            <div className="max-w-md text-center">
              {group ? (
                <>
                  <div className="text-base font-medium text-lc-white">
                    Welcome to #{group.name ?? 'channel'}
                  </div>
                  <div className="mt-1">No messages yet — be the first.</div>
                </>
              ) : (
                <>
                  <div className="text-base font-medium text-lc-white">
                    Channel not visible on this relay
                  </div>
                  <div className="mt-1">
                    The link points to <span className="font-mono text-xs text-lc-muted">{groupId.slice(0, 16)}…</span>
                    , but this relay isn&apos;t exposing it to you. You may need to be added as a member, or switch to the relay that hosts it.
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const grouped =
              prev && prev.pubkey === m.pubkey && m.createdAt - prev.createdAt < 300;
            return (
              <MessageRow
                key={m.id}
                msg={m}
                allMessages={messages}
                reactions={reactions[m.id] ?? []}
                groupId={groupId}
                grouped={!!grouped}
                isAdmin={isAdmin}
                onReply={setReplyingTo}
              />
            );
          })
        )}
      </div>

      <form onSubmit={onSend} className="shrink-0 px-5 pb-5">
        {replyingTo && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-t-md border border-b-0 border-lc-border bg-lc-card/60 px-3 py-1.5 text-xs text-lc-muted">
            <span className="truncate">
              Replying to <ReplyAuthorName pubkey={replyingTo.pubkey} />
              <span className="ml-2 truncate text-lc-muted">{replyingTo.content.slice(0, 80)}</span>
            </span>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="text-lc-muted hover:text-lc-white"
              aria-label="Cancel reply"
            >
              ✕
            </button>
          </div>
        )}
        {sendError && (
          <p className="mb-2 break-words text-xs text-red-400">{sendError}</p>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-lc-border bg-lc-card px-4 py-2 focus-within:border-lc-green">
          <label
            className="cursor-pointer text-lc-muted hover:text-lc-white"
            title="Attach media"
            aria-label="Attach media"
          >
            {uploadingMedia ? (
              <span className="text-[10px] uppercase tracking-wider text-lc-muted">…</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49" />
              </svg>
            )}
            <input
              type="file"
              accept="image/*,video/*"
              className="hidden"
              disabled={uploadingMedia || sending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickFile(f);
                e.target.value = '';
              }}
            />
          </label>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Message #${group?.name ?? groupId.slice(0, 8)}`}
            disabled={sending}
            className="flex-1 bg-transparent text-sm text-lc-white outline-none placeholder:text-lc-muted disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim() || uploadingMedia}
            className="text-xs font-semibold text-lc-green hover:text-lc-green/80 disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </form>
      </>
        );
        if (group?.kind === 'voice') {
          return (
            <VoiceRoom
              channelId={groupId}
              channelName={group?.name ?? undefined}
              isChatOpen={voiceChatOpen}
              onToggleChat={() => setVoiceChatOpen(!voiceChatOpen)}
              chatSlot={
                <aside
                  id="voice-chat-rail"
                  style={{ width: voiceChatWidth }}
                  className="relative flex flex-col min-h-0 shrink-0 my-0 rounded-xl border border-lc-border bg-lc-dark shadow-xl overflow-hidden"
                >
                  <div
                    onMouseDown={onResize}
                    className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-lc-green/40 active:bg-lc-green/60 z-10"
                    title="Drag to resize"
                  />
                  <div className="h-12 px-4 border-b border-lc-border flex items-center justify-between shrink-0">
                    <span className="text-sm font-semibold text-lc-white">Chat</span>
                    <button
                      onClick={() => setVoiceChatOpen(false)}
                      className="text-lc-muted hover:text-lc-white"
                      title="Hide chat"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex flex-1 flex-col min-h-0">{textBody}</div>
                </aside>
              }
            />
          );
        }
        return textBody;
      })()}
        </div>
        {showMembers && group?.kind !== 'voice' && <MembersPanel groupId={groupId} />}
      </div>

      {showSettings && group && (
        <ChannelSettingsModal group={group} onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}

const QUICK_REACTIONS = ['+', '🔥', '⚡', '😂', '🤔'];

function CopyInviteLinkButton({ groupId }: { groupId: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('c', groupId);
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={onCopy}
      className={
        'rounded p-1.5 hover:bg-lc-card hover:text-lc-white ' +
        (copied ? 'text-lc-green' : 'text-lc-muted')
      }
      title={copied ? 'Link copied — only members of this relay can open it' : 'Copy invite link'}
      aria-label="Copy invite link"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
    </button>
  );
}

function ReplyAuthorName({ pubkey }: { pubkey: string }) {
  const meta = useUserMetadata(pubkey);
  const name = meta?.displayName || meta?.name || pubkey.slice(0, 8);
  return <span className="font-semibold text-lc-white">{name}</span>;
}

function ReplyPreviewRow({
  parent,
  onJump,
}: {
  parent: JsMessage;
  onJump: () => void;
}) {
  const meta = useUserMetadata(parent.pubkey);
  const name = meta?.displayName || meta?.name || parent.pubkey.slice(0, 8);
  const preview = parent.content.replace(/\s+/g, ' ').slice(0, 120);
  return (
    <button
      type="button"
      onClick={onJump}
      className="mb-1 flex max-w-full items-center gap-2 truncate text-xs text-lc-muted hover:text-lc-white"
      title="Jump to replied message"
    >
      <span className="text-lc-green">↩</span>
      <span className="font-semibold text-lc-white/80">{name}</span>
      <span className="truncate text-lc-muted">{preview}</span>
    </button>
  );
}

function MessageRow({
  msg,
  allMessages,
  reactions,
  groupId,
  grouped,
  isAdmin,
  onReply,
}: {
  msg: JsMessage;
  allMessages: ReadonlyArray<JsMessage>;
  reactions: ReadonlyArray<{ emoji: string }>;
  groupId: string;
  grouped: boolean;
  isAdmin: boolean;
  onReply: (m: JsMessage) => void;
}) {
  const parent = msg.replyToId
    ? allMessages.find((x) => x.id === msg.replyToId) ?? null
    : null;
  const onJumpToParent = () => {
    if (!parent) return;
    const el = document.querySelector(`[data-msg-id="${parent.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-1', 'ring-lc-green');
      setTimeout(() => el.classList.remove('ring-1', 'ring-lc-green'), 1200);
    }
  };
  const meta = useUserMetadata(msg.pubkey);
  const [showPicker, setShowPicker] = useState(false);
  const myPubkey = useMyPubkey();
  // Dedupe reactions by (pubkey, emoji) — each user can only count once per
  // emoji even if the relay re-delivered or the user double-tapped before the
  // first kind:7 round-tripped.
  const reactionsByEmoji = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of reactions as ReadonlyArray<{ emoji: string; pubkey: string }>) {
      let s = m.get(r.emoji);
      if (!s) { s = new Set(); m.set(r.emoji, s); }
      s.add(r.pubkey);
    }
    return m;
  }, [reactions]);
  const counts = useMemo(
    () => Array.from(reactionsByEmoji.entries())
      .map(([emoji, set]) => [emoji, set.size] as const)
      .sort((a, b) => b[1] - a[1]),
    [reactionsByEmoji],
  );
  const myReactedEmojis = useMemo(() => {
    if (!myPubkey) return new Set<string>();
    const out = new Set<string>();
    for (const [emoji, set] of reactionsByEmoji) if (set.has(myPubkey)) out.add(emoji);
    return out;
  }, [reactionsByEmoji, myPubkey]);
  const onReactionClick = (emoji: string) => {
    if (myReactedEmojis.has(emoji)) return; // already reacted — no-op until retraction is wired
    void nostrActions.sendReaction(msg.id, msg.pubkey, emoji, groupId);
  };
  const [anchor, setAnchor] = useState<{ x: number; y: number; placement?: 'top' | 'bottom' } | null>(null);
  const displayName = meta?.displayName || meta?.name || msg.pubkey.slice(0, 8);
  const openProfile = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAnchor({ x: r.right + 8, y: r.top, placement: r.top > window.innerHeight / 2 ? 'top' : 'bottom' });
  };

  return (
    <div data-msg-id={msg.id} className={'group relative flex gap-3 rounded px-2 py-0.5 hover:bg-lc-card/40 ' + (grouped ? 'mt-0' : 'mt-3')}>
      <div className="w-10 shrink-0">
        {!grouped && (
          <button onClick={openProfile} className="rounded-full transition hover:opacity-80">
            <Avatar pubkey={msg.pubkey} size={10} picture={meta?.picture ?? null} />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <button onClick={openProfile} className="text-sm font-bold text-lc-white hover:underline">{displayName}</button>
            <span className="text-[10px] text-lc-muted">
              {new Date(msg.createdAt * 1000).toLocaleString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
        )}
        {parent && <ReplyPreviewRow parent={parent} onJump={onJumpToParent} />}
        {msg.replyToId && !parent && (
          <div className="mb-1 text-xs italic text-lc-muted">↩ replying to a message</div>
        )}
        <div className="break-words text-sm text-lc-white">
          <MessageContent content={msg.content} messageId={msg.id} channelId={groupId} />
        </div>
        {counts.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {counts.map(([emoji, n]) => {
              const mine = myReactedEmojis.has(emoji);
              return (
                <button
                  key={emoji}
                  onClick={() => onReactionClick(emoji)}
                  disabled={mine}
                  title={mine ? 'Ya reaccionaste con este emoji' : undefined}
                  className={
                    'rounded-full border px-2 py-0.5 text-xs text-lc-white ' +
                    (mine
                      ? 'border-lc-green/60 bg-lc-green/10 cursor-default'
                      : 'border-lc-border bg-lc-card hover:border-lc-green')
                  }
                >
                  {emoji} {n}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="absolute right-3 top-0 hidden gap-0.5 rounded-md border border-lc-border bg-lc-dark p-0.5 shadow-md group-hover:flex">
        <button
          onClick={() => onReply(msg)}
          className="rounded px-1.5 py-0.5 text-xs text-lc-muted hover:bg-lc-card hover:text-lc-white"
          title="Reply"
        >
          ↩
        </button>
        <button
          onClick={() => {
            if (typeof window === 'undefined') return;
            const url = new URL(window.location.href);
            url.search = '';
            url.searchParams.set('c', groupId);
            url.searchParams.set('m', msg.id);
            navigator.clipboard.writeText(url.toString());
          }}
          className="rounded px-1.5 py-0.5 text-xs text-lc-muted hover:bg-lc-card hover:text-lc-white"
          title="Copy message link"
        >
          🔗
        </button>
        {QUICK_REACTIONS.map((e) => (
          <button
            key={e}
            onClick={() => onReactionClick(e)}
            className="rounded px-1.5 py-0.5 text-sm hover:bg-lc-card"
            title={`React ${e}`}
          >
            {e}
          </button>
        ))}
        {isAdmin && (
          <button
            onClick={() => {
              if (confirm('Delete this message?')) nostrActions.deleteGroupEvent(groupId, msg.id);
            }}
            className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-lc-card"
            title="Delete (admin)"
          >
            🗑
          </button>
        )}
      </div>
      {showPicker && (
        <div className="absolute right-3 top-8 flex gap-1 rounded border border-lc-border bg-lc-dark p-1 shadow-2xl">
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              onClick={() => {
                onReactionClick(e);
                setShowPicker(false);
              }}
              className="rounded p-1 hover:bg-lc-card"
            >
              {e}
            </button>
          ))}
        </div>
      )}
      {anchor && (
        <UserPanel
          pubkey={msg.pubkey}
          isMe={msg.pubkey === myPubkey}
          onClose={() => setAnchor(null)}
          onLogout={msg.pubkey === myPubkey ? () => { nostrActions.logout(); setAnchor(null); } : undefined}
          anchor={anchor}
        />
      )}
    </div>
  );
}

// -- Members panel ------------------------------------------------------

function MembersPanel({ groupId }: { groupId: string }) {
  return (
    <>
      <ChatStoreMembersAdapter groupId={groupId} />
      <MemberList profileCache={EMPTY_PROFILE_CACHE} />
      <ProfilePopupBridge />
    </>
  );
}

const EMPTY_PROFILE_CACHE = new Map<string, { name?: string; picture?: string }>();

function ChatStoreMembersAdapter({ groupId }: { groupId: string }) {
  const admins = useAdmins(groupId);
  const members = useMembers(groupId);
  const setMemberList = useChatStore((s) => s.setMemberList);
  const setOnlinePubkeys = useChatStore((s) => s.setOnlinePubkeys);

  const allPubkeys = useMemo(() => {
    const set = new Set<string>([...admins, ...members]);
    return Array.from(set);
  }, [admins, members]);

  const adminSet = useMemo(() => new Set(admins), [admins]);

  // Seed the list with prefix-only display names; per-pubkey rows below
  // refresh entries as metadata streams in.
  useEffect(() => {
    const list: MemberInfo[] = allPubkeys.map((pubkey) => ({
      pubkey,
      displayName: pubkey.slice(0, 10),
      role: adminSet.has(pubkey) ? 'admin' : 'member',
    }));
    setMemberList(list);
    setOnlinePubkeys(allPubkeys);
  }, [allPubkeys, adminSet, setMemberList, setOnlinePubkeys]);

  return (
    <>
      {allPubkeys.map((pk) => (
        <MemberMetaSync key={pk} pubkey={pk} />
      ))}
    </>
  );
}

function MemberMetaSync({ pubkey }: { pubkey: string }) {
  const meta = useUserMetadata(pubkey);
  useEffect(() => {
    if (!meta) return;
    useChatStore.setState((state) => {
      const idx = state.memberList.findIndex((m) => m.pubkey === pubkey);
      if (idx === -1) return state;
      const next = [...state.memberList];
      next[idx] = {
        ...next[idx],
        displayName: meta.displayName || meta.name || next[idx].displayName,
        picture: meta.picture ?? next[idx].picture,
        nip05: meta.nip05 ?? next[idx].nip05,
      };
      return { memberList: next } as Partial<typeof state> as typeof state;
    });
  }, [pubkey, meta]);
  return null;
}

function ProfilePopupBridge() {
  const popupPubkey = useChatStore((s) => s.profilePopupPubkey);
  const closePopup = useChatStore((s) => s.closeProfilePopup);
  const myPubkey = useMyPubkey();
  if (!popupPubkey) return null;
  return (
    <UserPanel
      pubkey={popupPubkey}
      isMe={popupPubkey === myPubkey}
      onClose={closePopup}
      onLogout={popupPubkey === myPubkey ? () => { nostrActions.logout(); closePopup(); } : undefined}
    />
  );
}

function MemberRow({ pubkey, isAdmin }: { pubkey: string; isAdmin: boolean }) {
  const meta = useUserMetadata(pubkey);
  const myPubkey = useMyPubkey();
  const [anchor, setAnchor] = useState<{ x: number; y: number; placement?: 'top' | 'bottom' } | null>(null);
  return (
    <>
      <button
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAnchor({ x: r.right - 340, y: r.top, placement: r.top > window.innerHeight / 2 ? 'top' : 'bottom' });
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-lc-card"
        title={pubkey}
      >
        <Avatar pubkey={pubkey} size={7} picture={meta?.picture ?? null} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 truncate text-sm text-lc-white">
            <span className="truncate">{meta?.displayName || meta?.name || pubkey.slice(0, 10)}</span>
            {isAdmin && <span title="Admin" className="text-xs">👑</span>}
          </div>
          {meta?.nip05 && <div className="truncate text-[10px] text-lc-muted">{meta.nip05}</div>}
        </div>
      </button>
      {anchor && (
        <UserPanel
          pubkey={pubkey}
          isMe={pubkey === myPubkey}
          onClose={() => setAnchor(null)}
          onLogout={pubkey === myPubkey ? () => { nostrActions.logout(); setAnchor(null); } : undefined}
          anchor={anchor}
        />
      )}
    </>
  );
}

// -- Channel settings (admin) -------------------------------------------

function ChannelSettingsModal({ group, onClose }: { group: JsGroup; onClose: () => void }) {
  const [name, setName] = useState(group.name ?? '');
  const [about, setAbout] = useState(group.about ?? '');
  const [picture, setPicture] = useState(group.picture ?? '');
  const [banner, setBanner] = useState(group.banner ?? '');
  const [isPublic, setIsPublic] = useState(group.isPublic);
  const [isOpen, setIsOpen] = useState(group.isOpen);
  const [channelKind, setChannelKind] = useState<'text' | 'voice'>(group.kind);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState<null | 'icon' | 'banner'>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadImage = async (file: File, kind: 'icon' | 'banner') => {
    setUploading(kind);
    setUploadError(null);
    try {
      const { uploadToBlossom } = await import('@/lib/blossom');
      const url = await uploadToBlossom(file);
      if (kind === 'icon') setPicture(url);
      else setBanner(url);
    } catch (err) {
      setUploadError((err as Error).message || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const [newMember, setNewMember] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberErr, setMemberErr] = useState<string | null>(null);
  const members = useMembers(group.id);
  const admins = useAdmins(group.id);
  const adminSet = useMemo(() => new Set(admins), [admins]);

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    setSavingMeta(true);
    setMetaErr(null);
    try {
      await nostrActions.editGroupMetadata({
        groupId: group.id,
        name,
        about,
        picture: picture || undefined,
        banner: banner || undefined,
        isPublic,
        isOpen,
        kind: channelKind,
      });
      onClose();
    } catch (err) {
      setMetaErr((err as Error).message);
    } finally {
      setSavingMeta(false);
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setMemberErr(null);
    let hex = newMember.trim();
    if (!hex) return;
    if (hex.startsWith('npub1')) {
      try {
        const { nip19 } = await import('nostr-tools');
        const decoded = nip19.decode(hex);
        if (decoded.type !== 'npub') throw new Error('Not an npub');
        hex = decoded.data as string;
      } catch (err) {
        setMemberErr((err as Error).message);
        return;
      }
    }
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      setMemberErr('Provide an npub or 64-char hex pubkey');
      return;
    }
    setMemberBusy(true);
    try {
      await nostrActions.putUser(group.id, hex, makeAdmin ? ['admin'] : []);
      setNewMember('');
      setMakeAdmin(false);
    } catch (err) {
      setMemberErr((err as Error).message);
    } finally {
      setMemberBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="lc-card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden bg-lc-dark"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-lc-border px-5 py-3">
          <div className="text-base font-bold text-lc-white">Channel settings · #{group.name ?? group.id.slice(0, 8)}</div>
          <button onClick={onClose} className="rounded p-1 text-lc-muted hover:bg-lc-card hover:text-lc-white" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          <form onSubmit={saveMeta} className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-lc-muted">Metadata (NIP-29 kind 9002)</div>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClasses} />
            </Field>
            <Field label="About">
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={2} className={inputClasses} />
            </Field>
            <div>
              <label className="block text-xs text-lc-muted mb-1.5 uppercase tracking-wider">Icon</label>
              <div className="flex items-center gap-3">
                {picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={picture}
                    alt="Icon preview"
                    className="w-12 h-12 rounded-lg object-cover bg-lc-black border border-lc-border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-lc-black border border-lc-border" />
                )}
                <input
                  name="picture"
                  value={picture}
                  onChange={(e) => setPicture(e.target.value)}
                  placeholder="https://… or upload"
                  className="flex-1 px-3 py-2 rounded-lg bg-lc-black border border-lc-border text-lc-white text-sm focus:border-lc-green focus:outline-none transition-colors"
                />
                <label className="lc-pill lc-pill-secondary text-xs cursor-pointer whitespace-nowrap">
                  {uploading === 'icon' ? 'Uploading…' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading === 'icon'}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadImage(f, 'icon');
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs text-lc-muted mb-1.5 uppercase tracking-wider">Banner</label>
              <div className="flex items-center gap-3">
                {banner ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={banner}
                    alt="Banner preview"
                    className="w-24 h-12 rounded-lg object-cover bg-lc-black border border-lc-border"
                  />
                ) : (
                  <div className="w-24 h-12 rounded-lg bg-lc-black border border-lc-border" />
                )}
                <input
                  name="banner"
                  value={banner}
                  onChange={(e) => setBanner(e.target.value)}
                  placeholder="https://… or upload (gif / png / jpg)"
                  className="flex-1 px-3 py-2 rounded-lg bg-lc-black border border-lc-border text-lc-white text-sm focus:border-lc-green focus:outline-none transition-colors"
                />
                <label className="lc-pill lc-pill-secondary text-xs cursor-pointer whitespace-nowrap">
                  {uploading === 'banner' ? 'Uploading…' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading === 'banner'}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadImage(f, 'banner');
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {uploadError && (
                <p className="mt-1.5 text-xs text-red-400">{uploadError}</p>
              )}
              <p className="mt-1.5 text-[11px] text-lc-muted">
                Stored as a <code className="text-lc-white/80">[&quot;banner&quot;, url]</code> tag on NIP-29 kind 9002. The relay just preserves and replays it on kind 39000 — no relay change needed. See <code className="text-lc-white/80">docs/server-banner.md</code>.
              </p>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-lc-white">
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                Public (readable without joining)
              </label>
              <label className="flex items-center gap-2 text-sm text-lc-white">
                <input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} />
                Open (anyone can join)
              </label>
            </div>
            <div>
              <label className="block text-xs text-lc-muted mb-1.5 uppercase tracking-wider">Channel type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setChannelKind('text')}
                  className={
                    'lc-pill text-xs ' +
                    (channelKind === 'text' ? 'lc-pill-primary' : 'lc-pill-secondary')
                  }
                >
                  Text
                </button>
                <button
                  type="button"
                  onClick={() => setChannelKind('voice')}
                  className={
                    'lc-pill text-xs ' +
                    (channelKind === 'voice' ? 'lc-pill-primary' : 'lc-pill-secondary')
                  }
                >
                  Voice / Video
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-lc-muted">
                A voice channel adds a <code className="text-lc-white/80">[&quot;t&quot;,&quot;voice&quot;]</code> tag to the kind 9002 metadata. Members open <code className="text-lc-white/80">/voice/{group.id.slice(0, 8)}…</code> to join the call. Up to 4 participants, P2P over WebRTC. See <code className="text-lc-white/80">docs/webrtc-p2p-nostr-signaling.md</code>.
              </p>
            </div>
            {metaErr && <div className="text-sm text-red-400">{metaErr}</div>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingMeta}
                className="rounded bg-lc-green px-4 py-1.5 text-sm font-semibold text-lc-black disabled:opacity-50"
              >
                {savingMeta ? 'Saving…' : 'Save metadata'}
              </button>
            </div>
          </form>

          <hr className="my-6 border-lc-border" />

          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-lc-muted">Add member (NIP-29 kind 9000)</div>
            <form onSubmit={addMember} className="flex gap-2">
              <input
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
                placeholder="npub1… or hex pubkey"
                spellCheck={false}
                className={inputClasses}
              />
              <label className="flex items-center gap-1 whitespace-nowrap text-xs text-lc-muted">
                <input type="checkbox" checked={makeAdmin} onChange={(e) => setMakeAdmin(e.target.checked)} />
                admin
              </label>
              <button
                type="submit"
                disabled={memberBusy || !newMember.trim()}
                className="shrink-0 rounded bg-lc-green px-3 py-1.5 text-sm font-semibold text-lc-black disabled:opacity-50"
              >
                {memberBusy ? '…' : 'Add'}
              </button>
            </form>
            {memberErr && <div className="text-sm text-red-400">{memberErr}</div>}

            <div className="mt-4 text-xs font-bold uppercase tracking-wider text-lc-muted">
              Current members · {members.length}
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {members.map((pk) => (
                <ManageMemberRow key={pk} groupId={group.id} pubkey={pk} isAdmin={adminSet.has(pk)} />
              ))}
              {members.length === 0 && (
                <div className="text-xs text-lc-muted">
                  No members yet — relay hasn&apos;t published kind 39002 for this group, or only the creator is in it.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManageMemberRow({ groupId, pubkey, isAdmin }: { groupId: string; pubkey: string; isAdmin: boolean }) {
  const meta = useUserMetadata(pubkey);
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-lc-card">
      <Avatar pubkey={pubkey} size={7} picture={meta?.picture ?? null} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-lc-white">
          {meta?.displayName || meta?.name || pubkey.slice(0, 10)}
          {isAdmin && <span className="ml-1 text-xs">👑</span>}
        </div>
        <div className="truncate font-mono text-[10px] text-lc-muted">{pubkey.slice(0, 32)}…</div>
      </div>
      <button
        onClick={() => {
          if (confirm(`Remove ${meta?.name || pubkey.slice(0, 12)} from channel?`)) {
            nostrActions.removeUser(groupId, pubkey);
          }
        }}
        className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-lc-dark"
      >
        Remove
      </button>
    </div>
  );
}

const inputClasses =
  'w-full rounded border border-lc-border bg-lc-black px-2 py-1.5 text-sm text-lc-white outline-none focus:border-lc-green';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium text-lc-muted">{label}</div>
      {children}
    </label>
  );
}

// -- DMs ----------------------------------------------------------------

function DMPanel({ peer }: { peer: string | null; onPickPeer: (p: string) => void }) {
  const dms = useDirectMessages();
  const meta = useUserMetadata(peer);
  const thread = peer ? dms[peer] ?? [] : [];
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, peer]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!peer) return;
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      await nostrActions.sendDirectMessage(peer, content);
      setDraft('');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!peer) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-lc-muted">
        Pick or start a DM conversation.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-lc-border bg-lc-dark px-5 py-3">
        <Avatar pubkey={peer} size={9} picture={meta?.picture ?? null} />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-lc-white">
            {meta?.displayName || meta?.name || peer.slice(0, 16) + '…'}
          </div>
          <div className="truncate font-mono text-[10px] text-lc-muted">{peer}</div>
        </div>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {thread.length === 0 ? (
          <div className="text-sm text-lc-muted">No messages yet. Send the first one (NIP-04 encrypted).</div>
        ) : (
          thread.map((m) => (
            <div
              key={m.id}
              className={
                'mb-2 max-w-md rounded-2xl px-4 py-2 text-sm shadow-sm ' +
                (m.outgoing
                  ? 'ml-auto bg-lc-green text-lc-black'
                  : 'bg-lc-card text-lc-white')
              }
            >
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
              <div className={'mt-1 text-[10px] ' + (m.outgoing ? 'text-black/60' : 'text-lc-muted')}>
                {new Date(m.createdAt * 1000).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={onSend} className="shrink-0 px-5 pb-5">
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        <div className="flex items-center gap-2 rounded-lg border border-lc-border bg-lc-card px-4 py-2 focus-within:border-lc-green">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Encrypted message (NIP-04)"
            disabled={sending}
            className="flex-1 bg-transparent text-sm text-lc-white outline-none placeholder:text-lc-muted disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="text-xs font-semibold text-lc-green disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

// -- Helpers ------------------------------------------------------------

function Avatar({ pubkey, size, picture }: { pubkey: string; size: number; picture: string | null }) {
  const px = `${size * 4}px`;
  if (picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={picture}
        alt=""
        style={{ width: px, height: px }}
        className="rounded-full bg-lc-card object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  const hue = parseInt(pubkey.slice(0, 6), 16) % 360;
  return (
    <div
      style={{ width: px, height: px, background: `hsl(${hue} 60% 30%)` }}
      className="flex items-center justify-center rounded-full font-mono text-[10px] font-bold text-lc-white"
    >
      {pubkey.slice(0, 2).toUpperCase()}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-lc-muted">
      <div className="text-center">
        <div className="text-lg font-medium text-lc-white">Pick a channel or DM</div>
        <div className="mt-1 text-sm">Choose from the sidebar — or hit + to create a new channel.</div>
      </div>
    </div>
  );
}

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// silence unused-import warning when JsUserMetadata is referenced indirectly
export type { JsUserMetadata };
