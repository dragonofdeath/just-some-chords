import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { cache, fetchMember, fetchPlaylists, invalidatePlaylists, loginUrl } from "../lib/appCache";
import { IconAdd, IconBack } from "./icons";

// Playlists overview — SPA port of the old playlists/index.astro.

export default function PlaylistList() {
  const [, navigate] = useLocation();
  const [playlists, setPlaylists] = useState<any[] | null>(cache.playlists);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    fetchMember().then((m) => {
      if (!dead && !m) window.location.href = loginUrl();
    });
    fetchPlaylists(cache.playlists !== null)
      .then((p) => !dead && setPlaylists([...p]))
      .catch((e) => {
        if (dead) return;
        if (e.status === 401) window.location.href = loginUrl();
        else setLoadError(true);
      });
    return () => {
      dead = true;
    };
  }, []);

  const createPlaylist = async () => {
    setCreating(true);
    setCreateFailed(false);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New playlist", songIds: { list: [] } }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      invalidatePlaylists();
      navigate(`/playlists/${created._id}`);
    } catch {
      setCreating(false);
      setCreateFailed(true);
    }
  };

  const songCount = (p: any): string => {
    const n = Array.isArray(p.songIds?.list) ? p.songIds.list.length : 0;
    return n === 1 ? "1 song" : `${n} songs`;
  };

  return (
    <main className="shell">
      <div className="list-head">
        <h1>My playlists</h1>
      </div>
      <div className="whoami">
        <span>
          <Link className="fine-link" href="/songs"><IconBack size={11} /> My songs</Link>
        </span>
        <span className="whoami-links">
          <a className="fine-link" href="/help">Help</a>
        </span>
      </div>

      {loadError && (
        <p className="load-error">
          Couldn't load your playlists right now — pull to refresh or try again in a moment.
        </p>
      )}

      {playlists === null && !loadError && <p className="empty-state">Loading…</p>}

      {playlists !== null && !loadError && playlists.length === 0 && (
        <p className="empty-state">
          No playlists yet.
          <br />
          Group songs into a set and share the whole thing with one link.
        </p>
      )}

      {playlists !== null && playlists.length > 0 && (
        <ul className="song-list">
          {playlists.map((p) => (
            <li key={p._id}>
              <Link className="song-card" href={`/playlists/${p._id}`}>
                <span>
                  <span className="s-title">{p.title || "Untitled playlist"}</span>
                  <br />
                  <span className="s-sub">
                    {songCount(p)}
                    {p.shareId ? " · shared" : ""}
                  </span>
                </span>
                <span className="s-key">♫</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="new-song-row">
        <button className="new-song pl-add" type="button" disabled={creating} onClick={createPlaylist}>
          {creating ? "Creating…" : <><IconAdd size={13} /> {createFailed ? "New playlist — try again" : "New playlist"}</>}
        </button>
      </div>
    </main>
  );
}
