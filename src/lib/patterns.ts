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
  skank: "Offbeat (skank)",
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

// Ska/reggae upstrokes: clipped chord stabs on every offbeat eighth ("&"s).
// The short duration is what makes it read as a muted upstroke.
function skankPattern(n: number, d: number): PatternEvent[] {
  const e = eighthOf(d);
  const out: PatternEvent[] = [];
  let i = 0;
  for (let t = 0; t < n - 1e-6; t += e) {
    if (i % 2 === 1) out.push({ t, dur: e * 0.45, kind: "block" });
    i++;
  }
  return out;
}

function compileCustom(steps: string, n: number, d: number, res = 8): PatternEvent[] {
  const cell = eighthOf(d) * (8 / (res === 16 ? 16 : 8));
  const cells = Math.max(1, Math.round(n / cell));
  const out: PatternEvent[] = [];
  let arpTone = 0;
  let i = 0;
  while (i < cells) {
    const ch = steps[i % steps.length];
    if (ch === "X" || ch === "x" || ch === "a" || ch === "r") {
      // trailing "-" cells sustain the hit (half/whole notes)
      let span = 1;
      while (i + span < cells && steps[(i + span) % steps.length] === "-") span++;
      const t = i * cell;
      const dur = span * cell;
      if (ch === "X" || ch === "x") {
        out.push({ t, dur, kind: "block", accent: ch === "X" });
      } else if (ch === "a") {
        out.push({ t, dur, kind: "arp", tone: arpTone % 4 });
        arpTone++;
      } else {
        out.push({ t, dur, kind: "arp", tone: 0 });
        arpTone = 1;
      }
      i += span;
    } else {
      i++;
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
    case "skank":
      return skankPattern(n, d);
    default:
      if (custom) return compileCustom(custom.steps, n, d, custom.res);
      return blockPattern(n);
  }
}

// ---------- bass ----------

export const BASS_PATTERNS: Record<string, string> = {
  root: "Root notes",
  root5: "Root + fifth",
  oct: "Root + octave",
  walk: "Walking",
  pump: "Pumping 8ths",
};

export interface BassEvent {
  t: number;
  dur: number;
  tone: 0 | 1 | 2 | 3; // chord tones: root, third, fifth, octave
  accent?: boolean;
}

export function bassPatternEvents(id: string, n: number, d: number): BassEvent[] {
  const pulse = pulseOf(n, d);

  if (id === "root") {
    return [{ t: 0, dur: n, tone: 0, accent: true }];
  }
  if (id === "walk") {
    // one chord tone per pulse, climbing root → third → fifth → octave
    const cycle: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];
    const out: BassEvent[] = [];
    for (let k = 0; k * pulse < n; k++) {
      out.push({ t: k * pulse, dur: Math.min(pulse, n - k * pulse), tone: cycle[k % 4], accent: k === 0 });
    }
    return out;
  }
  if (id === "pump") {
    // driving straight 8ths on the root
    const step = d === 8 ? 1 : 0.5;
    const out: BassEvent[] = [];
    for (let k = 0; k * step < n - 1e-6; k++) {
      out.push({ t: k * step, dur: step, tone: 0, accent: k === 0 });
    }
    return out;
  }
  // root5 / oct: root on the downbeat, fifth (or octave) halfway — snapped to
  // the meter's pulse so it lands on a real beat (bar 3 of a waltz, group 2 of 6/8).
  const alt: 2 | 3 = id === "oct" ? 3 : 2;
  const half = Math.round(n / 2 / pulse) * pulse;
  if (half <= 0 || half >= n) {
    return [{ t: 0, dur: n, tone: 0, accent: true }];
  }
  return [
    { t: 0, dur: half, tone: 0, accent: true },
    { t: half, dur: n - half, tone: alt },
  ];
}
