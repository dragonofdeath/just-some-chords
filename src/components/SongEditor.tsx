import { useEffect, useRef, useState } from "react";
import { INSTRUMENTS, ensureLoaded, instrumentLabel, preload, type Instrument } from "../lib/sampler";
import { clickAt, ensureCtx, killBus, playChordAt } from "../lib/audio";
import {
  EXTENSIONS,
  FIFTHS,
  SECTION_NAMES,
  chordLabel,
  chordRoman,
  chordSemis,
  emptySong,
  extLabel,
  isInKey,
  keyIdxFromName,
  sectionRepeat,
  type Chord,
  type SongData,
} from "../lib/theory";

interface SavedSong extends SongData {
  _id?: string;
  shareId?: string;
}

interface Props {
  songId: string; // "new" or an existing item id
  initialSong: SavedSong | null;
  // "shared": opened from a public share link — an unsaved copy of someone's
  // song; saving forks it into the visitor's own songbook.
  source?: "member" | "shared";
}

// ---------- wheel geometry ----------
function polar(cx: number, cy: number, r: number, aDeg: number): [number, number] {
  const a = ((aDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function wedgePath(cx: number, cy: number, r1: number, r2: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r2, a0);
  const [x1, y1] = polar(cx, cy, r2, a1);
  const [x2, y2] = polar(cx, cy, r1, a1);
  const [x3, y3] = polar(cx, cy, r1, a0);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r2} ${r2} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} A${r1} ${r1} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

interface PlayPos {
  si: number;
  ci: number;
}

const DRAFT_KEY = "jsc-draft";

function readDraft(): { song: SavedSong; pendingSave?: boolean } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d?.song?.sections?.list ? d : null;
  } catch {
    return null;
  }
}

