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
  moveMeasures,
  removeCustomPattern,
  transposeDoc,
  withDiv,
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
import SplitSheet from "./sheets/SplitSheet";
import TempoSheet from "./sheets/TempoSheet";
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
  // A pristine new song isn't dirty — autosave must not create "Untitled"
  // rows for people who merely open the editor. A shared copy counts as
  // dirty so its Save button is immediately actionable (fork as-is).
  const [dirty, setDirty] = useState(
    source === "shared" ? true : songId === "new" && !!readDraft()
  );
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
  const [wheelCompact, setWheelCompact] = useState(() => {
    try {
      return localStorage.getItem("jsc-wheel") !== "full";
    } catch {
      return true;
    }
  });
  const [active, setActive] = useState<{ ai: number; li: number }>({ ai: 0, li: 0 });
  const [sel, setSel] = useState<Sel | null>(null);
  const [activeSlot, setActiveSlot] = useState(0);
  const [pickingTo, setPickingTo] = useState(false);
  const [moveSel, setMoveSel] = useState<Sel | null>(null); // measures being moved
  const [measureSettingsOpen, setMeasureSettingsOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [partSheet, setPartSheet] = useState<number | null>(null);
  const [lineSheet, setLineSheet] = useState<{ ai: number; li: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [patternEditor, setPatternEditor] = useState<null | { target: "song" | "measure" | "none"; id?: string }>(null);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setHistVer] = useState(0); // re-render undo/redo disabled state

  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playBus = useRef<GainNode | null>(null);
  const playCfg = useRef<{ loop?: Sel; startPos?: Pos } | null>(null);
  const playPosRef = useRef<Pos | null>(null);
  const playingRef = useRef(false);
  const previewBus = useRef<GainNode | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const past = useRef<Omit<SavedSong, "_id" | "shareId">[]>([]);
  const future = useRef<Omit<SavedSong, "_id" | "shareId">[]>([]);
  const lastEdit = useRef<{ tag?: string; at: number }>({ at: 0 });
  // Changes worth warning about on exit — everything except tempo tweaks.
  const meaningfulDirty = useRef(false);

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
    if (tag !== "bpm") meaningfulDirty.current = true;
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
    setPickingTo(false);
    meaningfulDirty.current = true;
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
    setPickingTo(false);
    meaningfulDirty.current = true;
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
      if (meaningfulDirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

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
    save(d.song, true);
  }, []);

  // Auto-save: persist 1.5s after the last edit. A shared fork stays manual
  // until the FIRST explicit save (so browsing someone's link doesn't silently
  // copy it into your songbook); anonymous saves fall back to the local draft.
  // needsLogin and the failure backoff keep this from retry-hammering the API.
  const autoFail = useRef(0);
  useEffect(() => {
    if (!dirty || saving || needsLogin) return;
    if (source === "shared" && !itemId) return;
    if (Date.now() - autoFail.current < 15000) return;
    const id = setTimeout(async () => {
      const ok = await save(undefined, true);
      if (!ok) autoFail.current = Date.now();
    }, 1500);
    return () => clearTimeout(id);
  }, [song, dirty, saving, needsLogin]);

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
    // replace only when the selection is on the ACTIVE line — otherwise the
    // wheel appends to wherever "adding here" points
    if (selPos && selPos.ai === active.ai && selPos.li === active.li) {
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

  // Tap selects a single measure (tap the selected one to clear). Ranges:
  // select the first measure, tap "to…" in the strip, tap the last measure.
  const tapMeasure = (ai: number, li: number, mi: number) => {
    setActive({ ai, li });
    setActiveSlot(0);
    if (pickingTo && sel && sel.ai === ai && sel.li === li && mi !== sel.a) {
      setSel({ ai, li, a: Math.min(sel.a, mi), b: Math.max(sel.a, mi) });
      setPickingTo(false);
      return;
    }
    setPickingTo(false);
    setSel((cur) =>
      cur && cur.ai === ai && cur.li === li && cur.a === mi && cur.b === mi
        ? null
        : { ai, li, a: mi, b: mi }
    );
  };

  // Hold-to-move: long-pressing a measure lifts it (or the selection it sits
  // inside); dropping — or tapping a marker — places it, even across parts.
  const startMove = (ai: number, li: number, mi: number) => {
    const within = sel && sel.ai === ai && sel.li === li && mi >= sel.a && mi <= sel.b ? sel : null;
    const ms = within ?? { ai, li, a: mi, b: mi };
    setSel(ms);
    setMoveSel(ms);
    setPickingTo(false);
  };

  const dropMove = (ai: number, li: number, index: number) => {
    if (!moveSel) return;
    editDoc((d) => moveMeasures(d, moveSel, { ai, li, index }));
    setActive({ ai, li });
    setMoveSel(null);
    setSel(null);
    setActiveSlot(0);
  };

  // Rotating the key TRANSPOSES the song: every chord shifts with the key,
  // so the roman-numeral harmony stays identical in the new key.
  const rotateKey = (dir: 1 | -1) => {
    const next = ((keyIdx + dir) % 12 + 12) % 12;
    edit(
      (s) => ({ ...s, songKey: FIFTHS[next].maj, sections: transposeDoc(s.sections, dir) }),
      "key"
    );
  };

  const clearTransient = () => {
    setSel(null);
    setActiveSlot(0);
    setPickingTo(false);
    setMoveSel(null);
  };

  // ---------- playback ----------
  // Keep the screen awake while the song plays (long practice loops).
  const acquireWakeLock = async () => {
    try {
      wakeLock.current = await (navigator as any).wakeLock?.request("screen");
    } catch {
      // unsupported or denied — the screen may sleep, playback still runs
    }
  };
  const releaseWakeLock = () => {
    try {
      wakeLock.current?.release();
    } catch {
      // already released
    }
    wakeLock.current = null;
  };

  useEffect(() => {
    const onVis = () => {
      // the OS drops the lock when the tab hides — re-acquire on return
      if (document.visibilityState === "visible" && playingRef.current) acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const stop = () => {
    if (playTimer.current) clearTimeout(playTimer.current);
    playTimer.current = null;
    killBus(playBus.current);
    playBus.current = null;
    playingRef.current = false;
    releaseWakeLock();
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
    const mute = doc.playback?.mute;
    const lvl: Record<keyof Mix, number> = {
      chords: mute?.chords ? 0 : mixLevel(mix, "chords"),
      bass: mute?.bass ? 0 : mixLevel(mix, "bass"),
      drums: mute?.drums ? 0 : mixLevel(mix, "drums"),
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
    acquireWakeLock();
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
  const mixKey = JSON.stringify([doc.playback?.mix ?? {}, doc.playback?.mute ?? {}]);
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

  const setBpm = (v: number) =>
    edit((s) => ({ ...s, bpm: Math.min(220, Math.max(40, Math.round(v))) }), "bpm");

  // ---------- save / share ----------
  const save = async (override?: SavedSong, silent = false) => {
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
        if (silent) {
          // autosave must never yank the user to the login page — keep the
          // work safe on-device and surface a hint instead
          if (!itemId) {
            try {
              localStorage.setItem(DRAFT_KEY, JSON.stringify({ song: src }));
              meaningfulDirty.current = false; // stashed locally — no unload nag
            } catch {
              // storage unavailable — beforeunload still guards
            }
          }
          setNeedsLogin(true);
          return false;
        }
        if (!itemId) {
          try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({ song: src, pendingSave: true }));
          } catch {
            // storage unavailable — login still proceeds, work may be lost
          }
        }
        meaningfulDirty.current = false; // draft is stashed — don't double-prompt on the redirect
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
      meaningfulDirty.current = false;
      setNeedsLogin(false);
      setDirty(false);
      return true;
    } catch {
      if (!silent) setSaveError("Couldn't save — check your connection and try again.");
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

  const backHref = source === "shared" && !itemId ? "/" : "/songs";

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
          href={backHref}
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
        {dirty && (needsLogin || (source === "shared" && !itemId) || !!saveError) ? (
          <button className="save-btn" onClick={() => save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        ) : (
          <button
            className="save-btn save-quiet"
            onClick={() => save()}
            disabled={!dirty || saving}
            aria-label={saving || dirty ? "Saving" : "Saved"}
          >
            <span className={`sync-dot ${saving || dirty ? "sync-busy" : ""}`} />
            Saved
          </button>
        )}
      </header>
      {saveError && <p className="save-error">{saveError}</p>}
      {source === "shared" && !itemId && (
        <p className="shared-note">Shared song — play with it freely; saving adds a copy to your songbook.</p>
      )}
      {needsLogin && (
        <p className="shared-note">Changes are kept on this device — tap Save to sign in and keep them in your songbook.</p>
      )}
      {doc.note && <p className="note-text note-song">{doc.note}</p>}

      <div className="key-row">
        <button className="key-arrow" onClick={() => rotateKey(-1)} aria-label="Transpose down a fifth">←</button>
        <span className="key-pill">{FIFTHS[keyIdx].maj} major</span>
        <button className="key-arrow" onClick={() => rotateKey(1)} aria-label="Transpose up a fifth">→</button>
        <button
          className="key-arrow wheel-toggle"
          onClick={() => {
            setWheelCompact((c) => {
              try {
                localStorage.setItem("jsc-wheel", c ? "full" : "compact");
              } catch {
                // preference just won't persist
              }
              return !c;
            });
          }}
          aria-label={wheelCompact ? "Show full wheel" : "Show compact chords"}
          title={wheelCompact ? "Full wheel" : "Compact"}
        >
          {wheelCompact ? "◯" : "▂"}
        </button>
      </div>

      {wheelCompact ? (
        <div className="compact-row">
          {[
            { idx: keyIdx, q: "maj" as const, roman: "I" },
            { idx: (keyIdx + 11) % 12, q: "maj" as const, roman: "IV" },
            { idx: (keyIdx + 1) % 12, q: "maj" as const, roman: "V" },
            { idx: keyIdx, q: "min" as const, roman: "vi" },
            { idx: (keyIdx + 11) % 12, q: "min" as const, roman: "ii" },
            { idx: (keyIdx + 1) % 12, q: "min" as const, roman: "iii" },
          ].map((d) => (
            <button key={d.roman} className="compact-chord" onClick={() => tapChord(d.idx, d.q)}>
              <span className="c-name">{chordLabel({ idx: d.idx, quality: d.q })}</span>
              <span className="c-roman">{d.roman}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="wheelbox">{renderWheel()}</div>
      )}

      <PartView
        doc={doc}
        keyIdx={keyIdx}
        sel={sel}
        moveSel={moveSel}
        playPos={playPos}
        playing={playing}
        active={active}
        registerRow={(ai, li, el) => {
          if (el) rowRefs.current.set(`${ai}:${li}`, el);
          else rowRefs.current.delete(`${ai}:${li}`);
        }}
        onTapMeasure={tapMeasure}
        onMoveStart={startMove}
        onDrop={dropMove}
        onTapLine={(ai, li) => {
          setActive({ ai, li });
          // tapping outside the chips deselects — the wheel goes back to
          // appending where "adding here" points
          setSel(null);
          setActiveSlot(0);
          setPickingTo(false);
        }}
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

      {moveSel && (
        <div className="sel-bar">
          <span className="sel-info">
            Moving {moveSel.b - moveSel.a + 1 === 1 ? "1 measure" : `${moveSel.b - moveSel.a + 1} measures`} — drop it, or tap a slot marker
          </span>
          <button className="sel-clear" onClick={() => setMoveSel(null)} aria-label="Cancel move">✕</button>
        </div>
      )}

      {!moveSel && sel && sel.b > sel.a && (
        <div className="sel-bar">
          <span className="sel-info">{sel.b - sel.a + 1} measures — play loops this range</span>
          <button className="sel-clear" onClick={() => setSel(null)} aria-label="Clear selection">✕</button>
        </div>
      )}

      {!moveSel && selPos && selMeasure && (
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
            <button
              className="strip-mini strip-to"
              onClick={() => setSplitOpen(true)}
              aria-label="Split this measure"
            >
              Split
            </button>
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
              className={`strip-mini strip-to ${pickingTo ? "strip-mini-active" : ""}`}
              onClick={() => setPickingTo((p) => !p)}
              aria-label="Select a range up to another measure"
            >
              to…
            </button>
            <button
              className="strip-mini strip-to"
              onClick={() => sel && setMoveSel(sel)}
              aria-label="Move this selection"
            >
              Move
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
            {pickingTo ? (
              <span className="strip-hint">Now tap the last measure of the range — play will loop it</span>
            ) : slotChord ? (
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
          <button className="t-bpm-btn" onClick={() => setTempoOpen(true)} aria-label="Change tempo">
            {song.bpm} BPM
          </button>
          <span className="t-sig-row">
            <button className="t-sig-btn" onClick={() => setSigOpen(true)} aria-label="Change time signature">
              {song.timeSignature}
            </button>
          </span>
        </div>
      </footer>

      {splitOpen && selPos && selMeasure && (
        <SplitSheet
          measure={selMeasure}
          sig={selMeasure.sig ?? song.timeSignature}
          onApply={(div) => {
            editDoc((d) => mapMeasure(d, selPos, (m) => withDiv(m, div)));
            setActiveSlot(0);
            setSplitOpen(false);
          }}
          onClose={() => setSplitOpen(false)}
        />
      )}

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
          onNote={(note) =>
            editDoc((d) => mapPart(d, partSheet, (p) => ({ ...p, note: note.trim() ? note : undefined })), "note-part")
          }
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
          onNote={(note) =>
            editDoc(
              (d) => mapLine(d, lineSheet.ai, lineSheet.li, (l) => ({ ...l, note: note.trim() ? note : undefined })),
              "note-line"
            )
          }
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
          onLoop={() => {
            const line = partAt(doc, lineSheet.ai)?.part.lines[lineSheet.li];
            if (!line?.measures.length) return;
            setSel({ ai: lineSheet.ai, li: lineSheet.li, a: 0, b: line.measures.length - 1 });
            setActive({ ai: lineSheet.ai, li: lineSheet.li });
            setLineSheet(null);
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
          onMute={(track, muted) =>
            editDoc((d) => ({
              ...d,
              playback: { ...(d.playback ?? {}), mute: { ...(d.playback?.mute ?? {}), [track]: muted } },
            }))
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

      {tempoOpen && <TempoSheet bpm={song.bpm} onSet={setBpm} onClose={() => setTempoOpen(false)} />}

      {sigOpen && (
        <Sheet title="Song settings" sub="whole song" label="Song settings" onClose={() => setSigOpen(false)}>
          <p className="sheet-label">Time signature</p>
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
          <p className="sheet-label">Song notes — shown under the title</p>
          <textarea
            className="note-input"
            rows={3}
            value={doc.note ?? ""}
            onChange={(e) =>
              editDoc((d) => ({ ...d, note: e.target.value.trim() ? e.target.value : undefined }), "note-song")
            }
            placeholder="e.g. capo 2, original by…, tune down half step"
            aria-label="Song notes"
          />
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
