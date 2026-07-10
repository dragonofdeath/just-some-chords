// v2 song document — stored whole inside the schemaless `sections` OBJECT
// field of the `songs` collection. v1 docs ({list:[{name,repeat,chords}]})
// are migrated on load; saves always write v2.
import type { Chord, ModeId } from "./theory";
import { sanitizeMode } from "./theory";

export interface Placement {
  part: string; // key into SongDocV2.parts — the SAME part may be placed many times
  repeat?: number; // 1–16, per placement
}

export interface Line {
  measures: Measure[];
  repeat?: number; // 1–16, repeats inside the section
  note?: string; // free-text annotation ("palm mute", lyrics cue, …)
  // Sound overrides — resolution order: measure ?? line ?? part ?? song.
  sig?: string;
  pat?: string;
}

export interface Measure {
  slots: (Chord | null)[]; // chord slots; null slot = rest
  // Slot lengths in 16th-note cells (relative weights — robust to a later
  // signature change). Absent = equal division.
  div?: number[];
  sig?: string; // per-measure time signature override
  pat?: string; // per-measure rhythm-pattern override (pattern id)
}

export interface Part {
  name: string;
  lines: Line[];
  note?: string;
  // Sound overrides — see Line.
  sig?: string;
  pat?: string;
}

export interface CustomPattern {
  name: string;
  // One char per grid cell: "." off, "X" accent block, "x" block, "a" arp,
  // "r" root, "-" hold (sustains the previous hit — whole/half notes).
  steps: string;
  res?: number; // grid resolution: 8 (eighths, default) or 16 (sixteenths)
}

export interface Mix {
  chords?: number; // 0–1, default 1
  bass?: number;
  drums?: number;
}

export interface Mute {
  chords?: boolean;
  bass?: boolean;
  drums?: boolean;
}

export interface PlaybackConfig {
  pattern?: string; // chord-instrument pattern id, default "block"
  bass?: boolean;
  bassPattern?: string; // "root5" | "root"
  drums?: string; // "off" | "click" | "rock" | "pop8" | "waltz" | "shuffle"
  countIn?: boolean;
  mix?: Mix;
  // Temporarily silence a track without touching patterns (patterns may
  // carry per-measure overrides that an "off" preset would lose).
  mute?: Mute;
}

