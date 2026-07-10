import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";

interface Props {
  bpm: number;
  onSet: (bpm: number) => void;
  onClose: () => void;
}

const clampBpm = (v: number) => Math.min(220, Math.max(40, Math.round(v)));

export default function TempoSheet({ bpm, onSet, onClose }: Props) {
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const hold = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const lastPointer = useRef(0);
  const taps = useRef<number[]>([]);
  const [tapFlash, setTapFlash] = useState(false);

  const bump = (d: number) => onSet(clampBpm(bpmRef.current + d));

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
    if (Date.now() - lastPointer.current < 600) return; // pointer already handled it
    bump(d);
  };
  useEffect(() => holdEnd, []);

  const tap = () => {
    const now = performance.now();
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2500) {
      taps.current = [now]; // long pause — start a fresh measurement
    } else {
      taps.current.push(now);
    }
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 120);
    const a = taps.current;
    if (a.length >= 2) {
      const ivs: number[] = [];
      for (let i = Math.max(1, a.length - 5); i < a.length; i++) ivs.push(a[i] - a[i - 1]);
      const avg = ivs.reduce((s, v) => s + v, 0) / ivs.length;
      onSet(clampBpm(60000 / avg));
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

  return (
    <Sheet title="Song tempo" sub="beats per minute" label="Song tempo" onClose={onClose}>
      <div className="tempo-grid">
        <div className="tempo-left">
          <div className="tempo-row">
            {stepBtn(-1, "−", "Slower")}
            <div className="tempo-readout">
              <span className="tempo-num">{bpm}</span>
              <span className="tempo-unit">BPM</span>
            </div>
            {stepBtn(1, "＋", "Faster")}
          </div>
          <input
            className="tempo-slider"
            type="range"
            min={40}
            max={220}
            value={bpm}
            onChange={(e) => onSet(clampBpm(Number(e.target.value)))}
            aria-label="Tempo"
          />
        </div>
        <button
          className={`tap-pad ${tapFlash ? "tap-flash" : ""}`}
          onPointerDown={tapPointer}
          onClick={tapClick}
          aria-label="Tap tempo"
        >
          TAP
        </button>
      </div>
      <div className="sheet-actions">
        <span />
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
