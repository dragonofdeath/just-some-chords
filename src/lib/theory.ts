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

// Chord modifications. "" = plain triad.
export const EXTENSIONS = ["", "7", "maj7", "6", "9", "add9", "sus2", "sus4", "dim"] as const;

export function extLabel(ext: string): string {
  return ext === "" ? "triad" : ext;
}

export interface Section {
  name: string;
  chords: Chord[];
  repeat?: number; // musical repeat: play this part n times (default 1)
}

export function sectionRepeat(s: Section): number {
  const r = Math.floor(s.repeat ?? 1);
  return Math.min(16, Math.max(1, Number.isFinite(r) ? r : 1));
}

export interface SongData {
  title: string;
  songKey: string; // major key name, e.g. "G"
  bpm: number;
  timeSignature: string;
  sections: { list: Section[] };
}

const ROMAN_MAJ: Record<number, string> = { 0: "I", 1: "V", 11: "IV" };
const ROMAN_MIN: Record<number, string> = { 0: "vi", 1: "iii", 11: "ii" };

export function chordLabel(c: Chord): string {
  const e = FIFTHS[c.idx];
  const base = c.quality === "min" ? e.min : e.maj;
  const root = c.quality === "min" ? e.min.slice(0, -1) : e.maj;
  const ext = c.ext ?? "";
  if (!ext) return base;
  if (ext === "dim") return root + "dim";
  if (ext === "sus2" || ext === "sus4") return root + ext; // sus replaces the third
  if (c.quality === "min" && ext === "maj7") return base + "(maj7)";
  return base + ext; // G7, Gmaj7, Am7, G6, Gadd9, G9 …
}

// Semitone offsets from C4 for the full voicing (bass + chord tones).
export function chordSemis(c: Chord): number[] {
  const pc = chordPitchClass(c);
  const ext = c.ext ?? "";
  let third = c.quality === "min" ? 3 : 4;
  let fifth = 7;
  const extra: number[] = [];
  switch (ext) {
    case "7": extra.push(10); break;
    case "maj7": extra.push(11); break;
    case "6": extra.push(9); break;
    case "9": extra.push(10, 14); break;
    case "add9": extra.push(14); break;
    case "sus2": third = 2; break;
    case "sus4": third = 5; break;
    case "dim": third = 3; fifth = 6; break;
  }
  return [pc - 12, pc, pc + third, pc + fifth, ...extra.map((x) => pc + x)];
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

export function emptySong(): SongData {
  return {
    title: "Untitled",
    songKey: "G",
    bpm: 84,
    timeSignature: "4/4",
    sections: { list: [{ name: "Verse", chords: [] }, { name: "Chorus", chords: [] }] },
  };
}
