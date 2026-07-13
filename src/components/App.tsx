import { useEffect, useRef, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import SongList from "./SongList";
import PlaylistList from "./PlaylistList";
import SongEditor from "./SongEditor";
import PlaylistEditor from "./PlaylistEditor";
import { countMeasures, countSections, migrateSong } from "../lib/songModel";
import { fetchSongs, loginUrl, playlistFromCache, songFromCache } from "../lib/appCache";

// The member-facing SPA: list ↔ editor ↔ playlists navigate client-side —
// no full page loads (the host's SSR baseline made every navigation ~1.4s).
// Astro serves this island from catch-all shells; public share pages stay SSR.

let newSongNonce = 0;

// Where the editor's ‹ returns to — songs opened from a playlist carry
// ?from=/playlists/<id> so back lands on that playlist, not the song list.
function backTarget(): string {
  const from = new URLSearchParams(window.location.search).get("from");
  return from && /^\/(songs|playlists)(\/|$)/.test(from) ? from : "/songs";
}

function SongRoute({ id }: { id: string }) {
  const [, navigate] = useLocation();
  // key remounts the editor on REAL navigation only. Saving a new song
  // rewrites the URL /songs/new → /songs/<id> via replaceState (which wouter
  // observes) — the `owned` ref recognizes that rename and keeps the editor
  // instance alive instead of remounting mid-session.
  const [inst, setInst] = useState<{ key: string; songId: string; song: any | null } | "loading">(
    id === "new" ? { key: "new-0", songId: "new", song: null } : "loading"
  );
  const owned = useRef<string | null>(id === "new" ? "new" : null);

  useEffect(() => {
    if (owned.current === id) return;
    if (owned.current === "new" && id !== "new") {
      owned.current = id; // post-save URL rename — same editor instance
      return;
    }
    owned.current = id;
    if (id === "new") {
      setInst({ key: `new-${++newSongNonce}`, songId: "new", song: null });
      return;
    }
    let dead = false;
    setInst("loading");
    (async () => {
      try {
        const raw =
          songFromCache(id) ??
          (await fetch(`/api/songs/${id}`).then((r) => {
            if (r.status === 401) throw Object.assign(new Error(), { status: 401 });
            if (!r.ok) throw new Error();
            return r.json();
          }));
        if (!dead) setInst({ key: id, songId: id, song: raw });
      } catch (e: any) {
        if (dead) return;
        if (e.status === 401) window.location.href = loginUrl();
        else navigate("/songs");
      }
    })();
    return () => {
      dead = true;
    };
  }, [id]);

  if (inst === "loading") {
    return (
      <main className="editor">
        <p className="empty-state">Opening song…</p>
      </main>
    );
  }
  const initialSong = inst.song
    ? {
        _id: inst.song._id,
        shareId: inst.song.shareId ?? undefined,
        title: inst.song.title ?? "Untitled",
        songKey: inst.song.songKey ?? "G",
        bpm: inst.song.bpm ?? 84,
        timeSignature: inst.song.timeSignature ?? "4/4",
        sections: inst.song.sections ?? null,
      }
    : null;
  return (
    <SongEditor key={inst.key} songId={inst.songId} initialSong={initialSong} onBack={() => navigate(backTarget())} />
  );
}

function PlaylistRoute({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [data, setData] = useState<{ playlist: any; songs: any[] } | "loading">("loading");

  useEffect(() => {
    let dead = false;
    setData("loading");
    (async () => {
      try {
        const [playlist, songs] = await Promise.all([
          playlistFromCache(id) ??
            fetch(`/api/playlists/${id}`).then((r) => {
              if (r.status === 401) throw Object.assign(new Error(), { status: 401 });
              if (!r.ok) throw new Error();
              return r.json();
            }),
          fetchSongs(),
        ]);
        if (!dead) setData({ playlist, songs });
      } catch (e: any) {
        if (dead) return;
        if (e.status === 401) window.location.href = loginUrl();
        else navigate("/playlists");
      }
    })();
    return () => {
      dead = true;
    };
  }, [id]);

  if (data === "loading") {
    return (
      <main className="editor pl-editor">
        <p className="empty-state">Opening playlist…</p>
      </main>
    );
  }
  const summaries = data.songs.map((s: any) => {
    const doc = migrateSong(s.sections);
    const n = countSections(doc);
    return {
      _id: s._id,
      title: s.title || "Untitled",
      songKey: s.songKey ?? "G",
      bpm: s.bpm ?? 84,
      parts: n === 1 ? "1 part" : `${n} parts`,
      measures: countMeasures(doc),
    };
  });
  const initial = {
    title: data.playlist.title ?? "Untitled playlist",
    songIds: Array.isArray(data.playlist.songIds?.list) ? data.playlist.songIds.list : [],
    shareId: data.playlist.shareId ?? undefined,
  };
  return <PlaylistEditor key={id} playlistId={id} initial={initial} songs={summaries} />;
}

const TITLES: [RegExp, string][] = [
  [/^\/songs\/?$/, "My songs — Just Some Chords"],
  [/^\/playlists\/?$/, "My playlists — Just Some Chords"],
  [/^\/playlists\//, "Playlist — Just Some Chords"],
];

export default function App() {
  const [location] = useLocation();
  useEffect(() => {
    const hit = TITLES.find(([re]) => re.test(location));
    if (hit) document.title = hit[1];
  }, [location]);

  return (
    <Switch>
      <Route path="/songs">
        <SongList />
      </Route>
      <Route path="/songs/:id">{(p) => <SongRoute id={p.id!} />}</Route>
      <Route path="/playlists">
        <PlaylistList />
      </Route>
      <Route path="/playlists/:id">{(p) => <PlaylistRoute id={p.id!} />}</Route>
      <Route>
        <SongList />
      </Route>
    </Switch>
  );
}