export default function SongEditor({ songId, initialSong, source = "member" }: Props) {
  const [song, setSong] = useState<SavedSong>(() => {
    // A new song prefers a stashed draft — work saved right before a login
    // redirect. A shared song always shows the shared content, never a draft.
    if (songId === "new" && source !== "shared") {
      const d = readDraft();
      if (d) return d.song;
    }
    return initialSong ?? emptySong();
  });
  const [itemId, setItemId] = useState<string | null>(songId === "new" ? null : songId);
  const [activeSection, setActiveSection] = useState(0);
  const [dirty, setDirty] = useState(songId === "new");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState<PlayPos | null>(null);
  const [metronome, setMetronome] = useState(false);
  const [instrument, setInstrument] = useState<Instrument>(() => {
    try {
      const v = localStorage.getItem("jsc-instrument");
      return v === "piano" || v === "guitar" || v === "synth" ? v : "piano";
    } catch {
      return "piano";
    }
  });
  const [editTarget, setEditTarget] = useState<PlayPos | null>(null);
  const [sectionTarget, setSectionTarget] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Selection: a single chord (a === b) or a range within one section.
  const [sel, setSel] = useState<{ si: number; a: number; b: number } | null>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playBus = useRef<GainNode | null>(null); // master bus for the current play run
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);

  const keyIdx = keyIdxFromName(song.songKey);
  const sections = song.sections.list;

  const edit = (fn: (s: SavedSong) => SavedSong) => {
    setSong((s) => fn(s));
    setDirty(true);
  };

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => () => stop(), []);

  // If a draft was stashed mid-save (anonymous user sent to login), finish the
  // save now that we're back. The flag is cleared FIRST so a still-anonymous
  // visitor (login canceled) isn't bounced in a redirect loop — the draft
  // content itself stays until a save succeeds.
  useEffect(() => {
    if (songId !== "new" || source === "shared") return;
    const d = readDraft();
    if (!d?.pendingSave) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ song: d.song }));
    } catch {
      // storage unavailable — nothing to clear
    }
    save(d.song);
  }, []);

  // Start downloading sample bytes right away; decode happens on first sound.
  useEffect(() => {
    preload(instrument);
    try {
      localStorage.setItem("jsc-instrument", instrument);
    } catch {
      // private mode etc. — preference just won't persist
    }
  }, [instrument]);

  const cycleInstrument = () => {
    const next = INSTRUMENTS[(INSTRUMENTS.indexOf(instrument) + 1) % INSTRUMENTS.length];
    setInstrument(next);
    ensureLoaded(ensureCtx(), next); // user gesture — decode now so the next tap is sampled
  };

  const updateChords = (si: number, fn: (chords: Chord[]) => Chord[]) => {
    edit((s) => {
      const list = s.sections.list.map((sec, i) => (i === si ? { ...sec, chords: fn(sec.chords) } : sec));
      return { ...s, sections: { list } };
    });
  };

  const tapChord = (idx: number, quality: "maj" | "min") => {
    const chord: Chord = { idx, quality };
    playChordAt(chordSemis(chord), 0, 1.2, instrument);
    if ((sections[activeSection]?.chords.length ?? 0) >= 16) return;
    updateChords(activeSection, (chords) => [...chords, chord]);
  };

  const setChordExt = (pos: PlayPos, ext: string) => {
    const chord: Chord = { ...sections[pos.si].chords[pos.ci], ext: ext || undefined };
    playChordAt(chordSemis(chord), 0, 1.2, instrument);
    updateChords(pos.si, (chords) => chords.map((c, i) => (i === pos.ci ? chord : c)));
  };

  const removeChord = (pos: PlayPos) => {
    updateChords(pos.si, (chords) => chords.filter((_, i) => i !== pos.ci));
    setEditTarget(null);
    setSel(null);
  };

  // Tap to select; tap another chord in the same part to extend the range;
  // tap inside the current selection to clear it.
  const tapChip = (si: number, ci: number) => {
    setActiveSection(si);
    setSel((cur) => {
      if (!cur || cur.si !== si) return { si, a: ci, b: ci };
      if (ci >= cur.a && ci <= cur.b) return null;
      return { si, a: Math.min(cur.a, ci), b: Math.max(cur.b, ci) };
    });
  };

  const addSection = () => {
    const used = new Set(sections.map((s) => s.name));
    const name = SECTION_NAMES.find((n) => !used.has(n)) ?? `Part ${sections.length + 1}`;
    edit((s) => ({ ...s, sections: { list: [...s.sections.list, { name, chords: [] }] } }));
    setActiveSection(sections.length);
  };

  const renameSection = (si: number, name: string) => {
    edit((s) => ({
      ...s,
      sections: { list: s.sections.list.map((sec, i) => (i === si ? { ...sec, name } : sec)) },
    }));
  };

  const moveSection = (si: number, dir: -1 | 1) => {
    setSel(null);
    const to = si + dir;
    if (to < 0 || to >= sections.length) return;
    edit((s) => {
      const list = [...s.sections.list];
      [list[si], list[to]] = [list[to], list[si]];
      return { ...s, sections: { list } };
    });
    setActiveSection(to);
    setSectionTarget(to);
  };

  const duplicateSection = (si: number) => {
    setSel(null);
    edit((s) => {
      const src = s.sections.list[si];
      const copy = { ...src, name: `${src.name} 2`, chords: src.chords.map((c) => ({ ...c })) };
      const list = [...s.sections.list];
      list.splice(si + 1, 0, copy);
      return { ...s, sections: { list } };
    });
    setActiveSection(si + 1);
    setSectionTarget(si + 1);
  };

  const setRepeat = (si: number, delta: number) => {
    edit((s) => ({
      ...s,
      sections: {
        list: s.sections.list.map((sec, i) =>
          i === si
            ? { ...sec, repeat: Math.min(16, Math.max(1, sectionRepeat(sec) + delta)) }
            : sec
        ),
      },
    }));
  };

  const removeSection = (si: number) => {
    if (sections.length <= 1) return; // a song keeps at least one part
    setSel(null);
    edit((s) => ({ ...s, sections: { list: s.sections.list.filter((_, i) => i !== si) } }));
    setActiveSection((a) => Math.max(0, a > si ? a - 1 : Math.min(a, sections.length - 2)));
    setSectionTarget(null);
  };

  const rotateKey = (dir: 1 | -1) => {
    const next = ((keyIdx + dir) % 12 + 12) % 12;
    edit((s) => ({ ...s, songKey: FIFTHS[next].maj }));
  };

  const stop = () => {
    if (playTimer.current) clearTimeout(playTimer.current);
    playTimer.current = null;
    // Kill everything scheduled on this run's bus — sources may be booked
    // minutes ahead, so silencing the bus is what actually stops the sound.
    killBus(playBus.current);
    playBus.current = null;
    setPlaying(false);
    setPlayPos(null);
  };

  const togglePlay = async () => {
    if (playing) return stop();
    const ctx = ensureCtx();
    // Give samples up to 2s to decode; past that, play starts on the synth.
    await Promise.race([ensureLoaded(ctx, instrument), new Promise((r) => setTimeout(r, 2000))]);
    if (playBus.current) stop(); // a second tap raced the decode — reset first
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);
    playBus.current = bus;
    const beatDur = 60 / song.bpm;
    const barDur = beatDur * 4;
    const scheduleBar = (chord: Chord, atAbs: number) => {
      const rel = atAbs - ctx.currentTime;
      playChordAt(chordSemis(chord), rel, barDur * 0.95, instrument, bus);
      if (metronome) {
        for (let b = 0; b < 4; b++) clickAt(rel + b * beatDur, b === 0, bus);
      }
    };

    // A selected RANGE loops forever (until stop). Audio is scheduled one pass
    // ahead of the pass that's sounding, against an absolute clock (no drift).
    if (sel && sel.b > sel.a) {
      const loop = sections[sel.si].chords.slice(sel.a, sel.b + 1);
      const len = loop.length;
      if (!len) return stop();
      const passDur = len * barDur;
      const t0 = ctx.currentTime + 0.06;
      const schedulePass = (p: number) =>
        loop.forEach((c, i) => scheduleBar(c, t0 + p * passDur + i * barDur));
      schedulePass(0);
      schedulePass(1);
      setPlaying(true);
      let g = 0;
      const tick = () => {
        const i = g % len;
        if (i === 0 && g > 0) schedulePass(g / len + 1);
        setPlayPos({ si: sel.si, ci: sel.a + i });
        g++;
        playTimer.current = setTimeout(tick, barDur * 1000);
      };
      tick();
      return;
    }

    // Otherwise play linearly: every section in order, honoring repeats, one
    // bar per chord — starting from the selected chord when there is one.
    const steps: Array<{ si: number; ci: number; chord: Chord }> = [];
    sections.forEach((sec, si) => {
      for (let r = 0; r < sectionRepeat(sec); r++) {
        sec.chords.forEach((chord, ci) => steps.push({ si, ci, chord }));
      }
    });
    let startIdx = 0;
    if (sel) {
      const found = steps.findIndex((st) => st.si === sel.si && st.ci === sel.a);
      if (found >= 0) startIdx = found;
    }
    const playSteps = steps.slice(startIdx);
    if (!playSteps.length) return stop();
    const t0 = ctx.currentTime + 0.06;
    playSteps.forEach((st, i) => scheduleBar(st.chord, t0 + i * barDur));
    setPlaying(true);
    let step = 0;
    const tick = () => {
      if (step >= playSteps.length) return stop();
      const st = playSteps[step];
      setPlayPos({ si: st.si, ci: st.ci });
      sectionRefs.current[st.si]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      step++;
      playTimer.current = setTimeout(tick, barDur * 1000);
    };
    tick();
  };

  const save = async (override?: SavedSong) => {
    if (saving) return false;
    const src = override ?? song;
    setSaving(true);
    setSaveError(null);
    const payload: SavedSong = {
      title: src.title.trim() || "Untitled",
      songKey: src.songKey,
      bpm: src.bpm,
      timeSignature: src.timeSignature,
      sections: src.sections,
      shareId: src.shareId,
    };
    try {
      const res = await fetch(itemId ? `/api/songs/${itemId}` : "/api/songs", {
        method: itemId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 || res.status === 403) {
        // Not logged in: stash the work so it survives the login round-trip,
        // then come back to /songs/new where the pending save auto-completes.
        if (!itemId) {
          try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({ song: src, pendingSave: true }));
          } catch {
            // storage unavailable — login still proceeds, work may be lost
          }
        }
        window.location.href = `/api/auth/login?returnUrl=${encodeURIComponent(
          itemId ? window.location.pathname : "/songs/new"
        )}`;
        return false;
      }
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const saved = await res.json();
      if (!itemId && saved._id) {
        setItemId(saved._id);
        window.history.replaceState({}, "", `/songs/${saved._id}`);
      }
      if (!itemId) {
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          // storage unavailable — stale draft is harmless
        }
      }
      setDirty(false);
      return true;
    } catch {
      setSaveError("Couldn't save — check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const shareUrl = song.shareId ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${song.shareId}` : null;

  const setSharing = async (on: boolean) => {
    if (shareBusy) return;
    setShareBusy(true);
    setCopied(false);
    const shareId = on
      ? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "")
      : undefined;
    const next = { ...song, shareId };
    setSong(next);
    const ok = await save(next);
    if (!ok) setSong(song); // save failed — roll the toggle back
    setShareBusy(false);
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — the URL is visible to select manually
    }
  };

  // ---------- wheel (rebuilt each render; 24 wedges is cheap) ----------
  const renderWheel = () => {
    const size = 300;
    const cx = size / 2;
    const cy = size / 2;
    const rings: Array<{ q: "maj" | "min"; r1: number; r2: number }> = [
      { q: "maj", r1: 97, r2: 142 },
      { q: "min", r1: 54, r2: 93 },
    ];
    const wedges: JSX.Element[] = [];
    for (let i = 0; i < 12; i++) {
      const rel = ((i - keyIdx) % 12 + 12) % 12;
      const inKey = isInKey(i, keyIdx);
      const aMid = rel * 30;
      const a0 = aMid - 14.4;
      const a1 = aMid + 14.4;
      for (const ring of rings) {
        const label = ring.q === "min" ? FIFTHS[i].min : FIFTHS[i].maj;
        const [lx, ly] = polar(cx, cy, (ring.r1 + ring.r2) / 2, aMid);
        wedges.push(
          <g key={`${i}-${ring.q}`}>
            <path
              d={wedgePath(cx, cy, ring.r1, ring.r2, a0, a1)}
              className={`wedge ${inKey ? "wedge-in" : "wedge-out"} wedge-${ring.q}`}
              role="button"
              tabIndex={0}
              aria-label={`${label}${inKey ? " (in key)" : ""}`}
              onPointerDown={(e) => {
                e.preventDefault();
                tapChord(i, ring.q);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  tapChord(i, ring.q);
                }
              }}
            />
            <text
              x={lx}
              y={ly + (ring.q === "min" ? 4 : 5)}
              textAnchor="middle"
              className={`wedge-label ${inKey ? "label-in" : "label-out"} label-${ring.q}`}
              style={{ pointerEvents: "none" }}
            >
              {label}
            </text>
          </g>
        );
      }
    }
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Circle of fifths chord wheel">
        {wedges}
        <circle cx={cx} cy={cy} r={48} className="hub" />
        <text x={cx} y={cy - 2} textAnchor="middle" className="hub-key">
          {FIFTHS[keyIdx].maj}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="hub-sub">
          MAJOR
        </text>
      </svg>
    );
  };

  const editChord = editTarget ? sections[editTarget.si]?.chords[editTarget.ci] : null;

  return (
    <div className="editor">
      <header className="ed-head">
        <a
          className="back"
          href={source === "shared" && !itemId ? "/" : "/songs"}
          aria-label={source === "shared" && !itemId ? "Home" : "Back to my songs"}
        >‹</a>
        <input
          className="title-input"
          value={song.title}
          onChange={(e) => edit((s) => ({ ...s, title: e.target.value }))}
          aria-label="Song title"
        />
        {(source !== "shared" || itemId) && (
        <button
          className="share-btn"
          onClick={() => setShareOpen(true)}
          aria-label="Share song"
          title="Share song"
        >
          <svg width="17" height="17" viewBox="0 0 17 17">
            <path d="M8.5 1.5v9M5 4.5l3.5-3 3.5 3M3.5 8v6h10V8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        )}
        <button className="save-btn" onClick={() => save()} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </header>
      {saveError && <p className="save-error">{saveError}</p>}
      {source === "shared" && !itemId && (
        <p className="shared-note">Shared song — play with it freely; saving adds a copy to your songbook.</p>
      )}

      <div className="key-row">
        <button className="key-arrow" onClick={() => rotateKey(-1)} aria-label="Rotate key counterclockwise">←</button>
        <span className="key-pill">{FIFTHS[keyIdx].maj} major</span>
        <button className="key-arrow" onClick={() => rotateKey(1)} aria-label="Rotate key clockwise">→</button>
      </div>

      <div className="wheelbox">{renderWheel()}</div>

      <div className="sections-scroll">
        {sections.map((sec, si) => (
          <section
            key={si}
            ref={(el) => {
              sectionRefs.current[si] = el;
            }}
            className={`section-block ${si === activeSection ? "sb-active" : ""} ${playing && playPos?.si === si ? "sb-playing" : ""}`}
            onClick={() => setActiveSection(si)}
          >
            <div className="sb-head">
              <span className="sb-title-row">
                {sectionRepeat(sec) > 1 && <span className="sb-repeat">{sectionRepeat(sec)}×</span>}
                <span className="sb-name">{sec.name}</span>
              </span>
              <span className="sb-side">
                <span className="sb-meta">
                  {si === activeSection ? "adding here" : `${sec.chords.length} chords`}
                </span>
                <button
                  className="sb-more"
                  aria-label={`Edit part ${sec.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSection(si);
                    setSectionTarget(si);
                  }}
                >
                  ⋯
                </button>
              </span>
            </div>
            <div className="chips">
              {sec.chords.length === 0 && (
                <span className="empty">{si === activeSection ? "Tap the wheel to add chords" : "Empty"}</span>
              )}
              {sec.chords.map((c, ci) => {
                const selected = sel?.si === si && ci >= sel.a && ci <= sel.b;
                return (
                  <button
                    key={ci}
                    className={`chip ${selected ? "chip-selected" : ""} ${playing && playPos?.si === si && playPos?.ci === ci ? "chip-playing" : ""}`}
                    title="Tap to select"
                    onClick={(e) => {
                      e.stopPropagation();
                      tapChip(si, ci);
                    }}
                  >
                    <span className="c-name">{chordLabel(c)}</span>
                    <span className="c-roman">{chordRoman(c, keyIdx)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {sections.length < 10 && (
          <button className="add-section" onClick={addSection}>＋ Add section</button>
        )}
      </div>

      {sel && sections[sel.si] && sel.b < sections[sel.si].chords.length && (
        <div className="sel-bar">
          <span className="sel-info">
            {sel.a === sel.b
              ? `${chordLabel(sections[sel.si].chords[sel.a])} — play starts here`
              : `${sel.b - sel.a + 1} chords — play loops this range`}
          </span>
          {sel.a === sel.b && (
            <button
              className="sel-edit"
              onClick={() => setEditTarget({ si: sel.si, ci: sel.a })}
            >
              Edit chord
            </button>
          )}
          <button className="sel-clear" onClick={() => setSel(null)} aria-label="Clear selection">✕</button>
        </div>
      )}

      <footer className="transport">
        <button className="play-btn" onClick={togglePlay} aria-label={playing ? "Stop" : "Play song"}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="currentColor" /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20"><path d="M5 3.5v13l11-6.5z" fill="currentColor" /></svg>
          )}
        </button>
        <button
          className={`metro-btn ${metronome ? "metro-on" : ""}`}
          onClick={() => setMetronome((m) => !m)}
          aria-pressed={metronome}
          aria-label="Toggle metronome"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path d="M6 2h6l2.5 13.5H3.5L6 2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <line x1="9" y1="12" x2="12.2" y2="4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button className="inst-btn" onClick={cycleInstrument} aria-label="Switch instrument">
          {instrumentLabel(instrument)}
        </button>
        <div className="t-meta">
          <div className="t-bpm">
            <button className="bpm-btn" onClick={() => edit((s) => ({ ...s, bpm: Math.max(40, s.bpm - 4) }))} aria-label="Slower">−</button>
            <span>{song.bpm} BPM</span>
            <button className="bpm-btn" onClick={() => edit((s) => ({ ...s, bpm: Math.min(220, s.bpm + 4) }))} aria-label="Faster">+</button>
          </div>
          <span className="t-sig">
            {song.timeSignature}{metronome ? " · click on" : ""}
          </span>
        </div>
      </footer>

      {shareOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setShareOpen(false)} />
          <div className="sheet" role="dialog" aria-label="Share song">
            <div className="sheet-head">
              <span className="sheet-chord">Share</span>
              <span className="sheet-roman">{song.title || "Untitled"}</span>
            </div>
            {!song.shareId && (
              <>
                <p className="share-note">
                  Create a public link — anyone with it can view and play this
                  song (and adjust the tempo), without an account. They can't
                  edit it.
                </p>
                <div className="sheet-actions">
                  <span />
                  <button className="sheet-done" disabled={shareBusy} onClick={() => setSharing(true)}>
                    {shareBusy ? "Creating…" : "Create link"}
                  </button>
                </div>
              </>
            )}
            {song.shareId && (
              <>
                <p className="share-note">Anyone with this link can view and play the song:</p>
                <div className="share-url-row">
                  <span className="share-url">{shareUrl}</span>
                  <button className="part-btn" onClick={copyShareUrl}>
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <div className="sheet-actions">
                  <button className="remove-chord" disabled={shareBusy} onClick={() => setSharing(false)}>
                    {shareBusy ? "…" : "Stop sharing"}
                  </button>
                  <button className="sheet-done" onClick={() => setShareOpen(false)}>Done</button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {sectionTarget !== null && sections[sectionTarget] && (
        <>
          <div className="sheet-backdrop" onClick={() => setSectionTarget(null)} />
          <div className="sheet" role="dialog" aria-label="Edit song part">
            <div className="sheet-head">
              <span className="sheet-chord">{sections[sectionTarget].name}</span>
              <span className="sheet-roman">{sections[sectionTarget].chords.length} chords</span>
            </div>
            <input
              className="rename-input"
              value={sections[sectionTarget].name}
              onChange={(e) => renameSection(sectionTarget, e.target.value)}
              aria-label="Part name"
            />
            <div className="ext-pills">
              {SECTION_NAMES.map((n) => (
                <button key={n} className="ext-pill" onClick={() => renameSection(sectionTarget, n)}>
                  {n}
                </button>
              ))}
            </div>
            <div className="repeat-row">
              <span className="repeat-label">Repeats</span>
              <div className="repeat-stepper">
                <button
                  className="bpm-btn"
                  disabled={sectionRepeat(sections[sectionTarget]) <= 1}
                  onClick={() => setRepeat(sectionTarget, -1)}
                  aria-label="Fewer repeats"
                >
                  −
                </button>
                <span className="repeat-value">{sectionRepeat(sections[sectionTarget])}×</span>
                <button
                  className="bpm-btn"
                  disabled={sectionRepeat(sections[sectionTarget]) >= 16}
                  onClick={() => setRepeat(sectionTarget, 1)}
                  aria-label="More repeats"
                >
                  +
                </button>
              </div>
            </div>
            <div className="part-actions">
              <button
                className="part-btn"
                disabled={sectionTarget === 0}
                onClick={() => moveSection(sectionTarget, -1)}
              >
                ↑ Move up
              </button>
              <button
                className="part-btn"
                disabled={sectionTarget === sections.length - 1}
                onClick={() => moveSection(sectionTarget, 1)}
              >
                ↓ Move down
              </button>
              <button className="part-btn" onClick={() => duplicateSection(sectionTarget)}>
                ⧉ Duplicate
              </button>
            </div>
            <div className="sheet-actions">
              <button
                className="remove-chord"
                disabled={sections.length <= 1}
                onClick={() => removeSection(sectionTarget)}
              >
                Delete part
              </button>
              <button className="sheet-done" onClick={() => setSectionTarget(null)}>Done</button>
            </div>
          </div>
        </>
      )}

      {editTarget && editChord && (
        <>
          <div className="sheet-backdrop" onClick={() => setEditTarget(null)} />
          <div className="sheet" role="dialog" aria-label="Edit chord">
            <div className="sheet-head">
              <span className="sheet-chord">{chordLabel(editChord)}</span>
              <span className="sheet-roman">{chordRoman(editChord, keyIdx)} in {FIFTHS[keyIdx].maj}</span>
            </div>
            <div className="ext-pills">
              {EXTENSIONS.map((ext) => (
                <button
                  key={ext || "triad"}
                  className={`ext-pill ${(editChord.ext ?? "") === ext ? "ext-active" : ""}`}
                  onClick={() => setChordExt(editTarget, ext)}
                >
                  {extLabel(ext)}
                </button>
              ))}
            </div>
            <div className="sheet-actions">
              <button className="remove-chord" onClick={() => removeChord(editTarget)}>Remove chord</button>
              <button className="sheet-done" onClick={() => setEditTarget(null)}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
