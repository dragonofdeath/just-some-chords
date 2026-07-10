// In-memory, session-lifetime cache for the SPA: list pages render instantly
// from here on back-navigation, then revalidate in the background.
// Module-level state survives route changes (the island never unmounts).

export interface MemberInfo {
  nickname?: string;
  email?: string;
}

interface CacheState {
  member: MemberInfo | null | undefined; // undefined = not fetched yet
  songs: any[] | null;
  playlists: any[] | null;
}

export const cache: CacheState = {
  member: undefined,
  songs: null,
  playlists: null,
};

export function loginUrl(): string {
  return `/api/auth/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`;
}

/** Fetch the member once per session; null = anonymous. */
export async function fetchMember(): Promise<MemberInfo | null> {
  if (cache.member !== undefined) return cache.member;
  try {
    const res = await fetch("/api/me");
    const j = res.ok ? await res.json() : { member: null };
    cache.member = j.member ?? null;
  } catch {
    cache.member = null;
  }
  return cache.member;
}

/** Songs list, newest first. Force skips the cache (revalidation). */
export async function fetchSongs(force = false): Promise<any[]> {
  if (cache.songs && !force) return cache.songs;
  const res = await fetch("/api/songs");
  if (res.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
  if (!res.ok) throw new Error("load failed");
  const j = await res.json();
  cache.songs = j.songs ?? [];
  return cache.songs!;
}

export async function fetchPlaylists(force = false): Promise<any[]> {
  if (cache.playlists && !force) return cache.playlists;
  const res = await fetch("/api/playlists");
  if (res.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
  if (!res.ok) throw new Error("load failed");
  const j = await res.json();
  cache.playlists = j.playlists ?? [];
  return cache.playlists!;
}

export function songFromCache(id: string): any | null {
  return cache.songs?.find((s) => s._id === id) ?? null;
}

export function playlistFromCache(id: string): any | null {
  return cache.playlists?.find((p) => p._id === id) ?? null;
}

/** Call after any mutation so the next list render refetches. */
export function invalidateSongs(): void {
  cache.songs = null;
}

export function invalidatePlaylists(): void {
  cache.playlists = null;
}
