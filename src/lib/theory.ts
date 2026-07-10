// Circle of fifths, majors in order; s = pitch-class semitone of the major root.
export interface FifthsEntry {
  maj: string;
  min: string;
  s: number;
}

export const FIFTHS: FifthsEntry[] = [
  { maj: "C", min: "Am", s: 0 },
  { maj: "G", min: "Em", s: 7 },
  { maj: "D", min: "Bm", s: 2 },
  { maj: "A", min: "F♯m", s: 9 },
  { maj: "E", min: "C♯m", s: 4 },
  { maj: "B", min: "G♯m", s: 11 },
  { maj: "F♯", min: "D♯m", s: 6 },
  { maj: "D♭", min: "B♭m", s: 1 },
  { maj: "A♭", min: "Fm", s: 8 },
  { maj: "E♭", min: "Cm", s: 3 },
  { maj: "B♭", min: "Gm", s: 10 },
  { maj: "F", min: "Dm", s: 5 },
];

export type ChordQuality = "maj" | "min";

export interface Chord {
  idx: number; // position on the circle of fifths (0..11)
  quality: ChordQuality;
  ext?: string; // one of EXTENSIONS; "" / undefined = plain triad
}

export const TIME_SIGNATURES = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8"] as const;

export function parseSig(sig: string | undefined): { n: number; d: number } {
  const m = /^(\d{1,2})\/(2|4|8|16)$/.exec(sig ?? "");
  if (!m) return { n: 4, d: 4 };
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 16 ? { n, d: parseInt(m[2], 10) } : { n: 4, d: 4 };
}

// BPM is always the quarter-note tempo; the denominator note scales off it.
export function beatSeconds(sig: string | undefined, bpm: number): number {
  const { d } = parseSig(sig);
  return (60 / bpm) * (4 / d);
}

export function barSeconds(sig: string | undefined, bpm: number): number {
  const { n } = parseSig(sig);
  return n * beatSeconds(sig, bpm);
}

// Chord modifications. "" = plain triad. The quick strip shows EXTENSIONS;
// the full catalog (jazz & friends) lives in EXTENSION_GROUPS behind "…".
export const EXTENSIONS = ["", "7", "maj7", "6", "9", "add9", "sus2", "sus4", "dim"] as const;

// Everything, grouped for the "more chords" sheet. Data stays ASCII
// ("7b5"); extLabel prettifies for display. Minor quality composes for
// free where it makes sense: min+"7b5" = m7♭5 (half-diminished),
// min+"9" = m9, min+"maj7" = mMaj7.
export const EXTENSION_GROUPS: { name: string; exts: string[] }[] = [
  { name: "Triads & power", exts: ["", "dim", "aug", "5"] },
  { name: "Sevenths", exts: ["7", "maj7", "dim7", "7sus4"] },
  { name: "Sixths & ninths", exts: ["6", "6/9", "add9", "9", "maj9"] },
  { name: "Extended", exts: ["11", "13"] },
  { name: "Altered", exts: ["7b5", "7#5", "7b9", "7#9"] },
  { name: "Suspended", exts: ["sus2", "sus4"] },
];

const PRETTY: Record<string, string> = {
  "7b5": "7♭5",
  "7#5": "7♯5",
  "7b9": "7♭9",
  "7#9": "7♯9",
};

export function extLabel(ext: string): string {
  if (ext === "") return "triad";
  return PRETTY[ext] ?? ext;
}

// Extensions that define the whole chord shape — the maj/min quality is
// ignored, so the label drops it (C5, Caug, Cdim7, C7sus4, C7♯9 …).
const QUALITY_AGNOSTIC = new Set(["dim", "aug", "5", "dim7", "sus2", "sus4", "7sus4", "7#5", "7#9"]);


const ROMAN_MAJ: Record<number, string> = { 0: "I", 1: "V", 11: "IV" };
const ROMAN_MIN: Record<number, string> = { 0: "vi", 1: "iii", 11: "ii" };

