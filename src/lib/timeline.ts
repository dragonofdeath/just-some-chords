// Pure timeline builder: expands a SongDocV2 into a flat, time-stamped event
// list the player schedules verbatim. Handles arrangement/line repeats,
// per-measure signatures, split-measure slots, rests, chord patterns, bass,
// drums, and the count-in bar.
import { clampRepeat, type Measure, type Pos, type SongDocV2 } from "./songModel";
import { bassPatternEvents, chordPatternEvents } from "./patterns";
import { drumPatternEvents, type DrumVoice } from "./drums";
import { beatSeconds, parseSig, type Chord } from "./theory";

export interface TimelineEvent {
  tSec: number;
  dur: number;
  kind: "block" | "arp" | "bass" | "drum" | "click";
  chord?: Chord; // block/arp/bass
  tone?: number; // arp: chord-tone index; bass: 0 root / 2 fifth
  drum?: DrumVoice;
  accent?: boolean;
}

export interface Tick {
  tSec: number;
  pos: Pos;
}

export interface Timeline {
  events: TimelineEvent[]; // sorted by tSec; includes the count-in clicks
  ticks: Tick[]; // one per sounded measure (UI highlight / autoscroll)
  musicStart: number; // seconds of count-in prefix (0 when off)
  passDur: number; // duration of the musical content (loop pass length)
  total: number; // musicStart + passDur
}

export interface TimelineOpts {
  bpm: number;
  sig: string; // song-level time signature
  startPos?: Pos; // start linear playback here
  loop?: { ai: number; li: number; a: number; b: number }; // one pass of this range
  countIn?: boolean;
}

interface FlatMeasure {
  pos: Pos;
  measure: Measure;
}

function flatten(doc: SongDocV2): FlatMeasure[] {
  const out: FlatMeasure[] = [];
  doc.arrangement.forEach((pl, ai) => {
    const part = doc.parts[pl.part];
    if (!part) return;
    for (let r = 0; r < clampRepeat(pl.repeat); r++) {
      part.lines.forEach((line, li) => {
        for (let lr = 0; lr < clampRepeat(line.repeat); lr++) {
          line.measures.forEach((m, mi) => out.push({ pos: { ai, li, mi }, measure: m }));
        }
      });
    }
  });
  return out;
}

export function buildTimeline(doc: SongDocV2, opts: TimelineOpts): Timeline {
  let flat: FlatMeasure[];
  if (opts.loop) {
    const { ai, li, a, b } = opts.loop;
    const line = doc.parts[doc.arrangement[ai]?.part]?.lines[li];
    flat = (line?.measures ?? [])
      .slice(a, b + 1)
      .map((measure, i) => ({ pos: { ai, li, mi: a + i }, measure }));
  } else {
    flat = flatten(doc);
    if (opts.startPos) {
      const { ai, li, mi } = opts.startPos;
      const at = flat.findIndex((f) => f.pos.ai === ai && f.pos.li === li && f.pos.mi === mi);
      if (at > 0) flat = flat.slice(at);
    }
  }

  const events: TimelineEvent[] = [];
  const ticks: Tick[] = [];

  // count-in: one bar of clicks in the first measure's signature
  let musicStart = 0;
  if (opts.countIn && flat.length) {
    const sig = flat[0].measure.sig ?? opts.sig;
    const { n, d } = parseSig(sig);
    const beat = beatSeconds(sig, opts.bpm);
    const compound = d === 8 && n % 3 === 0;
    for (let b = 0; b < n; b++) {
      events.push({
        tSec: b * beat,
        dur: 0.06,
        kind: "click",
        accent: compound ? b % 3 === 0 : b === 0,
      });
    }
    musicStart = n * beat;
  }

  const playback = doc.playback ?? {};
  const songPattern = playback.pattern ?? "block";
  const bassOn = playback.bass === true;
  const bassPat = playback.bassPattern ?? "root5";
  const drums = playback.drums ?? "off";

  let at = musicStart;
  for (const { pos, measure } of flat) {
    const sig = measure.sig ?? opts.sig;
    const { n, d } = parseSig(sig);
    const beat = beatSeconds(sig, opts.bpm);
    const barSec = n * beat;
    const slots = measure.slots.length ? measure.slots : [null];
    // slot boundaries in beats — weighted when the measure has a custom split
    const weights =
      measure.div && measure.div.length === slots.length ? measure.div : slots.map(() => 1);
    const wTotal = weights.reduce((s, v) => s + v, 0);
    const bounds: number[] = [];
    let wAcc = 0;
    for (const w of weights) {
      bounds.push((wAcc / wTotal) * n);
      wAcc += w;
    }
    bounds.push(n);
    ticks.push({ tSec: at, pos });

    // split a pattern event at slot boundaries; each piece sounds its slot's
    // chord (rest slots swallow their piece)
    const emit = (t0: number, dur: number, make: (chord: Chord, t: number, dur: number, first: boolean) => void) => {
      let t = t0;
      const end = Math.min(n, t0 + dur);
      let first = true;
      while (t < end - 1e-6) {
        let si = 0;
        for (let i = 0; i < slots.length; i++) {
          if (bounds[i] <= t + 1e-6) si = i;
        }
        const pieceEnd = Math.min(end, bounds[si + 1]);
        if (pieceEnd <= t + 1e-6) break;
        const chord = slots[si];
        if (chord) make(chord, t, pieceEnd - t, first);
        first = false;
        t = pieceEnd;
      }
    };

    const patId = measure.pat ?? songPattern;
    for (const ev of chordPatternEvents(patId, n, d, doc.patterns?.[patId])) {
      emit(ev.t, ev.dur, (chord, t, dur, first) => {
        events.push({
          tSec: at + t * beat,
          dur: dur * beat * 0.95,
          kind: ev.kind,
          chord,
          tone: ev.tone,
          accent: first && ev.accent,
        });
      });
    }

    if (bassOn) {
      for (const ev of bassPatternEvents(bassPat, n, d)) {
        emit(ev.t, ev.dur, (chord, t, dur, first) => {
          events.push({
            tSec: at + t * beat,
            dur: dur * beat * 0.95,
            kind: "bass",
            chord,
            tone: first ? ev.tone : 0, // after a mid-note chord change, restate the root
            accent: first && ev.accent,
          });
        });
      }
    }

    if (drums === "click") {
      const compound = d === 8 && n % 3 === 0;
      for (let b = 0; b < n; b++) {
        events.push({ tSec: at + b * beat, dur: 0.06, kind: "click", accent: compound ? b % 3 === 0 : b === 0 });
      }
    } else if (drums !== "off") {
      for (const ev of drumPatternEvents(drums, n, d)) {
        events.push({ tSec: at + ev.t * beat, dur: 0.1, kind: "drum", drum: ev.voice, accent: ev.accent });
      }
    }

    at += barSec;
  }

  events.sort((x, y) => x.tSec - y.tSec);
  return { events, ticks, musicStart, passDur: at - musicStart, total: at };
}
