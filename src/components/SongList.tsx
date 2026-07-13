import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { cache, fetchMember, fetchSongs, loginUrl } from "../lib/appCache";
import { countMeasures, countSections, migrateSong } from "../lib/songModel";
import { MODES } from "../lib/theory";
import { IconAdd } from "./icons";

// The songbook list — SPA port of the old songs/index.astro. Renders from the
// in-memory cache instantly when coming back from the editor, revalidates in
// the background.

export default function SongList() {
  const [songs, setSongs] = useState<any[] | null>(cache.songs);
  const [who, setWho] = useState<string>("");
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    let dead = false;
    fetchMember().then((m) => {
      if (dead) return;
      if (!m) {
        window.location.href = loginUrl();
        return;
      }
      setWho(m.nickname || m.email || "there");
    });
    fetchSongs(cache.songs !== null) // instant when cached, still revalidates
      .then((s) => !dead && setSongs([...s]))
      .catch((e) => {
        if (dead) return;
        if (e.status === 401) window.location.href = loginUrl();
        else setLoadError(true);
      });
    return () => {
      dead = true;
    };
  }, []);

  const cards = useMemo(
    () =>
      (songs ?? []).map((s) => {
        const doc = migrateSong(s.sections);
        const n = countSections(doc);
        return {
          id: s._id,
          title: s.title || "Untitled",
          sub: `${n === 1 ? "1 part" : `${n} parts`} · ${countMeasures(doc)} measures · ${s.bpm} BPM`,
          keyLabel: `${s.songKey} ${MODES[doc.mode ?? "major"].name}`,
          tags: doc.tags ?? [],
        };
      }),
    [songs]
  );

  const allTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of cards) for (const t of c.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [cards]);

  const shown = cards.filter((c) => {
    const tags = c.tags.map((t) => t.toLowerCase());
    const needle = q.trim().toLowerCase();
    const textHit = !needle || c.title.toLowerCase().includes(needle) || tags.some((t) => t.includes(needle));
    const tagHit = [...activeTags].every((t) => tags.includes(t));
    return textHit && tagHit;
  });

  return (
    <main className="shell">
      <div className="list-head">
        <h1>My songs</h1>
      </div>
      <div className="whoami">
        <span>{who ? `Signed in as ${who}` : " "}</span>
        <span className="whoami-links">
          <Link className="fine-link" href="/playlists">Playlists</Link>
          <a className="fine-link" href="/help">Help</a>
          <form method="POST" action="/api/auth/logout?returnUrl=/">
            <button className="logout-btn" type="submit">Log out</button>
          </form>
        </span>
      </div>

      {loadError && (
        <p className="load-error">
          Couldn't load your songs right now — pull to refresh or try again in a moment.
        </p>
      )}

      {songs === null && !loadError && <p className="empty-state">Loading your songbook…</p>}

      {songs !== null && !loadError && cards.length === 0 && (
        <p className="empty-state">
          Nothing in the songbook yet.
          <br />
          Start your first song and it'll be saved here.
        </p>
      )}

      {cards.length > 0 && (
        <>
          <div className="list-tools">
            <input
              className="song-search"
              type="search"
              placeholder="Search songs…"
              aria-label="Search songs by title or tag"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {allTags.length > 0 && (
              <div className="tag-row">
                {allTags.map(([key, label]) => (
                  <button
                    key={key}
                    className={`tag-chip ${activeTags.has(key) ? "tag-on" : ""}`}
                    type="button"
                    onClick={() =>
                      setActiveTags((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ul className="song-list">
            {shown.map((c) => (
              <li key={c.id}>
                <Link className="song-card" href={`/songs/${c.id}`}>
                  <span>
                    <span className="s-title">{c.title}</span>
                    <br />
                    <span className="s-sub">{c.sub}</span>
                    {c.tags.length > 0 && (
                      <span className="s-tags">
                        {c.tags.map((t) => (
                          <span key={t} className="s-tag">{t}</span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="s-key">{c.keyLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
          {shown.length === 0 && (
            <p className="empty-state">No songs match — clear the search or tags above.</p>
          )}
        </>
      )}

      <div className="new-song-row">
        <Link className="new-song" href="/songs/new"><IconAdd size={13} /> New song</Link>
      </div>
    </main>
  );
}
