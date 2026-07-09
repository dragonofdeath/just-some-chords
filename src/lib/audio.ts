import { ensureLoaded, isReady, playSampleNote, type Instrument } from "./sampler";

let audioCtx: AudioContext | null = null;

export function ensureCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

export function currentCtx(): AudioContext | null {
  return audioCtx;
}

function playSynthChordAt(semis: number[], t: number, dur: number, dest?: AudioNode) {
  const ctx = ensureCtx();
  const now = ctx.currentTime + t;
  semis.forEach((s, i) => {
    const f = 261.6256 * Math.pow(2, s / 12);
    const o = ctx.createOscillator();
    o.type = i === 0 ? "sine" : "triangle";
    o.frequency.value = f;
    const g = ctx.createGain();
    const peak = i === 0 ? 0.15 : 0.08;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g);
    g.connect(dest ?? ctx.destination);
    o.start(now);
    o.stop(now + dur + 0.05);
  });
}

// Instrument-aware chord playback. Falls back to the synth until samples decode.
export function playChordAt(semis: number[], t: number, dur: number, inst: Instrument, dest?: AudioNode) {
  const ctx = ensureCtx();
  if (inst === "synth" || !isReady(inst)) {
    if (inst !== "synth") ensureLoaded(ctx, inst); // warm up for next time
    playSynthChordAt(semis, t, dur, dest);
    return;
  }
  // Guitar sits an octave lower and strums; piano rolls just slightly.
  const octave = inst === "guitar" ? -12 : 0;
  const strum = inst === "guitar" ? 0.028 : 0.006;
  const ring = inst === "guitar" ? 1.05 : 1.0;
  semis.forEach((s, i) => {
    const midi = 60 + s + octave;
    const gain = i === 0 ? 0.5 : 0.34;
    playSampleNote(ctx, inst, midi, t + i * strum, dur * ring, gain, dest);
  });
}

export function clickAt(t: number, accent: boolean, dest?: AudioNode) {
  const ctx = ensureCtx();
  const now = ctx.currentTime + t;
  const o = ctx.createOscillator();
  o.type = "square";
  o.frequency.value = accent ? 1800 : 1200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(accent ? 0.11 : 0.06, now + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
  o.connect(g);
  g.connect(dest ?? ctx.destination);
  o.start(now);
  o.stop(now + 0.08);
}

/** Silence and detach a play-run bus (kills everything scheduled on it). */
export function killBus(bus: GainNode | null): void {
  if (!bus || !audioCtx) return;
  bus.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.02);
  setTimeout(() => bus.disconnect(), 250);
}
