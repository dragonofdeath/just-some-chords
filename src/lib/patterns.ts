// Rhythm patterns for the chord instrument and bass.
// Built-ins are generators over the measure's (n, d) signature so they stay
// musical in any meter; custom patterns are an eighth-note step grid compiled
// to the same event type. Times/durations are in DENOMINATOR BEATS from the
// measure start.
import type { CustomPattern, SongDocV2 } from "./songModel";

export interface PatternEvent {
  t: number;
  dur: number;
  kind: "block" | "arp";
  tone?: number; // chord-tone index for "arp": 0 root, 1 third, 2 fifth, 3 top
  accent?: boolean;
}

export const BUILTIN_PATTERNS: Record<string, string> = {
  block: "Block",
  "strum-beats": "Strum beats",
  "boom-chick": "Boom-chick",
  "arp-up": "Arpeggio up",
  "arp-updown": "Arpeggio up-down",
  waltz: "Waltz",
  off: "Off", // chords silent — bass/drums only
};

const isCompound = (n: number, d: number) => d === 8 && n % 3 === 0;
// the "pulse" a strum/bass note falls on: dotted-quarter groups in compound
// meters, otherwise the denominator beat
const pulseOf = (n: number, d: number) => (isCompound(n, d) ? 3 : 1);
// one eighth note, in denominator beats
const eighthOf = (d: number) => (d === 8 ? 1 : d === 4 ? 0.5 : 0.25);

function blockPattern(n: number): PatternEvent[] {
  return [{ t: 0, dur: n, kind: "block", accent: true }];
}

function strumBeats(n: number, d: number): PatternEvent[] {
  const step = pulseOf(n, d);
  const out: PatternEvent[] = [];
  for (let t = 0; t < n; t += step) {
    out.push({ t, dur: step, kind: "block", accent: t === 0 });
  }
  return out;
}

function boomChick(n: number, d: number): PatternEvent[] {
  const step = pulseOf(n, d);
  const out: PatternEvent[] = [];
  let boom = true;
  for (let t = 0; t < n; t += step) {
    if (boom) {
      out.push({ t, dur: step, kind: "arp", tone: t === 0 ? 0 : 2, accent: t === 0 }); // root, then fifth
    } else {
      out.push({ t, dur: step, kind: "block" });
    }
    boom = !boom;
  }
  return out;
}

function arpPattern(n: number, d: number, cycle: number[]): PatternEvent[] {
  const step = eighthOf(d);
  const out: PatternEvent[] = [];
  let i = 0;
  for (let t = 0; t < n - 1e-6; t += step) {
    out.push({ t, dur: step * 1.6, kind: "arp", tone: cycle[i % cycle.length], accent: t === 0 });
    i++;
  }
  return out;
}

function waltzPattern(n: number, d: number): PatternEvent[] {
  const step = pulseOf(n, d);
  const out: PatternEvent[] = [{ t: 0, dur: step, kind: "arp", tone: 0, accent: true }];
  for (let t = step; t < n; t += step) {
    out.push({ t, dur: step, kind: "block" });
  }
  return out;
}

function compileCustom(steps: string, n: number, d: number): PatternEvent[] {
  const cell = eighthOf(d);
  const cells = Math.max(1, Math.round(n / cell));
  const out: PatternEvent[] = [];
  let arpTone = 0;
  for (let i = 0; i < cells; i++) {
    const ch = steps[i % steps.length];
    const t = i * cell;
    if (ch === "X" || ch === "x") {
      out.push({ t, dur: cell, kind: "block", accent: ch === "X" });
    } else if (ch === "a") {
      out.push({ t, dur: cell * 1.6, kind: "arp", tone: arpTone % 4 });
      arpTone++;
    } else if (ch === "r") {
      out.push({ t, dur: cell * 1.6, kind: "arp", tone: 0 });
      arpTone = 1;
    }
  }
  return out;
}

export function patternLabel(id: string, doc: SongDocV2): string {
  return BUILTIN_PATTERNS[id] ?? doc.patterns?.[id]?.name ?? "Block";
}

/** Chord-instrument events for one measure of n/d. */
export function chordPatternEvents(id: string, n: number, d: number, custom?: CustomPattern): PatternEvent[] {
  switch (id) {
    case "off":
      return [];
    case "strum-beats":
      return strumBeats(n, d);
    case "boom-chick":
      return boomChick(n, d);
    case "arp-up":
      return arpPattern(n, d, [0, 1, 2, 3]);
    case "arp-updown":
      return arpPattern(n, d, [0, 1, 2, 3, 2, 1]);
    case "waltz":
      return waltzPattern(n, d);
    default:
      if (custom) return compileCustom(custom.steps, n, d);
      return blockPattern(n);
  }
}

// ---------- bass ----------

export const BASS_PATTERNS: Record<string, string> = {
  root5: "Root + fifth",
  root: "Root notes",
};

export interface BassEvent {
  t: number;
  dur: number;
  tone: 0 | 2; // 0 root, 2 fifth
  accent?: boolean;
}

export function bassPatternEvents(id: string, n: number, d: number): BassEvent[] {
  if (id === "root") {
    return [{ t: 0, dur: n, tone: 0, accent: true }];
  }
  // root5 (default): root on the downbeat, fifth halfway — snapped to the
  // meter's pulse so it lands on a real beat (bar 3 of a waltz, group 2 of 6/8).
  const pulse = pulseOf(n, d);
  const half = Math.round(n / 2 / pulse) * pulse;
  if (half <= 0 || half >= n) {
    return [{ t: 0, dur: n, tone: 0, accent: true }];
  }
  return [
    { t: 0, dur: half, tone: 0, accent: true },
    { t: half, dur: n - half, tone: 2 },
  ];
}
