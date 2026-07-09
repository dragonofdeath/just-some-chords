import { useEffect, useRef, useState } from "react";
import { ensureLoaded, preload, type Instrument } from "../lib/sampler";
import { clickAt, ensureCtx, killBus, playChordAt, playMidiAt } from "../lib/audio";
import { playDrum } from "../lib/drums";
import { buildTimeline } from "../lib/timeline";
import { chordPatternEvents } from "../lib/patterns";
import {
  clampRepeat,
  emptyDoc,
  isSongDoc,
  mapLine,
  mapMeasure,
  mapPart,
  measureAt,
  migrateSong,
  mixLevel,
  newPartId,
  newPatternId,
  partAt,
  removeCustomPattern,
  withSlotCount,
  type Mix,
  type Pos,
  type SongDocV2,
} from "../lib/songModel";
import {
  EXTENSIONS,
  FIFTHS,
  TIME_SIGNATURES,
  bassMidi,
  beatSeconds,
  chordLabel,
  chordSemis,
  chordToneSemis,
  extLabel,
  isInKey,
  keyIdxFromName,
  parseSig,
  type Chord,
} from "../lib/theory";
import PartView, { type Sel } from "./PartView";
import MeasureSettingsSheet from "./sheets/MeasureSettingsSheet";
import SoundSheet from "./sheets/SoundSheet";
import PatternEditorSheet, { type PatternDraft } from "./sheets/PatternEditorSheet";
import PatternsSheet from "./sheets/PatternsSheet";
import { AddPartSheet, LineSheet, PartSheet } from "./sheets/PartSheet";
import Sheet from "./sheets/Sheet";

interface SavedSong {
  _id?: string;
  shareId?: string;
  title: string;
  songKey: string;
  bpm: number;
  timeSignature: string;
  sections: SongDocV2;
}

interface Props {
  songId: string; // "new" or an existing item id
  initialSong: (Omit<SavedSong, "sections"> & { sections: any }) | null;
  // "shared": opened from a public share link — an unsaved copy of someone's
  // song; saving forks it into the visitor's own songbook.
  source?: "member" | "shared";
}

const DRAFT_KEY = "jsc-draft";

function newSong(): SavedSong {
  return { title: "Untitled", songKey: "G", bpm: 84, timeSignature: "4/4", sections: emptyDoc() };
}

function normalize(raw: any): SavedSong {
  return {
    _id: raw?._id,
    shareId: raw?.shareId,
    title: typeof raw?.title === "string" ? raw.title : "Untitled",
    songKey: typeof raw?.songKey === "string" ? raw.songKey : "G",
    bpm: typeof raw?.bpm === "number" ? raw.bpm : 84,
    timeSignature: typeof raw?.timeSignature === "string" ? raw.timeSignature : "4/4",
    sections: migrateSong(raw?.sections),
  };
}

function readDraft(): { song: SavedSong; pendingSave?: boolean } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const sec = d?.song?.sections;
    if (!sec || (!isSongDoc(sec) && !Array.isArray(sec.list))) return null;
    return { song: normalize(d.song), pendingSave: d.pendingSave };
  } catch {
    return null;
  }
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

