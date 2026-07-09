// v2 song document — stored whole inside the schemaless `sections` OBJECT
// field of the `songs` collection. v1 docs ({list:[{name,repeat,chords}]})
// are migrated on load; saves always write v2.
import type { Chord } from "./theory";

export interface Placement {
  part: string; // key into SongDocV2.parts — the SAME part may be placed many times
  repeat?: number; // 1–16, per placement
}

export interface Line {
  measures: Measure[];
  repeat?: number; // 1–16, repeats inside the section
}

export interface Measure {
  slots: (Chord | null)[]; // 1–4 equal divisions; null slot = rest
  sig?: string; // per-measure time signature override
  pat?: string; // per-measure rhythm-pattern override (pattern id)
}

export interface Part {
  name: string;
  lines: Line[];
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

export interface PlaybackConfig {
  pattern?: string; // chord-instrument pattern id, default "block"
  bass?: boolean;
  bassPattern?: string; // "root5" | "root"
  drums?: string; // "off" | "click" | "rock" | "pop8" | "waltz" | "shuffle"
  countIn?: boolean;
  mix?: Mix;
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
  const slots = raw.slice(0, 4).map(sanitizeChord);
  if (!slots.length) slots.push(null);
  const out: Measure = { slots };
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
          return line;
        });
      parts[id] = { name: typeof p.name === "string" ? p.name : "Part", lines: lines.length ? lines : [{ measures: [] }] };
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
      doc.playback = pb;
    }
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

/** Resize a measure's slot count (1–4); growing repeats the last chord. */
export function withSlotCount(m: Measure, count: number): Measure {
  const k = Math.min(4, Math.max(1, Math.floor(count)));
  const slots = m.slots.slice(0, k);
  const fill = [...m.slots].reverse().find((s) => s !== null) ?? null;
  while (slots.length < k) slots.push(fill ? { ...fill } : null);
  return { ...m, slots };
}

/** Delete a custom pattern and clear every reference to it. */
export function removeCustomPattern(doc: SongDocV2, id: string): SongDocV2 {
  const patterns = Object.fromEntries(Object.entries(doc.patterns ?? {}).filter(([k]) => k !== id));
  const parts = Object.fromEntries(
    Object.entries(doc.parts).map(([pid, p]) => [
      pid,
      {
        ...p,
        lines: p.lines.map((l) => ({
          ...l,
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
