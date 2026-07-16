// The metronome engine — a small drum machine under a classic metronome face.
// Schedules one bar at a time on the Web Audio clock (a 100ms pump keeps ~0.3s
// scheduled ahead), so sound/gap/volume changes apply from the next bar without
// a restart; the UI restarts the engine for bpm/sig changes.
import { clickAt, ensureCtx, killBus } from "./audio";
import { drumPatternEvents, playDrum, type DrumVoice } from "./drums";
import { beatSeconds, parseSig, TIME_SIGNATURES } from "./theory";

export const MET_SOUNDS: Record<string, string> = {
  click: "Click",
  rock: "Rock",
  pop8: "Pop 8ths",
  waltz: "Waltz",
  shuffle: "Shuffle",
  custom: "My groove",
};

// Click subdivision: 1 = the beat only, 2 = & (8ths), 3 = triplets, 4 = 16ths.
export type Subdivision = 1 | 2 | 3 | 4;

export interface DrumGrid {
  res: 8 | 16; // grid resolution in note values (cells per whole note)
  kick: string; // one char per cell: "." off, "x" hit, "X" accent
  snare: string;
  hat: string;
}

export interface MetSettings {
  bpm: number;
  sig: string;
  sound: string; // key of MET_SOUNDS
  sub: Subdivision; // click sound only
  gapOn: boolean; // gap training: bars of sound, then bars of silence
  gapPlay: number; // 1-8
  gapMute: number; // 1-8
  volume: number; // 0-1
  grid: DrumGrid;
}

/** Cells in one bar of `sig` at grid resolution `res`. */
export function gridCells(sig: string, res: 8 | 16): number {
  const { n, d } = parseSig(sig);
  return n * (d === 8 ? res / 8 : res / 4);
}

/** Default groove for a signature: hats on every cell, kick/snare alternating beats. */
export function defaultGrid(sig: string, res: 8 | 16 = 8): DrumGrid {
  const { n, d } = parseSig(sig);
  const cells = gridCells(sig, res);
  const perBeat = cells / n;
  const compound = d === 8 && n % 3 === 0;
  const pulse = compound ? 3 : 1; // felt beats are dotted in compound meters
  let kick = "";
  let snare = "";
  let hat = "";
  for (let i = 0; i < cells; i++) {
    const beat = Math.floor(i / perBeat);
    const onBeat = i % perBeat === 0 && beat % pulse === 0;
    const beatIdx = beat / pulse;
    kick += onBeat && beatIdx % 2 === 0 ? (beat === 0 ? "X" : "x") : ".";
    snare += onBeat && beatIdx % 2 === 1 ? "x" : ".";
    hat += "x";
  }
  return { res, kick, snare, hat };
}

/** Fit a grid's rows to a (possibly new) signature — tile or truncate. */
export function adaptGrid(grid: DrumGrid, sig: string): DrumGrid {
  const cells = gridCells(sig, grid.res);
  const fit = (row: string) => {
    if (row.length === cells) return row;
    let out = "";
    for (let i = 0; i < cells; i++) out += row[i % Math.max(1, row.length)] ?? ".";
    return out;
  };
  return { res: grid.res, kick: fit(grid.kick), snare: fit(grid.snare), hat: fit(grid.hat) };
}

const STORE_KEY = "jsc-metronome";

export function defaultSettings(): MetSettings {
  return {
    bpm: 100,
    sig: "4/4",
    sound: "click",
    sub: 1,
    gapOn: false,
    gapPlay: 1,
    gapMute: 1,
    volume: 1,
    grid: defaultGrid("4/4"),
  };
}

const cleanRow = (raw: unknown, fallback: string) =>
  typeof raw === "string" && /^[.xX]+$/.test(raw) ? raw : fallback;

