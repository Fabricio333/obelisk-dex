import type { StateCreator } from 'zustand';
import type { ChatState } from './index';
import type { FollowedPostMetaEntry } from './types';

const STORAGE_KEY = 'obelisk:followed-posts';
const META_STORAGE_KEY = 'obelisk:followed-posts-meta';

export interface ForumFollowSlice {
  /**
   * Followed forum post ids. Persisted in localStorage only.
   *
   * The previous server-backed flow (`POST /api/forum/posts/:id/follow`,
   * `GET /api/forum/posts/followed`) is gone — Obelisk is fully Nostr now.
   * TODO(decentralized-forum-follows): replace localStorage with a Nostr
   * event (e.g. NIP-51 list) so follows sync across the user's devices.
   */
  followedPostIds: string[];
  followedPostMeta: Record<string, FollowedPostMetaEntry>;
  followedPostsLoading: boolean;
  /**
   * Session-only: post ids the user explicitly unfollowed this session.
   * Prevents auto-follow-on-send from immediately re-subscribing them.
   */
  suppressedAutoFollowPostIds: string[];

  loadFollowedPosts: () => Promise<void>;
  toggleFollowPost: (postId: string, meta?: { title: string; channelId: string; channelName: string; serverId: string }) => Promise<void>;
}

export const FORUM_FOLLOW_INITIAL_STATE = {
  followedPostIds: [] as string[],
  followedPostMeta: {} as Record<string, FollowedPostMetaEntry>,
  followedPostsLoading: false,
  suppressedAutoFollowPostIds: [] as string[],
};

function readStorageList(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function readStorageMeta(): Record<string, FollowedPostMetaEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, FollowedPostMetaEntry>) : {};
  } catch {
    return {};
  }
}

function writeStorage(ids: string[], meta: Record<string, FollowedPostMetaEntry>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch { /* quota etc. — ignore */ }
}

export const createForumFollowSlice: StateCreator<ChatState, [], [], ForumFollowSlice> = (set, get) => ({
  ...FORUM_FOLLOW_INITIAL_STATE,

  loadFollowedPosts: async () => {
    if (typeof window === 'undefined') return;
    set({ followedPostsLoading: true });
    const ids = readStorageList();
    const meta = readStorageMeta();
    set({ followedPostIds: ids, followedPostMeta: meta, followedPostsLoading: false });
  },

  toggleFollowPost: async (postId, meta) => {
    if (typeof window === 'undefined') return;
    const state = get();
    const currentIds = Array.isArray(state.followedPostIds) ? state.followedPostIds : [];
    const currentMeta = state.followedPostMeta && typeof state.followedPostMeta === 'object' ? state.followedPostMeta : {};
    const currentSuppressed = Array.isArray(state.suppressedAutoFollowPostIds)
      ? state.suppressedAutoFollowPostIds
      : [];
    const wasFollowing = currentIds.includes(postId);

    const nextIds = wasFollowing
      ? currentIds.filter((x) => x !== postId)
      : [...currentIds, postId];
    const nextMeta = { ...currentMeta };
    if (wasFollowing) {
      delete nextMeta[postId];
    } else if (meta) {
      nextMeta[postId] = { id: postId, ...meta };
    }
    // When the user explicitly unfollows, remember so we don't re-follow
    // automatically on their next send. When they explicitly follow,
    // clear the suppression.
    const nextSuppressed = wasFollowing
      ? Array.from(new Set([...currentSuppressed, postId]))
      : currentSuppressed.filter((x) => x !== postId);

    set({
      followedPostIds: nextIds,
      followedPostMeta: nextMeta,
      suppressedAutoFollowPostIds: nextSuppressed,
    });
    writeStorage(nextIds, nextMeta);
  },
});