export function mixLevel(mix: Mix | undefined, track: keyof Mix): number {
  const v = mix?.[track];
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

export interface SongDocV2 {
  v: 2;
  parts: Record<string, Part>;
  arrangement: Placement[];
  patterns?: Record<string, CustomPattern>;
  playback?: PlaybackConfig;
  note?: string;
  mode?: ModeId; // key mode; absent = major (songKey stays the tonic name)
}

export function cleanNote(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.slice(0, 1000) : undefined;
}

// Position of a measure in the ARRANGEMENT (instance-addressed, not part id):
// ai = arrangement index, li = line index, mi = measure index.
export interface Pos {
  ai: number;
  li: number;
  mi: number;
}

export function clampRepeat(r: unknown): number {
  const n = Math.floor(typeof r === "number" ? r : 1);
  return Number.isFinite(n) ? Math.min(16, Math.max(1, n)) : 1;
}

export function isSongDoc(x: any): x is SongDocV2 {
  return !!x && x.v === 2 && x.parts && Array.isArray(x.arrangement);
}

export function newPartId(doc: SongDocV2): string {
  let i = 1;
  while (doc.parts[`p${i}`]) i++;
  return `p${i}`;
}

export function newPatternId(doc: SongDocV2): string {
  let i = 1;
  while (doc.patterns?.[`c${i}`]) i++;
  return `c${i}`;
}

function sanitizeChord(c: any): Chord | null {
  if (!c || typeof c !== "object") return null;
  if (c.rest === true) return null;
  const idx = typeof c.idx === "number" && c.idx >= 0 && c.idx < 12 ? Math.floor(c.idx) : null;
  if (idx === null) return null;
  const chord: Chord = { idx, quality: c.quality === "min" ? "min" : "maj" };
  if (typeof c.ext === "string" && c.ext) chord.ext = c.ext;
  return chord;
}

function sanitizeMeasure(m: any): Measure {
  const raw = Array.isArray(m?.slots) ? m.slots : [null];
  const slots = raw.slice(0, 8).map(sanitizeChord);
  if (!slots.length) slots.push(null);
  const out: Measure = { slots };
  if (
    Array.isArray(m?.div) &&
    m.div.length === slots.length &&
    slots.length > 1 &&
    m.div.every((v: any) => typeof v === "number" && Number.isFinite(v) && v >= 1)
  ) {
    out.div = m.div.map((v: number) => Math.floor(v));
  }
  if (typeof m?.sig === "string" && m.sig) out.sig = m.sig;
  if (typeof m?.pat === "string" && m.pat) out.pat = m.pat;
  return out;
}

export function emptyDoc(): SongDocV2 {
  return {
    v: 2,
    parts: {
      p1: { name: "Verse", lines: [{ measures: [] }] },
      p2: { name: "Chorus", lines: [{ measures: [] }] },
    },
    arrangement: [{ part: "p1" }, { part: "p2" }],
    playback: { bass: true },
  };
}

/** Normalize anything stored in the `sections` field into a valid SongDocV2. */
export function migrateSong(raw: any): SongDocV2 {
  // Already v2 — sanitize just enough to be safe against hand-edited data.
  if (isSongDoc(raw)) {
    const parts: Record<string, Part> = {};
    for (const [id, p] of Object.entries<any>(raw.parts)) {
      if (!p || typeof p !== "object") continue;
      const lines = (Array.isArray(p.lines) ? p.lines : [])
        .map((l: any) => {
          const line: Line = { measures: (Array.isArray(l?.measures) ? l.measures : []).map(sanitizeMeasure) };
          if (l?.repeat && clampRepeat(l.repeat) > 1) line.repeat = clampRepeat(l.repeat);
          const note = cleanNote(l?.note);
          if (note) line.note = note;
          if (typeof l?.sig === "string" && l.sig) line.sig = l.sig;
          if (typeof l?.pat === "string" && l.pat) line.pat = l.pat;
          return line;
        });
      parts[id] = { name: typeof p.name === "string" ? p.name : "Part", lines: lines.length ? lines : [{ measures: [] }] };
      const pnote = cleanNote(p.note);
      if (pnote) parts[id].note = pnote;
      if (typeof p.sig === "string" && p.sig) parts[id].sig = p.sig;
      if (typeof p.pat === "string" && p.pat) parts[id].pat = p.pat;
    }
    const arrangement = raw.arrangement
      .filter((pl: any) => pl && parts[pl.part])
      .map((pl: any) => {
        const out: Placement = { part: pl.part };
        if (pl.repeat && clampRepeat(pl.repeat) > 1) out.repeat = clampRepeat(pl.repeat);
        return out;
      });
    if (!Object.keys(parts).length || !arrangement.length) return emptyDoc();
    const doc: SongDocV2 = { v: 2, parts, arrangement };
    const mode = sanitizeMode(raw.mode);
    if (mode) doc.mode = mode;
    if (raw.patterns && typeof raw.patterns === "object") {
      const pats: Record<string, CustomPattern> = {};
      for (const [id, p] of Object.entries<any>(raw.patterns)) {
        if (p && typeof p.name === "string" && typeof p.steps === "string" && /^[.Xxar-]{1,32}$/.test(p.steps)) {
          pats[id] = { name: p.name, steps: p.steps, res: p.res === 16 ? 16 : 8 };
        }
      }
      if (Object.keys(pats).length) doc.patterns = pats;
    }
    if (raw.playback && typeof raw.playback === "object") {
      const pb: PlaybackConfig = {};
      if (typeof raw.playback.pattern === "string") pb.pattern = raw.playback.pattern;
      if (typeof raw.playback.bass === "boolean") pb.bass = raw.playback.bass;
      if (typeof raw.playback.bassPattern === "string") pb.bassPattern = raw.playback.bassPattern;
      if (typeof raw.playback.drums === "string") pb.drums = raw.playback.drums;
      if (typeof raw.playback.countIn === "boolean") pb.countIn = raw.playback.countIn;
      if (raw.playback.mix && typeof raw.playback.mix === "object") {
        pb.mix = {
          chords: mixLevel(raw.playback.mix, "chords"),
          bass: mixLevel(raw.playback.mix, "bass"),
          drums: mixLevel(raw.playback.mix, "drums"),
        };
      }
      if (raw.playback.mute && typeof raw.playback.mute === "object") {
        pb.mute = {
          chords: raw.playback.mute.chords === true,
          bass: raw.playback.mute.bass === true,
          drums: raw.playback.mute.drums === true,
        };
      }
      doc.playback = pb;
    }
    const dnote = cleanNote(raw.note);
    if (dnote) doc.note = dnote;
    return doc;
  }

  // v1: {list: [{name, repeat?, chords: [{idx, quality, ext?, sig?}]}]}
  const list = Array.isArray(raw?.list) ? raw.list : [];
  const parts: Record<string, Part> = {};
  const arrangement: Placement[] = [];
  list.forEach((sec: any, i: number) => {
    const id = `p${i + 1}`;
    const measures: Measure[] = (Array.isArray(sec?.chords) ? sec.chords : []).map((c: any) => {
      const m: Measure = { slots: [sanitizeChord(c)] };
      if (typeof c?.sig === "string" && c.sig) m.sig = c.sig; // per-chord sig → per-measure
      return m;
    });
    parts[id] = { name: typeof sec?.name === "string" ? sec.name : `Part ${i + 1}`, lines: [{ measures }] };
    const pl: Placement = { part: id };
    if (sec?.repeat && clampRepeat(sec.repeat) > 1) pl.repeat = clampRepeat(sec.repeat);
    arrangement.push(pl);
  });
  if (!arrangement.length) {
    // v1 songs existed before bass — keep them sounding as before (bass off).
    return { ...emptyDoc(), playback: { bass: false } };
  }
  return { v: 2, parts, arrangement, playback: { bass: false } };
}

// ---------- immutable mutation helpers (editor) ----------

export function partAt(doc: SongDocV2, ai: number): { partId: string; part: Part } | null {
  const partId = doc.arrangement[ai]?.part;
  const part = partId ? doc.parts[partId] : undefined;
  return part ? { partId, part } : null;
}

export function mapPart(doc: SongDocV2, ai: number, fn: (part: Part) => Part): SongDocV2 {
  const at = partAt(doc, ai);
  if (!at) return doc;
  return { ...doc, parts: { ...doc.parts, [at.partId]: fn(at.part) } };
}

export function mapLine(doc: SongDocV2, ai: number, li: number, fn: (line: Line) => Line | null): SongDocV2 {
  return mapPart(doc, ai, (part) => {
    const lines = part.lines
      .map((l, i) => (i === li ? fn(l) : l))
      .filter((l): l is Line => l !== null);
    return { ...part, lines: lines.length ? lines : [{ measures: [] }] };
  });
}

export function mapMeasure(doc: SongDocV2, pos: Pos, fn: (m: Measure) => Measure | null): SongDocV2 {
  return mapLine(doc, pos.ai, pos.li, (line) => ({
    ...line,
    measures: line.measures
      .map((m, i) => (i === pos.mi ? fn(m) : m))
      .filter((m): m is Measure => m !== null),
  }));
}

export function measureAt(doc: SongDocV2, pos: Pos): Measure | null {
  return partAt(doc, pos.ai)?.part.lines[pos.li]?.measures[pos.mi] ?? null;
}

/**
 * Re-split a measure into slots with the given 16th-cell lengths, mapping
 * each new slot to the chord that was sounding at its start position.
 */
export function withDiv(m: Measure, div: number[]): Measure {
  const clean = div.filter((v) => Number.isFinite(v) && v >= 1).slice(0, 8);
  if (!clean.length) return m;
  const total = clean.reduce((s, v) => s + v, 0);
  const oldDiv = m.div && m.div.length === m.slots.length ? m.div : m.slots.map(() => 1);
  const oldTotal = oldDiv.reduce((s, v) => s + v, 0);
  const oldStarts: number[] = [];
  let oacc = 0;
  m.slots.forEach((_, i) => {
    oldStarts.push(oacc / oldTotal);
    oacc += oldDiv[i];
  });
  const slots: (Chord | null)[] = [];
  let pos = 0;
  for (const len of clean) {
    const frac = pos / total;
    let oi = 0;
    for (let i = 0; i < oldStarts.length; i++) {
      if (oldStarts[i] <= frac + 1e-9) oi = i;
    }
    const src = m.slots[oi];
    slots.push(src ? { ...src } : null);
    pos += len;
  }
  if (clean.length === 1) {
    const { div: _drop, ...rest } = m;
    return { ...rest, slots };
  }
  return { ...m, slots, div: clean };
}

/**
 * Move measures [a..b] of one line to `index` in another (or the same) line.
 * Instance-addressed, but resolved through part ids so two placements of a
 * shared part count as the same underlying line.
 */
export function moveMeasures(
  doc: SongDocV2,
  from: { ai: number; li: number; a: number; b: number },
  to: { ai: number; li: number; index: number }
): SongDocV2 {
  const src = partAt(doc, from.ai);
  const dst = partAt(doc, to.ai);
  if (!src || !dst) return doc;
  const moving = src.part.lines[from.li]?.measures.slice(from.a, from.b + 1) ?? [];
  if (!moving.length || !dst.part.lines[to.li]) return doc;
  const count = moving.length;

  let idx = Math.max(0, Math.floor(to.index));
  const sameLine = src.partId === dst.partId && from.li === to.li;
  if (sameLine) {
    if (idx > from.b) idx -= count;
    else if (idx >= from.a) idx = from.a; // dropped inside the moved range
  }

  let out = mapLine(doc, from.ai, from.li, (l) => ({
    ...l,
    measures: l.measures.filter((_, i) => i < from.a || i > from.b),
  }));
  out = mapLine(out, to.ai, to.li, (l) => {
    const measures = [...l.measures];
    measures.splice(Math.min(idx, measures.length), 0, ...moving);
    return { ...l, measures };
  });
  return out;
}

/** Shift every chord by `delta` circle-of-fifths positions (transpose). */
export function transposeDoc(doc: SongDocV2, delta: number): SongDocV2 {
  const shift = (c: Chord | null): Chord | null =>
    c ? { ...c, idx: ((c.idx + delta) % 12 + 12) % 12 } : null;
  return {
    ...doc,
    parts: Object.fromEntries(
      Object.entries(doc.parts).map(([id, p]) => [
        id,
        {
          ...p,
          lines: p.lines.map((l) => ({
            ...l,
            measures: l.measures.map((m) => ({ ...m, slots: m.slots.map(shift) })),
          })),
        },
      ])
    ),
  };
}

/** Delete a custom pattern and clear every reference to it. */
export function removeCustomPattern(doc: SongDocV2, id: string): SongDocV2 {
  const patterns = Object.fromEntries(Object.entries(doc.patterns ?? {}).filter(([k]) => k !== id));
  const parts = Object.fromEntries(
    Object.entries(doc.parts).map(([pid, p]) => [
      pid,
      {
        ...p,
        pat: p.pat === id ? undefined : p.pat,
        lines: p.lines.map((l) => ({
          ...l,
          pat: l.pat === id ? undefined : l.pat,
          measures: l.measures.map((m) => (m.pat === id ? { ...m, pat: undefined } : m)),
        })),
      },
    ])
  );
  const playback = doc.playback?.pattern === id ? { ...doc.playback, pattern: undefined } : doc.playback;
  return { ...doc, patterns: Object.keys(patterns).length ? patterns : undefined, parts, playback };
}

// ---------- counters (list page, sheets) ----------

export function countSections(doc: SongDocV2): number {
  return doc.arrangement.length;
}

export function countMeasures(doc: SongDocV2): number {
  return doc.arrangement.reduce((sum, pl) => {
    const part = doc.parts[pl.part];
    if (!part) return sum;
    return sum + part.lines.reduce((s, l) => s + l.measures.length, 0);
  }, 0);
}

export function partMeasureCount(part: Part): number {
  return part.lines.reduce((s, l) => s + l.measures.length, 0);
}

/** How many placements reference this part. */
export function placementCount(doc: SongDocV2, partId: string): number {
  return doc.arrangement.filter((pl) => pl.part === partId).length;
}
