// Synthesized drum kit (no samples) + per-meter presets.
// Hit times are in DENOMINATOR BEATS from measure start, like patterns.ts.

export type DrumVoice = "kick" | "snare" | "hat";

export interface DrumEvent {
  t: number;
  voice: DrumVoice;
  accent?: boolean;
}

export const DRUM_PRESETS: Record<string, string> = {
  off: "Off",
  click: "Click",
  rock: "Rock",
  pop8: "Pop 8ths",
  waltz: "Waltz",
  shuffle: "Shuffle",
};

const isCompound = (n: number, d: number) => d === 8 && n % 3 === 0;
const eighthOf = (d: number) => (d === 8 ? 1 : d === 4 ? 0.5 : 0.25);

/** Drum hits for one measure of n/d. "click" is handled by the caller (clickAt). */
export function drumPatternEvents(preset: string, n: number, d: number): DrumEvent[] {
  const out: DrumEvent[] = [];
  const compound = isCompound(n, d);
  const pulse = compound ? 3 : 1;
  const eighth = eighthOf(d);

  if (preset === "rock" || preset === "pop8") {
    for (let t = 0; t < n - 1e-6; t += eighth) out.push({ t, voice: "hat", accent: t % pulse === 0 });
    let beatIdx = 0;
    for (let t = 0; t < n; t += pulse) {
      const backbeat = beatIdx % 2 === 1;
      if (backbeat) {
        out.push({ t, voice: "snare", accent: true });
      } else {
        out.push({ t, voice: "kick", accent: beatIdx === 0 });
        if (preset === "pop8" && t + pulse / 2 < n) {
          out.push({ t: t + pulse / 2, voice: "kick" }); // the "and" push
        }
      }
      beatIdx++;
    }
    return out;
  }

  if (preset === "waltz") {
    for (let t = 0; t < n; t += pulse) {
      if (t === 0) out.push({ t, voice: "kick", accent: true });
      else {
        out.push({ t, voice: "hat", accent: false });
        out.push({ t, voice: "snare" });
      }
    }
    return out;
  }

  if (preset === "shuffle") {
    let beatIdx = 0;
    for (let t = 0; t < n; t += pulse) {
      out.push({ t, voice: "hat", accent: true });
      out.push({ t: t + pulse * 0.66, voice: "hat" }); // swung offbeat
      if (beatIdx % 2 === 1) out.push({ t, voice: "snare" });
      else out.push({ t, voice: "kick", accent: beatIdx === 0 });
      beatIdx++;
    }
    return out;
  }

  return out; // "off"/"click"/unknown → no kit hits
}

// ---------- synthesis ----------

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.25);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** Schedule one drum hit at ctx-relative offset t onto dest. */
export function playDrum(ctx: AudioContext, voice: DrumVoice, t: number, accent: boolean, dest: AudioNode, scale = 1): void {
  if (scale <= 0.001) return;
  const now = ctx.currentTime + Math.max(0, t);
  if (voice === "kick") {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, now);
    o.frequency.exponentialRampToValueAtTime(50, now + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime((accent ? 0.55 : 0.42) * scale, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    o.connect(g);
    g.connect(dest);
    o.start(now);
    o.stop(now + 0.16);
    return;
  }
  if (voice === "snare") {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime((accent ? 0.38 : 0.28) * scale, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(now);
    src.stop(now + 0.16);
    // body
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 180;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.16 * scale, now);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    o.connect(g2);
    g2.connect(dest);
    o.start(now);
    o.stop(now + 0.08);
    return;
  }
  // hat
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime((accent ? 0.16 : 0.09) * scale, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  src.connect(hp);
  hp.connect(g);
  g.connect(dest);
  src.start(now);
  src.stop(now + 0.05);
}