export default function SongEditor({ songId, initialSong, source = "member" }: Props) {
  const [song, setSong] = useState<SavedSong>(() => {
    if (songId === "new" && source !== "shared") {
      const d = readDraft();
      if (d) return d.song;
    }
    return initialSong ? normalize(initialSong) : newSong();
  });
  const [itemId, setItemId] = useState<string | null>(songId === "new" ? null : songId);
  const [dirty, setDirty] = useState(songId === "new");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState<Pos | null>(null);
  const [instrument, setInstrument] = useState<Instrument>(() => {
    try {
      const v = localStorage.getItem("jsc-instrument");
      return v === "piano" || v === "guitar" || v === "synth" ? v : "piano";
    } catch {
      return "piano";
    }
  });
  const [active, setActive] = useState<{ ai: number; li: number }>({ ai: 0, li: 0 });
  const [sel, setSel] = useState<Sel | null>(null);
  const [activeSlot, setActiveSlot] = useState(0);
  const [measureSettingsOpen, setMeasureSettingsOpen] = useState(false);
  const [partSheet, setPartSheet] = useState<number | null>(null);
  const [lineSheet, setLineSheet] = useState<{ ai: number; li: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [patternEditor, setPatternEditor] = useState<null | { target: "song" | "measure" | "none"; id?: string }>(null);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setHistVer] = useState(0); // re-render undo/redo disabled state

  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playBus = useRef<GainNode | null>(null);
  const playCfg = useRef<{ loop?: Sel; startPos?: Pos } | null>(null);
  const playPosRef = useRef<Pos | null>(null);
  const playingRef = useRef(false);
  const holdTimer = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const previewBus = useRef<GainNode | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const past = useRef<Omit<SavedSong, "_id" | "shareId">[]>([]);
  const future = useRef<Omit<SavedSong, "_id" | "shareId">[]>([]);
  const lastEdit = useRef<{ tag?: string; at: number }>({ at: 0 });

  const doc = song.sections;
  const keyIdx = keyIdxFromName(song.songKey);

  // ---------- history ----------
  const snapshot = (s: SavedSong) => ({
    title: s.title,
    songKey: s.songKey,
    bpm: s.bpm,
    timeSignature: s.timeSignature,
    sections: s.sections,
  });

  const edit = (fn: (s: SavedSong) => SavedSong, tag?: string) => {
    setSong((s) => {
      const coalesce = !!tag && lastEdit.current.tag === tag && Date.now() - lastEdit.current.at < 800;
      if (!coalesce) {
        past.current.push(snapshot(s));
        if (past.current.length > 100) past.current.shift();
        future.current = [];
      }
      lastEdit.current = { tag, at: Date.now() };
      return fn(s);
    });
    setDirty(true);
    setHistVer((v) => v + 1);
  };

  const editDoc = (fn: (d: SongDocV2) => SongDocV2, tag?: string) =>
    edit((s) => ({ ...s, sections: fn(s.sections) }), tag);

  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    lastEdit.current = { at: 0 };
    setSong((s) => {
      future.current.push(snapshot(s));
      return { ...s, ...prev };
    });
    setSel(null);
    setActiveSlot(0);
    setDirty(true);
    setHistVer((v) => v + 1);
  };

  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    lastEdit.current = { at: 0 };
    setSong((s) => {
      past.current.push(snapshot(s));
      return { ...s, ...next };
    });
    setSel(null);
    setActiveSlot(0);
    setDirty(true);
    setHistVer((v) => v + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- lifecycle ----------
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => () => stop(), []);

  // Finish a save that was interrupted by the login redirect (see save()).
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

  useEffect(() => {
    preload(instrument);
    if (doc.playback?.bass) preload("bass");
    try {
      localStorage.setItem("jsc-instrument", instrument);
    } catch {
      // private mode etc. — preference just won't persist
    }
  }, [instrument, doc.playback?.bass]);

  // ---------- structural edits ----------
  const selPos: Pos | null = sel && sel.a === sel.b ? { ai: sel.ai, li: sel.li, mi: sel.a } : null;

  const tapChord = (idx: number, quality: "maj" | "min") => {
    const chord: Chord = { idx, quality };
    playChordAt(chordSemis(chord), 0, 1.2, instrument);
    if (selPos) {
      // a measure is selected — the wheel replaces its active slot
      editDoc((d) =>
        mapMeasure(d, selPos, (m) => ({
          ...m,
          slots: m.slots.map((s, i) => (i === Math.min(activeSlot, m.slots.length - 1) ? chord : s)),
        }))
      );
      return;
    }
    editDoc((d) =>
      mapLine(d, active.ai, active.li, (line) =>
        line.measures.length >= 32 ? line : { ...line, measures: [...line.measures, { slots: [chord] }] }
      )
    );
  };

  // Tap always selects a single measure (tap the selected one to clear);
  // ranges come only from dragging across measures.
  const tapMeasure = (ai: number, li: number, mi: number) => {
    setActive({ ai, li });
    setActiveSlot(0);
    setSel((cur) =>
      cur && cur.ai === ai && cur.li === li && cur.a === mi && cur.b === mi
        ? null
        : { ai, li, a: mi, b: mi }
    );
  };

  const dragRange = (ai: number, li: number, from: number, to: number) => {
    setActive({ ai, li });
    setActiveSlot(0);
    setSel({ ai, li, a: Math.min(from, to), b: Math.max(from, to) });
  };

  const rotateKey = (dir: 1 | -1) => {
    const next = ((keyIdx + dir) % 12 + 12) % 12;
    edit((s) => ({ ...s, songKey: FIFTHS[next].maj }), "key");
  };

  const clearTransient = () => {
    setSel(null);
    setActiveSlot(0);
  };

  // ---------- playback ----------
  const stop = () => {
    if (playTimer.current) clearTimeout(playTimer.current);
    playTimer.current = null;
    killBus(playBus.current);
    playBus.current = null;
    playingRef.current = false;
    setPlaying(false);
    setPlayPos(null);
  };

  const startPlayback = async (opts: { loop?: Sel; startPos?: Pos; countIn: boolean }) => {
    const ctx = ensureCtx();
    const loopMode = !!opts.loop;
    const tl = buildTimeline(doc, {
      bpm: song.bpm,
      sig: song.timeSignature,
      loop: opts.loop ? { ai: opts.loop.ai, li: opts.loop.li, a: opts.loop.a, b: opts.loop.b } : undefined,
      startPos: opts.startPos,
      countIn: opts.countIn,
    });
    if (!tl.ticks.length) return;
    // Give samples up to 2s to decode; past that, play starts on the synth.
    const wanted: Promise<void>[] = [ensureLoaded(ctx, instrument)];
    if (doc.playback?.bass) wanted.push(ensureLoaded(ctx, "bass"));
    await Promise.race([Promise.all(wanted), new Promise((r) => setTimeout(r, 2000))]);
    if (playBus.current) stop(); // a second tap raced the decode — reset first

    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);
    playBus.current = bus;
    playCfg.current = { loop: opts.loop, startPos: opts.startPos };
    const t0 = ctx.currentTime + 0.08;
    const mix = doc.playback?.mix;
    const lvl: Record<keyof Mix, number> = {
      chords: mixLevel(mix, "chords"),
      bass: mixLevel(mix, "bass"),
      drums: mixLevel(mix, "drums"),
    };

    const scheduleEvent = (ev: (typeof tl.events)[number], offset: number) => {
      const rel = t0 + offset + ev.tSec - ctx.currentTime;
      switch (ev.kind) {
        case "block":
          playChordAt(chordSemis(ev.chord!), rel, ev.dur, instrument, bus, lvl.chords);
          break;
        case "arp": {
          const semi = chordToneSemis(ev.chord!)[ev.tone ?? 0];
          const midi = 60 + semi + (instrument === "guitar" ? -12 : 0);
          playMidiAt(midi, rel, ev.dur, instrument, (ev.accent ? 0.5 : 0.36) * lvl.chords, bus);
          break;
        }
        case "bass":
          playMidiAt(bassMidi(ev.chord!, (ev.tone ?? 0) as 0 | 2), rel, ev.dur, "bass", (ev.accent ? 0.62 : 0.5) * lvl.bass, bus);
          break;
        case "drum":
          playDrum(ctx, ev.drum!, rel, !!ev.accent, bus, lvl.drums);
          break;
        case "click":
          clickAt(rel, !!ev.accent, bus, lvl.drums);
          break;
      }
    };

    tl.events.forEach((ev) => scheduleEvent(ev, 0));
    const musicEvents = tl.events.filter((ev) => ev.tSec >= tl.musicStart - 1e-6);
    if (loopMode) musicEvents.forEach((ev) => scheduleEvent(ev, tl.passDur)); // pass 1 pre-scheduled

    playingRef.current = true;
    setPlaying(true);
    let k = 0;
    let pass = 0;
    const tick = () => {
      const t = tl.ticks[k];
      playPosRef.current = t.pos;
      setPlayPos(t.pos);
      rowRefs.current.get(`${t.pos.ai}:${t.pos.li}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      let delaySec: number;
      if (k + 1 < tl.ticks.length) {
        delaySec = tl.ticks[k + 1].tSec - t.tSec;
        k++;
      } else if (loopMode) {
        delaySec = tl.total - t.tSec;
        k = 0;
        pass++;
        musicEvents.forEach((ev) => scheduleEvent(ev, (pass + 1) * tl.passDur)); // keep one pass ahead
      } else {
        playTimer.current = setTimeout(stop, (tl.total - t.tSec) * 1000);
        return;
      }
      playTimer.current = setTimeout(tick, delaySec * 1000);
    };
    playTimer.current = setTimeout(tick, (tl.ticks[0].tSec + 0.08) * 1000);
  };

  const togglePlay = () => {
    if (playing) return stop();
    const loopMode = !!sel && sel.b > sel.a;
    startPlayback({
      loop: loopMode ? sel! : undefined,
      startPos: !loopMode && sel ? { ai: sel.ai, li: sel.li, mi: sel.a } : undefined,
      countIn: doc.playback?.countIn === true,
    });
  };

  // Live tempo / mixer: restart the scheduler from the current measure when
  // BPM or a mix level changes mid-play (debounced; no count-in on restart).
  const mixKey = JSON.stringify(doc.playback?.mix ?? {});
  useEffect(() => {
    if (!playingRef.current) return;
    const id = setTimeout(() => {
      if (!playingRef.current || !playCfg.current) return;
      const cfg = playCfg.current;
      const pos = playPosRef.current;
      stop();
      startPlayback({
        loop: cfg.loop,
        startPos: cfg.loop ? undefined : pos ?? cfg.startPos,
        countIn: false,
      });
    }, 350);
    return () => clearTimeout(id);
  }, [song.bpm, mixKey]);

  // ---------- BPM stepper (±1, hold to auto-repeat) ----------
  // Click is the universal path (works on every device); pointer events only
  // ADD hold-to-repeat where supported, with a timestamp guard so the click
  // that follows a pointer tap doesn't double-bump.
  const lastPointerBump = useRef(0);
  const bumpBpm = (delta: number) =>
    edit((s) => ({ ...s, bpm: Math.min(220, Math.max(40, s.bpm + delta)) }), "bpm");
  const bpmHoldStart = (delta: number) => {
    lastPointerBump.current = Date.now();
    bumpBpm(delta);
    holdTimer.current.t = setTimeout(() => {
      holdTimer.current.i = setInterval(() => {
        lastPointerBump.current = Date.now();
        bumpBpm(delta);
      }, 70);
    }, 450);
  };
  const bpmHoldEnd = () => {
    if (holdTimer.current.t) clearTimeout(holdTimer.current.t);
    if (holdTimer.current.i) clearInterval(holdTimer.current.i);
    holdTimer.current = {};
  };
  const bpmClick = (delta: number) => {
    if (Date.now() - lastPointerBump.current < 600) return; // pointer already handled this tap
    bumpBpm(delta);
  };

  // ---------- save / share ----------
  const save = async (override?: SavedSong) => {
    if (saving) return false;
    const src = override ?? song;
    setSaving(true);
    setSaveError(null);
    const payload = {
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
          // stale draft is harmless
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

  const shareUrl = song.shareId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${song.shareId}`
    : null;

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
    if (!ok) setSong(song);
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

  // ---------- pattern save ----------
  const savePattern = (draft: PatternDraft) => {
    const target = patternEditor?.target;
    const editId = patternEditor?.id;
    const measurePos = target === "measure" ? selPos : null;
    editDoc((d) => {
      const id = editId ?? newPatternId(d);
      let out: SongDocV2 = {
        ...d,
        patterns: { ...(d.patterns ?? {}), [id]: { name: draft.name, steps: draft.steps, res: draft.res } },
      };
      if (measurePos) out = mapMeasure(out, measurePos, (m) => ({ ...m, pat: id }));
      else if (target === "song") out = { ...out, playback: { ...(out.playback ?? {}), pattern: id } };
      return out;
    });
    setPatternEditor(null);
  };

  // Audition a pattern draft over the key's I chord at the song tempo.
  const previewPattern = (draft: PatternDraft) => {
    const ctx = ensureCtx();
    killBus(previewBus.current);
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);
    previewBus.current = bus;
    const { n, d } = parseSig(song.timeSignature);
    const beat = beatSeconds(song.timeSignature, song.bpm);
    const chord: Chord = { idx: keyIdx, quality: "maj" };
    for (const ev of chordPatternEvents("__custom__", n, d, { name: draft.name, steps: draft.steps, res: draft.res })) {
      const rel = 0.05 + ev.t * beat;
      if (ev.kind === "block") {
        playChordAt(chordSemis(chord), rel, ev.dur * beat * 0.95, instrument, bus);
      } else {
        const midi = 60 + chordToneSemis(chord)[ev.tone ?? 0] + (instrument === "guitar" ? -12 : 0);
        playMidiAt(midi, rel, ev.dur * beat * 0.95, instrument, ev.accent ? 0.5 : 0.36, bus);
      }
    }
  };

  // ---------- wheel ----------
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
      for (const ring of rings) {
        const label = ring.q === "min" ? FIFTHS[i].min : FIFTHS[i].maj;
        const [lx, ly] = polar(cx, cy, (ring.r1 + ring.r2) / 2, aMid);
        wedges.push(
          <g key={`${i}-${ring.q}`}>
            <path
              d={wedgePath(cx, cy, ring.r1, ring.r2, aMid - 14.4, aMid + 14.4)}
              className={`wedge ${inKey ? "wedge-in" : "wedge-out"} wedge-${ring.q}`}
              role="button"
              tabIndex={0}
              aria-label={`${label}${inKey ? " (in key)" : ""}`}
              onClick={(e) => {
                (e.currentTarget as unknown as HTMLElement).blur?.();
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
        <text x={cx} y={cy - 2} textAnchor="middle" className="hub-key">{FIFTHS[keyIdx].maj}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="hub-sub">MAJOR</text>
      </svg>
    );
  };

  const selMeasure = selPos ? measureAt(doc, selPos) : null;
  const slotIdx = selMeasure ? Math.min(activeSlot, selMeasure.slots.length - 1) : 0;
  const slotChord = selMeasure ? selMeasure.slots[slotIdx] : null;
  const countIn = doc.playback?.countIn === true;

  const editSlot = (fn: (slots: (Chord | null)[]) => (Chord | null)[]) => {
    if (!selPos) return;
    editDoc((d) => mapMeasure(d, selPos, (m) => ({ ...m, slots: fn(m.slots) })));
  };

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
          onChange={(e) => edit((s) => ({ ...s, title: e.target.value }), "title")}
          aria-label="Song title"
        />
        <button className="hist-btn" onClick={undo} disabled={!past.current.length} aria-label="Undo">↶</button>
        <button className="hist-btn" onClick={redo} disabled={!future.current.length} aria-label="Redo">↷</button>
        {(source !== "shared" || itemId) && (
          <button className="share-btn" onClick={() => setShareOpen(true)} aria-label="Share song" title="Share song">
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

      <PartView
        doc={doc}
        keyIdx={keyIdx}
        sel={sel}
        playPos={playPos}
        playing={playing}
        active={active}
        registerRow={(ai, li, el) => {
          if (el) rowRefs.current.set(`${ai}:${li}`, el);
          else rowRefs.current.delete(`${ai}:${li}`);
        }}
        onTapMeasure={tapMeasure}
        onDragRange={dragRange}
        onTapLine={(ai, li) => setActive({ ai, li })}
        onOpenPart={(ai) => {
          setActive({ ai, li: 0 });
          setPartSheet(ai);
        }}
        onOpenLine={(ai, li) => {
          setActive({ ai, li });
          setLineSheet({ ai, li });
        }}
        onAdd={() => setAddOpen(true)}
      />

      {sel && sel.b > sel.a && (
        <div className="sel-bar">
          <span className="sel-info">{sel.b - sel.a + 1} measures — play loops this range</span>
          <button className="sel-clear" onClick={() => setSel(null)} aria-label="Clear selection">✕</button>
        </div>
      )}

      {selPos && selMeasure && (
        <div className="edit-strip">
          <div className="strip-row strip-scroll">
            {selMeasure.slots.map((s, i) => (
              <button
                key={i}
                className={`strip-slot ${i === slotIdx ? "strip-slot-active" : ""}`}
                onClick={() => setActiveSlot(i)}
              >
                {s ? chordLabel(s) : "—"}
              </button>
            ))}
            <span className="strip-div" />
            {[1, 2, 3, 4].map((k) => (
              <button
                key={k}
                className={`strip-mini ${selMeasure.slots.length === k ? "strip-mini-active" : ""}`}
                onClick={() => {
                  editSlot((slots) => withSlotCount({ slots }, k).slots);
                  setActiveSlot((s) => Math.min(s, k - 1));
                }}
                aria-label={`${k} chords in this measure`}
              >
                {k}
              </button>
            ))}
            <span className="strip-div" />
            <button
              className={`strip-mini ${!slotChord ? "strip-mini-active" : ""}`}
              onClick={() =>
                editSlot((slots) =>
                  slots.map((s, i) =>
                    i !== slotIdx
                      ? s
                      : s
                        ? null
                        : (slots.find((x) => x) ?? { idx: keyIdx, quality: "maj" as const })
                  )
                )
              }
              aria-label="Toggle rest"
              title="Rest"
            >
              —
            </button>
            <button
              className="strip-mini"
              onClick={() => setMeasureSettingsOpen(true)}
              aria-label="Measure settings"
              title="Signature & rhythm"
            >
              ⚙
            </button>
            <button className="strip-mini strip-close" onClick={() => setSel(null)} aria-label="Done editing">✕</button>
          </div>
          <div className="strip-row strip-scroll">
            {slotChord ? (
              EXTENSIONS.map((ext) => (
                <button
                  key={ext || "triad"}
                  className={`strip-pill ${(slotChord.ext ?? "") === ext ? "strip-pill-active" : ""}`}
                  onClick={() => {
                    const next: Chord = { ...slotChord, ext: ext || undefined };
                    playChordAt(chordSemis(next), 0, 1.2, instrument);
                    editSlot((slots) => slots.map((s, i) => (i === slotIdx ? next : s)));
                  }}
                >
                  {extLabel(ext)}
                </button>
              ))
            ) : (
              <span className="strip-hint">Rest — tap the wheel to put a chord here</span>
            )}
          </div>
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
          className={`metro-btn ${countIn ? "metro-on" : ""}`}
          onClick={() => editDoc((d) => ({ ...d, playback: { ...(d.playback ?? {}), countIn: !countIn } }))}
          aria-pressed={countIn}
          aria-label="Toggle count-in"
          title="Count-in"
        >
          <span className="countin-label">1·2</span>
        </button>
        <button className="inst-btn" onClick={() => setSoundOpen(true)} aria-label="Sound settings">
          Sound
        </button>
        <div className="t-meta">
          <div className="t-bpm">
            <button
              className="bpm-btn"
              onPointerDown={() => bpmHoldStart(-1)}
              onPointerUp={bpmHoldEnd}
              onPointerLeave={bpmHoldEnd}
              onPointerCancel={bpmHoldEnd}
              onClick={() => bpmClick(-1)}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Slower"
            >−</button>
            <span>{song.bpm} BPM</span>
            <button
              className="bpm-btn"
              onPointerDown={() => bpmHoldStart(1)}
              onPointerUp={bpmHoldEnd}
              onPointerLeave={bpmHoldEnd}
              onPointerCancel={bpmHoldEnd}
              onClick={() => bpmClick(1)}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Faster"
            >+</button>
          </div>
          <span className="t-sig-row">
            <button className="t-sig-btn" onClick={() => setSigOpen(true)} aria-label="Change time signature">
              {song.timeSignature}
            </button>
          </span>
        </div>
      </footer>

      {measureSettingsOpen && selPos && selMeasure && (
        <MeasureSettingsSheet
          doc={doc}
          measure={selMeasure}
          songSig={song.timeSignature}
          songPattern={doc.playback?.pattern ?? "block"}
          onSetSig={(sig) => editDoc((d) => mapMeasure(d, selPos, (m) => ({ ...m, sig: sig || undefined })))}
          onSetPat={(pat) => editDoc((d) => mapMeasure(d, selPos, (m) => ({ ...m, pat: pat || undefined })))}
          onRemoveMeasure={() => {
            editDoc((d) => mapMeasure(d, selPos, () => null));
            setMeasureSettingsOpen(false);
            clearTransient();
          }}
          onNewPattern={() => setPatternEditor({ target: "measure" })}
          onClose={() => setMeasureSettingsOpen(false)}
        />
      )}

      {partSheet !== null && doc.arrangement[partSheet] && (
        <PartSheet
          doc={doc}
          ai={partSheet}
          onRename={(name) => editDoc((d) => mapPart(d, partSheet, (p) => ({ ...p, name })), "rename")}
          onRepeat={(delta) =>
            editDoc((d) => ({
              ...d,
              arrangement: d.arrangement.map((pl, i) =>
                i === partSheet ? { ...pl, repeat: clampRepeat(clampRepeat(pl.repeat) + delta) } : pl
              ),
            }))
          }
          onMove={(dir) => {
            const to = partSheet + dir;
            if (to < 0 || to >= doc.arrangement.length) return;
            editDoc((d) => {
              const arr = [...d.arrangement];
              [arr[partSheet], arr[to]] = [arr[to], arr[partSheet]];
              return { ...d, arrangement: arr };
            });
            setPartSheet(to);
            clearTransient();
          }}
          onAddLine={() =>
            editDoc((d) => mapPart(d, partSheet, (p) => ({ ...p, lines: [...p.lines, { measures: [] }] })))
          }
          onAddPlacement={() => {
            editDoc((d) => {
              const arr = [...d.arrangement];
              arr.splice(partSheet + 1, 0, { part: d.arrangement[partSheet].part });
              return { ...d, arrangement: arr };
            });
            clearTransient();
          }}
          onDuplicateAsNew={() => {
            editDoc((d) => {
              const at = partAt(d, partSheet);
              if (!at) return d;
              const id = newPartId(d);
              const copy = structuredClone(at.part);
              copy.name = `${at.part.name} 2`;
              const arr = [...d.arrangement];
              arr.splice(partSheet + 1, 0, { part: id, repeat: d.arrangement[partSheet].repeat });
              return { ...d, parts: { ...d.parts, [id]: copy }, arrangement: arr };
            });
            clearTransient();
          }}
          onDeletePlacement={() => {
            editDoc((d) => {
              if (d.arrangement.length <= 1) return d;
              const partId = d.arrangement[partSheet].part;
              const arrangement = d.arrangement.filter((_, i) => i !== partSheet);
              const stillUsed = arrangement.some((pl) => pl.part === partId);
              const parts = stillUsed ? d.parts : Object.fromEntries(Object.entries(d.parts).filter(([id]) => id !== partId));
              return { ...d, arrangement, parts };
            });
            setPartSheet(null);
            setActive({ ai: 0, li: 0 });
            clearTransient();
          }}
          onClose={() => setPartSheet(null)}
        />
      )}

      {lineSheet && (
        <LineSheet
          doc={doc}
          ai={lineSheet.ai}
          li={lineSheet.li}
          onRepeat={(delta) =>
            editDoc((d) =>
              mapLine(d, lineSheet.ai, lineSheet.li, (l) => ({
                ...l,
                repeat: clampRepeat(clampRepeat(l.repeat) + delta),
              }))
            )
          }
          onMove={(dir) => {
            const at = partAt(doc, lineSheet.ai);
            const to = lineSheet.li + dir;
            if (!at || to < 0 || to >= at.part.lines.length) return;
            editDoc((d) =>
              mapPart(d, lineSheet.ai, (p) => {
                const lines = [...p.lines];
                [lines[lineSheet.li], lines[to]] = [lines[to], lines[lineSheet.li]];
                return { ...p, lines };
              })
            );
            setLineSheet({ ...lineSheet, li: to });
            clearTransient();
          }}
          onDuplicate={() => {
            editDoc((d) =>
              mapPart(d, lineSheet.ai, (p) => {
                const lines = [...p.lines];
                lines.splice(lineSheet.li + 1, 0, structuredClone(p.lines[lineSheet.li]));
                return { ...p, lines };
              })
            );
            clearTransient();
          }}
          onDelete={() => {
            editDoc((d) => mapLine(d, lineSheet.ai, lineSheet.li, () => null));
            setLineSheet(null);
            clearTransient();
          }}
          onClose={() => setLineSheet(null)}
        />
      )}

      {addOpen && (
        <AddPartSheet
          doc={doc}
          onNewPart={() => {
            editDoc((d) => {
              const id = newPartId(d);
              const used = new Set(Object.values(d.parts).map((p) => p.name));
              const name = ["Verse", "Chorus", "Intro", "Pre-Chorus", "Bridge", "Outro"].find((n) => !used.has(n)) ?? `Part ${Object.keys(d.parts).length + 1}`;
              return {
                ...d,
                parts: { ...d.parts, [id]: { name, lines: [{ measures: [] }] } },
                arrangement: [...d.arrangement, { part: id }],
              };
            });
            setAddOpen(false);
            setActive({ ai: doc.arrangement.length, li: 0 });
          }}
          onReuse={(partId) => {
            editDoc((d) => ({ ...d, arrangement: [...d.arrangement, { part: partId }] }));
            setAddOpen(false);
            setActive({ ai: doc.arrangement.length, li: 0 });
          }}
          onClose={() => setAddOpen(false)}
        />
      )}

      {soundOpen && (
        <SoundSheet
          doc={doc}
          instrument={instrument}
          onInstrument={(i) => {
            setInstrument(i);
            ensureLoaded(ensureCtx(), i);
          }}
          onPattern={(id) => editDoc((d) => ({ ...d, playback: { ...(d.playback ?? {}), pattern: id } }))}
          onBass={(on) => {
            if (on) {
              preload("bass");
              ensureLoaded(ensureCtx(), "bass");
            }
            editDoc((d) => ({ ...d, playback: { ...(d.playback ?? {}), bass: on } }));
          }}
          onBassPattern={(id) => editDoc((d) => ({ ...d, playback: { ...(d.playback ?? {}), bassPattern: id } }))}
          onDrums={(id) => editDoc((d) => ({ ...d, playback: { ...(d.playback ?? {}), drums: id } }))}
          onMix={(track, value) =>
            editDoc(
              (d) => ({
                ...d,
                playback: { ...(d.playback ?? {}), mix: { ...(d.playback?.mix ?? {}), [track]: value } },
              }),
              `mix-${track}`
            )
          }
          onNewPattern={() => setPatternEditor({ target: "song" })}
          onManage={() => setPatternsOpen(true)}
          onClose={() => setSoundOpen(false)}
        />
      )}

      {patternEditor && (
        <PatternEditorSheet
          initial={
            patternEditor.id && doc.patterns?.[patternEditor.id]
              ? {
                  name: doc.patterns[patternEditor.id].name,
                  steps: doc.patterns[patternEditor.id].steps,
                  res: doc.patterns[patternEditor.id].res === 16 ? 16 : 8,
                }
              : undefined
          }
          onSave={savePattern}
          onPreview={previewPattern}
          onClose={() => setPatternEditor(null)}
        />
      )}

      {patternsOpen && (
        <PatternsSheet
          doc={doc}
          onEdit={(id) => setPatternEditor({ target: "none", id })}
          onClone={(id) =>
            editDoc((d) => {
              const src = d.patterns?.[id];
              if (!src) return d;
              return { ...d, patterns: { ...(d.patterns ?? {}), [newPatternId(d)]: { ...src, name: `${src.name} 2` } } };
            })
          }
          onDelete={(id) => editDoc((d) => removeCustomPattern(d, id))}
          onNew={() => setPatternEditor({ target: "none" })}
          onClose={() => setPatternsOpen(false)}
        />
      )}

      {sigOpen && (
        <Sheet title="Time signature" sub="whole song" label="Time signature" onClose={() => setSigOpen(false)}>
          <div className="ext-pills">
            {TIME_SIGNATURES.map((sig) => (
              <button
                key={sig}
                className={`ext-pill ${song.timeSignature === sig ? "ext-active" : ""}`}
                onClick={() => edit((s) => ({ ...s, timeSignature: sig }))}
              >
                {sig}
              </button>
            ))}
          </div>
          <p className="share-note">
            BPM stays the quarter-note pulse. Single measures can override this from the measure's edit sheet.
          </p>
          <div className="sheet-actions">
            <span />
            <button className="sheet-done" onClick={() => setSigOpen(false)}>Done</button>
          </div>
        </Sheet>
      )}

      {shareOpen && (
        <Sheet title="Share" sub={song.title || "Untitled"} label="Share song" onClose={() => setShareOpen(false)}>
          {!song.shareId && (
            <>
              <p className="share-note">
                Create a public link — anyone with it can open this song in the
                editor and play with a copy, without an account. Your original
                stays yours.
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
                <button className="part-btn" onClick={copyShareUrl}>{copied ? "Copied ✓" : "Copy"}</button>
              </div>
              <div className="sheet-actions">
                <button className="remove-chord" disabled={shareBusy} onClick={() => setSharing(false)}>
                  {shareBusy ? "…" : "Stop sharing"}
                </button>
                <button className="sheet-done" onClick={() => setShareOpen(false)}>Done</button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