export function chordLabel(c: Chord): string {
  const e = FIFTHS[c.idx];
  const base = c.quality === "min" ? e.min : e.maj;
  const root = c.quality === "min" ? e.min.slice(0, -1) : e.maj;
  const ext = c.ext ?? "";
  if (!ext) return base;
  if (QUALITY_AGNOSTIC.has(ext)) return root + extLabel(ext); // C5, Caug, Cdim7, Csus4 …
  if (c.quality === "min" && ext === "maj7") return base + "(maj7)";
  return base + extLabel(ext); // G7, Am7, G6/9, G7♭9, Gm7♭5 …
}

// One shape per extension: overrides for the third/fifth slots plus extra
// tones (semitones above the root). Third defaults to the maj/min quality.
const SHAPES: Record<string, { third?: number; fifth?: number; extra: number[] }> = {
  "7": { extra: [10] },
  maj7: { extra: [11] },
  "6": { extra: [9] },
  "9": { extra: [10, 14] },
  add9: { extra: [14] },
  sus2: { third: 2, extra: [] },
  sus4: { third: 5, extra: [] },
  dim: { third: 3, fifth: 6, extra: [] },
  aug: { third: 4, fifth: 8, extra: [] }, // major third by definition
  dim7: { third: 3, fifth: 6, extra: [9] },
  "7sus4": { third: 5, extra: [10] },
  "6/9": { extra: [9, 14] },
  maj9: { extra: [11, 14] },
  "11": { extra: [10, 14, 17] },
  "13": { extra: [10, 14, 21] },
  "7b5": { fifth: 6, extra: [10] },
  "7#5": { third: 4, fifth: 8, extra: [10] },
  "7b9": { extra: [10, 13] },
  "7#9": { third: 4, extra: [10, 15] },
};

// Chord tones as semitone offsets from C4: [root, third, fifth, top]
// (top = highest extension tone when present, else the octave). Arpeggios.
export function chordToneSemis(c: Chord): number[] {
  const pc = chordPitchClass(c);
  const ext = c.ext ?? "";
  if (ext === "5") return [pc, pc + 7, pc + 12, pc + 19]; // power chord: no third
  const sh = SHAPES[ext] ?? { extra: [] };
  const third = sh.third ?? (c.quality === "min" ? 3 : 4);
  const fifth = sh.fifth ?? 7;
  const top = sh.extra.length ? sh.extra[sh.extra.length - 1] : 12;
  return [pc, pc + third, pc + fifth, pc + top];
}

// Bass register: root voiced into E1..D#2 (midi 28–39); fifth sits above it
// (honoring altered fifths — dim, aug, 7♭5 …).
export function bassMidi(c: Chord, tone: 0 | 2): number {
  const pc = chordPitchClass(c);
  const root = 28 + ((pc - 4 + 12) % 12);
  const fifth = SHAPES[c.ext ?? ""]?.fifth ?? 7;
  return tone === 2 ? root + fifth : root;
}

// Semitone offsets from C4 for the full voicing (bass + chord tones).
export function chordSemis(c: Chord): number[] {
  const pc = chordPitchClass(c);
  const ext = c.ext ?? "";
  if (ext === "5") return [pc - 12, pc, pc + 7, pc + 12]; // power chord: no third
  const sh = SHAPES[ext] ?? { extra: [] };
  const third = sh.third ?? (c.quality === "min" ? 3 : 4);
  const fifth = sh.fifth ?? 7;
  return [pc - 12, pc, pc + third, pc + fifth, ...sh.extra.map((x) => pc + x)];
}

export function chordRoman(c: Chord, keyIdx: number): string {
  const diff = ((c.idx - keyIdx) % 12 + 12) % 12;
  return c.quality === "min" ? ROMAN_MIN[diff] ?? "·" : ROMAN_MAJ[diff] ?? "·";
}

export function chordPitchClass(c: Chord): number {
  const e = FIFTHS[c.idx];
  return c.quality === "min" ? (e.s + 9) % 12 : e.s;
}

export function keyIdxFromName(name: string): number {
  const i = FIFTHS.findIndex((e) => e.maj === name);
  return i === -1 ? 1 : i; // default G
}

export function isInKey(idx: number, keyIdx: number): boolean {
  const rel = ((idx - keyIdx) % 12 + 12) % 12;
  return rel === 0 || rel === 1 || rel === 11;
}

export const SECTION_NAMES = [
  "Verse",
  "Chorus",
  "Intro",
  "Pre-Chorus",
  "Bridge",
  "Outro",
];