export function loadSettings(): MetSettings {
  const def = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "");
    const sig = (TIME_SIGNATURES as readonly string[]).includes(raw.sig) ? raw.sig : def.sig;
    const res = raw.grid?.res === 16 ? 16 : 8;
    const base = defaultGrid(sig, res);
    return {
      bpm: Number.isFinite(raw.bpm) ? Math.min(220, Math.max(40, Math.round(raw.bpm))) : def.bpm,
      sig,
      sound: raw.sound in MET_SOUNDS ? raw.sound : def.sound,
      sub: [1, 2, 3, 4].includes(raw.sub) ? raw.sub : 1,
      gapOn: raw.gapOn === true,
      gapPlay: [1, 2, 3, 4, 5, 6, 7, 8].includes(raw.gapPlay) ? raw.gapPlay : 1,
      gapMute: [1, 2, 3, 4, 5, 6, 7, 8].includes(raw.gapMute) ? raw.gapMute : 1,
      volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 1,
      grid: adaptGrid(
        { res, kick: cleanRow(raw.grid?.kick, base.kick), snare: cleanRow(raw.grid?.snare, base.snare), hat: cleanRow(raw.grid?.hat, base.hat) },
        sig
      ),
    };
  } catch {
    return def;
  }
}

export function saveSettings(s: MetSettings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // private mode — the metronome still runs, settings just don't stick
  }
}

export interface TickInfo {
  bar: number; // absolute bar count since start
  beat: number; // 0-based denominator beat within the bar
  beats: number; // beats in this bar
  silent: boolean; // gap trainer: this bar is a silent one
  gapPos: number; // 0-based bar position inside the play+mute cycle
  gapLen: number; // cycle length in bars (0 = gap off)
}

/**
 * Start the metronome. Reads settings fresh every bar (sound, gap, volume
 * apply live); restart it for bpm/sig changes. Returns the stop function.
 */
export function startMetronome(opts: {
  getSettings: () => MetSettings;
  onTick: (t: TickInfo) => void;
  startBar?: number;
}): () => void {
  const ctx = ensureCtx();
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  let stopped = false;
  let bar = opts.startBar ?? 0;
  let barT = ctx.currentTime + 0.12; // absolute start time of the next unscheduled bar
  const timers: ReturnType<typeof setTimeout>[] = [];

  const scheduleBar = () => {
    const s = opts.getSettings();
    const { n, d } = parseSig(s.sig);
    const beatDur = beatSeconds(s.sig, s.bpm);
    bus.gain.value = s.volume;
    const cycle = s.gapOn ? s.gapPlay + s.gapMute : 0;
    const silent = cycle > 0 && bar % cycle >= s.gapPlay;
    const t0 = barT;
    const rel = (t: number) => t0 + t - ctx.currentTime; // engine time → clickAt/playDrum offset

    if (!silent) {
      if (s.sound === "click") {
        for (let b = 0; b < n; b++) {
          clickAt(rel(b * beatDur), b === 0, bus);
          for (let k = 1; k < s.sub; k++) clickAt(rel((b + k / s.sub) * beatDur), false, bus, 0.5);
        }
      } else if (s.sound === "custom") {
        const grid = adaptGrid(s.grid, s.sig);
        const cellDur = (n * beatDur) / gridCells(s.sig, grid.res);
        (["kick", "snare", "hat"] as DrumVoice[]).forEach((voice) => {
          const row = grid[voice];
          for (let i = 0; i < row.length; i++) {
            if (row[i] !== ".") playDrum(ctx, voice, rel(i * cellDur), row[i] === "X", bus);
          }
        });
      } else {
        drumPatternEvents(s.sound, n, d).forEach((ev) => playDrum(ctx, ev.voice, rel(ev.t * beatDur), !!ev.accent, bus));
      }
    }

    const thisBar = bar;
    for (let b = 0; b < n; b++) {
      const delay = (t0 + b * beatDur - ctx.currentTime) * 1000;
      timers.push(
        setTimeout(() => {
          if (!stopped)
            opts.onTick({ bar: thisBar, beat: b, beats: n, silent, gapPos: cycle ? thisBar % cycle : 0, gapLen: cycle });
        }, Math.max(0, delay))
      );
    }
    bar++;
    barT += n * beatDur;
  };

  const pump = setInterval(() => {
    // background throttling can leave us far behind — realign instead of
    // fast-forwarding through every missed bar as a burst of clicks
    if (barT < ctx.currentTime - 0.05) barT = ctx.currentTime + 0.1;
    while (!stopped && barT - ctx.currentTime < 0.3) scheduleBar();
  }, 100);
  while (barT - ctx.currentTime < 0.3) scheduleBar();

  return () => {
    stopped = true;
    clearInterval(pump);
    timers.forEach(clearTimeout);
    killBus(bus);
  };
}
