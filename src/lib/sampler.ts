// Sample-based instrument playback. Samples: tonejs-instruments (CC-BY 3.0,
// https://github.com/nbrosowsky/tonejs-instruments), vendored under /public/samples.
// Every 3 semitones — playback-rate shifting to the nearest sample stays ≤ ~2 st.

export type Instrument = "piano" | "guitar" | "synth";

export const INSTRUMENTS: Instrument[] = ["piano", "guitar", "synth"];

export function instrumentLabel(i: Instrument): string {
  return i === "piano" ? "Piano" : i === "guitar" ? "Guitar" : "Synth";
}

const NOTE_VALUES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(name: string): number {
  // "Ds3" → D(2) + s(1), octave 3 → (3+1)*12 + 3 = 51
  const letter = name[0];
  const sharp = name[1] === "s" ? 1 : 0;
  const octave = parseInt(name.slice(1 + sharp), 10);
  return (octave + 1) * 12 + NOTE_VALUES[letter] + sharp;
}

const SAMPLE_MAPS: Record<Exclude<Instrument, "synth">, string[]> = {
  piano: ["C3", "Ds3", "Fs3", "A3", "C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5", "A5", "C6"],
  guitar: ["D2", "F2", "Gs2", "B2", "D3", "F3", "Gs3", "B3", "D4", "F4", "Gs4", "B4", "Cs5"],
};

interface Bank {
  fetches: Map<number, Promise<ArrayBuffer>>; // midi → raw bytes
  buffers: Map<number, AudioBuffer>; // midi → decoded
  ready: boolean;
  decoding: Promise<void> | null;
}

const banks: Partial<Record<Exclude<Instrument, "synth">, Bank>> = {};

function bankFor(inst: Exclude<Instrument, "synth">): Bank {
  let b = banks[inst];
  if (!b) {
    b = { fetches: new Map(), buffers: new Map(), ready: false, decoding: null };
    banks[inst] = b;
  }
  return b;
}

/** Start downloading sample bytes (no AudioContext needed). Safe to call repeatedly. */
export function preload(inst: Instrument): void {
  if (inst === "synth") return;
  const b = bankFor(inst);
  for (const name of SAMPLE_MAPS[inst]) {
    const midi = noteToMidi(name);
    if (!b.fetches.has(midi)) {
      b.fetches.set(
        midi,
        fetch(`/samples/${inst}/${name}.mp3`).then((r) => {
          if (!r.ok) throw new Error(`sample ${name}`);
          return r.arrayBuffer();
        })
      );
    }
  }
}

/** Decode all samples for the instrument. Resolves when playable; rejects never (falls back). */
export function ensureLoaded(ctx: AudioContext, inst: Instrument): Promise<void> {
  if (inst === "synth") return Promise.resolve();
  const b = bankFor(inst);
  if (b.ready) return Promise.resolve();
  if (b.decoding) return b.decoding;
  preload(inst);
  b.decoding = Promise.all(
    Array.from(b.fetches.entries()).map(async ([midi, p]) => {
      if (b.buffers.has(midi)) return;
      try {
        const bytes = await p;
        const buf = await ctx.decodeAudioData(bytes.slice(0));
        b.buffers.set(midi, buf);
      } catch {
        // one missing sample is fine — neighbors cover it
      }
    })
  ).then(() => {
    b.ready = b.buffers.size > 0;
    b.decoding = null;
  });
  return b.decoding;
}

export function isReady(inst: Instrument): boolean {
  return inst === "synth" || !!banks[inst as Exclude<Instrument, "synth">]?.ready;
}

/** Play one note (midi) at ctx-relative offset t. */
export function playSampleNote(
  ctx: AudioContext,
  inst: Exclude<Instrument, "synth">,
  midi: number,
  t: number,
  dur: number,
  gain: number,
  dest?: AudioNode
): void {
  const b = bankFor(inst);
  if (!b.buffers.size) return;
  let bestMidi = -1;
  let bestDist = Infinity;
  for (const m of b.buffers.keys()) {
    const d = Math.abs(m - midi);
    if (d < bestDist) {
      bestDist = d;
      bestMidi = m;
    }
  }
  const buf = b.buffers.get(bestMidi);
  if (!buf) return;
  const now = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.pow(2, (midi - bestMidi) / 12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.005);
  g.gain.setValueAtTime(gain, now + Math.max(0.005, dur - 0.12));
  g.gain.linearRampToValueAtTime(0.0001, now + dur);
  src.connect(g);
  g.connect(dest ?? ctx.destination);
  src.start(now);
  src.stop(now + dur + 0.05);
}
