import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import DrumKitSheet from "./sheets/DrumKitSheet";
import { IconBack, IconPlay, IconStop } from "./icons";
import {
  loadSettings,
  MET_SOUNDS,
  saveSettings,
  startMetronome,
  type MetSettings,
  type TickInfo,
} from "../lib/metronome";
import { disableWakeLock, enableWakeLock } from "../lib/wakeLock";
import { parseSig, TIME_SIGNATURES } from "../lib/theory";

// The metronome tool: a classic metronome face over the drum-machine engine
// in lib/metronome.ts. Everything is kept on the device (localStorage) — no
// account needed.

const MARKS = [
  { name: "Largo", from: 40, at: 50 },
  { name: "Adagio", from: 60, at: 69 },
  { name: "Andante", from: 76, at: 92 },
  { name: "Moderato", from: 108, at: 114 },
  { name: "Allegro", from: 120, at: 138 },
  { name: "Vivace", from: 156, at: 166 },
  { name: "Presto", from: 176, at: 190 },
];
const markOf = (bpm: number) => [...MARKS].reverse().find((m) => bpm >= m.from) ?? MARKS[0];

const clampBpm = (v: number) => Math.min(220, Math.max(40, Math.round(v)));

export default function Metronome() {
  const [, navigate] = useLocation();
  const [s, setS] = useState<MetSettings>(() => loadSettings());
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState<TickInfo | null>(null);
  const [drumsOpen, setDrumsOpen] = useState(false);
  const sRef = useRef(s);
  sRef.current = s;
  const stopEngine = useRef<(() => void) | null>(null);
  const lastBar = useRef(0);

  const patch = (p: Partial<MetSettings>) => setS((prev) => ({ ...prev, ...p }));
  useEffect(() => saveSettings(s), [s]);

  const onTick = (t: TickInfo) => {
    lastBar.current = t.bar;
    setTick(t);
  };

  const stop = () => {
    stopEngine.current?.();
    stopEngine.current = null;
    disableWakeLock();
    setRunning(false);
    setTick(null);
  };
  const toggle = () => {
    if (running) return stop();
    enableWakeLock(); // inside the tap — see lib/wakeLock.ts
    lastBar.current = 0;
    stopEngine.current = startMetronome({ getSettings: () => sRef.current, onTick });
    setRunning(true);
  };

  // bpm/sig change the bar geometry — restart the engine (debounced so slider
  // drags don't stutter), continuing the gap cycle from the bar we were on.
  useEffect(() => {
    if (!stopEngine.current) return;
    const id = setTimeout(() => {
      if (!stopEngine.current) return;
      stopEngine.current();
      stopEngine.current = startMetronome({ getSettings: () => sRef.current, onTick, startBar: lastBar.current });
    }, 180);
    return () => clearTimeout(id);
  }, [s.bpm, s.sig]);

  useEffect(
    () => () => {
      stopEngine.current?.();
      disableWakeLock();
    },
    []
  );

  // ----- tempo controls (same feel as the song tempo sheet) -----
  const hold = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const lastPointer = useRef(0);
  const taps = useRef<number[]>([]);
  const [tapFlash, setTapFlash] = useState(false);

  const bump = (d: number) => setS((prev) => ({ ...prev, bpm: clampBpm(prev.bpm + d) }));
  const holdEnd = () => {
    if (hold.current.t) clearTimeout(hold.current.t);
    if (hold.current.i) clearInterval(hold.current.i);
    hold.current = {};
  };
  const holdStart = (d: number) => {
    lastPointer.current = Date.now();
    bump(d);
    hold.current.t = setTimeout(() => {
      hold.current.i = setInterval(() => {
        lastPointer.current = Date.now();
        bump(d);
      }, 70);
    }, 450);
  };
  const clickBump = (d: number) => {
    if (Date.now() - lastPointer.current < 600) return;
    bump(d);
  };
  useEffect(() => holdEnd, []);

  const tap = () => {
    const now = performance.now();
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2500) taps.current = [now];
    else taps.current.push(now);
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 120);
    const a = taps.current;
    if (a.length >= 2) {
      const ivs: number[] = [];
      for (let i = Math.max(1, a.length - 5); i < a.length; i++) ivs.push(a[i] - a[i - 1]);
      patch({ bpm: clampBpm(60000 / (ivs.reduce((x, v) => x + v, 0) / ivs.length)) });
    }
  };
  const tapPointer = () => {
    lastPointer.current = Date.now();
    tap();
  };
  const tapClick = () => {
    if (Date.now() - lastPointer.current < 400) return;
    tap();
  };

  const stepBtn = (d: number, label: string, aria: string) => (
    <button
      className="tempo-step"
      onPointerDown={() => holdStart(d)}
      onPointerUp={holdEnd}
      onPointerLeave={holdEnd}
      onPointerCancel={holdEnd}
      onClick={() => clickBump(d)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={aria}
    >
      {label}
    </button>
  );

  const gapStep = (key: "gapPlay" | "gapMute", d: number) => {
    patch({ [key]: Math.min(8, Math.max(1, s[key] + d)) } as Partial<MetSettings>);
  };

  const { n } = parseSig(s.sig);
  const beat = tick && tick.beats === n ? tick.beat : -1;
  const silent = !!tick?.silent;
  const soundName = MET_SOUNDS[s.sound] ?? "Click";

  return (
    <main className="shell metro-shell">
      <header className="ed-head met-head">
        <button className="back" onClick={() => navigate("/songs")} aria-label="Back to my songs">
          <IconBack size={22} />
        </button>
        <h1 className="met-title">Metronome</h1>
        <span className="met-head-pad" />
      </header>

      <div className="met-body">
        <div className="met-readout">
          <span className={`met-num ${silent ? "met-num-silent" : ""}`}>{s.bpm}</span>
          <span className="met-mark">BPM · {markOf(s.bpm).name}</span>
        </div>

        <div className="tempo-grid met-tempo">
          <div className="tempo-left">
            <div className="tempo-row">
              {stepBtn(-1, "−", "Slower")}
              <input
                className="tempo-slider"
                type="range"
                min={40}
                max={220}
                value={s.bpm}
                onChange={(e) => patch({ bpm: clampBpm(Number(e.target.value)) })}
                aria-label="Tempo"
              />
              {stepBtn(1, "＋", "Faster")}
            </div>
            <div className="met-chip-row">
              {MARKS.map((m) => (
                <button
                  key={m.name}
                  className={`met-chip ${markOf(s.bpm).name === m.name ? "met-chip-on" : ""}`}
                  onClick={() => patch({ bpm: m.at })}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
          <button className={`tap-pad met-tap ${tapFlash ? "tap-flash" : ""}`} onPointerDown={tapPointer} onClick={tapClick} aria-label="Tap tempo">
            TAP
          </button>
        </div>

        <div className="met-chip-row met-sigs">
          {TIME_SIGNATURES.map((sig) => (
            <button key={sig} className={`met-chip ${s.sig === sig ? "met-chip-on" : ""}`} onClick={() => patch({ sig })}>
              {sig}
            </button>
          ))}
        </div>

        <div className="met-gap">
          <label className="met-gap-head">
            <span className="met-gap-title">Gap trainer</span>
            <input
              type="checkbox"
              checked={s.gapOn}
              onChange={(e) => patch({ gapOn: e.target.checked })}
              aria-label="Gap trainer on"
            />
          </label>
          {s.gapOn && (
            <>
              <div className="met-gap-rows">
                <span className="met-gap-cfg">
                  <button className="bpm-btn" onClick={() => gapStep("gapPlay", -1)} aria-label="Fewer sounding bars">−</button>
                  <b>{s.gapPlay}</b>
                  <button className="bpm-btn" onClick={() => gapStep("gapPlay", 1)} aria-label="More sounding bars">＋</button>
                  {s.gapPlay === 1 ? "bar of sound" : "bars of sound"}
                </span>
                <span className="met-gap-cfg">
                  <button className="bpm-btn" onClick={() => gapStep("gapMute", -1)} aria-label="Fewer silent bars">−</button>
                  <b>{s.gapMute}</b>
                  <button className="bpm-btn" onClick={() => gapStep("gapMute", 1)} aria-label="More silent bars">＋</button>
                  {s.gapMute === 1 ? "bar silent" : "bars silent"}
                </span>
              </div>
              <div className="met-gap-strip" aria-hidden="true">
                {Array.from({ length: s.gapPlay + s.gapMute }, (_, i) => (
                  <span
                    key={i}
                    className={`met-gap-bar ${i >= s.gapPlay ? "met-gap-mute" : ""} ${running && tick && tick.gapLen > 0 && tick.gapPos === i ? "met-gap-now" : ""}`}
                  />
                ))}
              </div>
              <p className="met-gap-note">The beat keeps moving through silent bars — hold the tempo yourself.</p>
            </>
          )}
        </div>
      </div>

      <div className="met-dots" aria-hidden="true">
        {Array.from({ length: n }, (_, b) => (
          <span
            key={b}
            className={`met-dot ${b === 0 ? "met-dot-1" : ""} ${silent ? "met-dot-silent" : ""} ${running && b === beat ? "met-dot-on" : ""}`}
          />
        ))}
      </div>

      <div className="transport met-transport">
        <button className="inst-btn" onClick={() => setDrumsOpen(true)} aria-label="Metronome sound settings">
          {soundName}
        </button>
        <button className="play-btn met-play" onClick={toggle} aria-label={running ? "Stop" : "Start"}>
          {running ? <IconStop size={20} /> : <IconPlay size={26} />}
        </button>
        <span className="met-transport-pad" />
      </div>

      {drumsOpen && <DrumKitSheet settings={s} onChange={patch} onClose={() => setDrumsOpen(false)} />}
    </main>
  );
}
