import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import Sheet from "./sheets/Sheet";
import { invalidatePlaylists } from "../lib/appCache";

// Playlist manager — a small member-only island. Every mutation autosaves
// (debounced) through the member-scoped playlist API, mirroring the song
// editor's quiet save behavior.

export interface SongSummary {
  _id: string;
  title: string;
  songKey: string;
  bpm: number;
  parts: string;
  measures: number;
}

interface Props {
  playlistId: string;
  initial: { title: string; songIds: string[]; shareId?: string };
  songs: SongSummary[]; // the member's whole songbook, newest first
}

export default function PlaylistEditor({ playlistId, initial, songs }: Props) {
  const [, navigate] = useLocation();
  const [title, setTitle] = useState(initial.title);
  const [ids, setIds] = useState<string[]>(initial.songIds);
  const [shareId, setShareId] = useState<string | undefined>(initial.shareId);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const byId = new Map(songs.map((s) => [s._id, s]));
  // Songs deleted from the songbook drop off the visible list; their ids are
  // pruned on the next save (the API filters to owned songs anyway).
  const rows = ids.map((id) => byId.get(id)).filter(Boolean) as SongSummary[];
  const available = songs.filter((s) => !ids.includes(s._id));

  const save = async (over?: { title?: string; songIds?: string[]; shareId?: string | undefined }) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/playlists/${playlistId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: over?.title ?? title,
          songIds: { list: over?.songIds ?? ids },
          shareId: over && "shareId" in over ? over.shareId : shareId,
        }),
      });
      if (!res.ok) throw new Error();
      invalidatePlaylists();
      setDirty(false);
      return true;
    } catch {
      setSaveError("Couldn't save — check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Debounced autosave, same rhythm as the song editor.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || saving) return;
    const t = setTimeout(() => saveRef.current(), 800);
    return () => clearTimeout(t);
  }, [dirty, saving, title, ids]);

  const edit = (fn: () => void) => {
    fn();
    setDirty(true);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    // Reorder over the visible rows, then map back onto the id list.
    const visible = rows.map((r) => r._id);
    [visible[i], visible[j]] = [visible[j], visible[i]];
    edit(() => setIds(visible));
  };

  const shareUrl = shareId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/p/${shareId}`
    : null;

  const setSharing = async (on: boolean) => {
    if (shareBusy) return;
    setShareBusy(true);
    setCopied(false);
    const next = on
      ? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "")
      : undefined;
    const prev = shareId;
    setShareId(next);
    const ok = await save({ shareId: next });
    if (!ok) setShareId(prev);
    setShareBusy(false);
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — the URL is selectable
    }
  };

  const deletePlaylist = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    try {
      await fetch(`/api/playlists/${playlistId}`, { method: "DELETE" });
      invalidatePlaylists();
      navigate("/playlists");
    } catch {
      setSaveError("Couldn't delete the playlist right now.");
    }
  };

  return (
    <div className="editor pl-editor">
      <header className="ed-head">
        <Link className="back" href="/playlists" aria-label="Back to playlists">‹</Link>
        <input
          className="title-input"
          value={title}
          onChange={(e) => edit(() => setTitle(e.target.value))}
          aria-label="Playlist title"
        />
        <button
          className="share-btn"
          onClick={() => setShareOpen(true)}
          aria-label="Share playlist"
          title="Share playlist"
        >
          <svg width="17" height="17" viewBox="0 0 17 17">
            <path d="M8.5 1.5v9M5 4.5l3.5-3 3.5 3M3.5 8v6h10V8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="save-btn save-quiet" disabled aria-label={saving || dirty ? "Saving" : "Saved"}>
          <span className={`sync-dot ${saving || dirty ? "sync-busy" : ""}`} />
          Saved
        </button>
      </header>
      {saveError && <p className="save-error">{saveError}</p>}

      {rows.length === 0 && (
        <p className="empty-state">
          No songs here yet.<br />
          Add songs from your songbook below.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="song-list pl-list">
          {rows.map((s, i) => (
            <li key={s._id}>
              <div className="song-card pl-row">
                <Link className="pl-song" href={`/songs/${s._id}`}>
                  <span className="s-title">{s.title}</span>
                  <br />
                  <span className="s-sub">
                    {s.parts} · {s.measures} measures · {s.bpm} BPM · {s.songKey}
                  </span>
                </Link>
                <span className="pl-actions">
                  <button className="pl-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button className="pl-btn" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
                  <button
                    className="pl-btn pl-remove"
                    onClick={() => edit(() => setIds(ids.filter((id) => id !== s._id)))}
                    aria-label={`Remove ${s.title}`}
                  >✕</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="new-song-row">
        <button className="new-song pl-add" onClick={() => setAddOpen(true)}>＋ Add songs</button>
      </div>

      <div className="pl-danger">
        <button className="pl-delete" onClick={deletePlaylist}>
          {confirmDelete ? "Tap again to delete this playlist" : "Delete playlist"}
        </button>
        <p className="fine">Deleting the playlist never deletes the songs in it.</p>
      </div>

      {addOpen && (
        <Sheet title="Add songs" sub={title} label="Add songs to playlist" onClose={() => setAddOpen(false)}>
          {available.length === 0 && (
            <p className="empty-state">Every song in your songbook is already in this playlist.</p>
          )}
          <ul className="song-list pl-list">
            {available.map((s) => (
              <li key={s._id}>
                <button
                  className="song-card pl-pick"
                  onClick={() => edit(() => setIds([...ids, s._id]))}
                >
                  <span>
                    <span className="s-title">{s.title}</span>
                    <br />
                    <span className="s-sub">
                      {s.parts} · {s.measures} measures · {s.bpm} BPM
                    </span>
                  </span>
                  <span className="s-key">＋</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="sheet-actions">
            <span />
            <button className="sheet-done" onClick={() => setAddOpen(false)}>Done</button>
          </div>
        </Sheet>
      )}

      {shareOpen && (
        <Sheet title="Share" sub={title || "Untitled playlist"} label="Share playlist" onClose={() => { setShareOpen(false); setCopied(false); }}>
          {!shareId && (
            <>
              <p className="share-note">
                Create a public link — anyone with it can open every song in
                this playlist and play with copies, without an account. Your
                originals stay yours.
              </p>
              <div className="sheet-actions">
                <span />
                <button className="sheet-done" disabled={shareBusy} onClick={() => setSharing(true)}>
                  {shareBusy ? "Creating…" : "Create link"}
                </button>
              </div>
            </>
          )}
          {shareId && shareUrl && (
            <>
              <p className="share-note">Anyone with this link can view and play the whole playlist:</p>
              <div className="share-url-row">
                <span className="share-url">{shareUrl}</span>
                <button className="part-btn" onClick={copyShareUrl}>{copied ? "Copied ✓" : "Copy"}</button>
              </div>
              <div className="sheet-actions">
                <button className="remove-chord" disabled={shareBusy} onClick={() => setSharing(false)}>
                  {shareBusy ? "…" : "Stop sharing"}
                </button>
                <button className="sheet-done" onClick={() => { setShareOpen(false); setCopied(false); }}>Done</button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
