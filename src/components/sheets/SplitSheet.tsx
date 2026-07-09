import { useMemo, useState } from "react";
import Sheet from "./Sheet";
import type { Measure } from "../../lib/songModel";
import { parseSig } from "../../lib/theory";

const MAX_SLOTS = 8;

interface Props {
  measure: Measure;
  sig: string; // resolved signature of this measure
  onApply: (div: number[]) => void;
  onClose: () => void;
}

export default function SplitSheet({ measure, sig, onApply, onClose }: Props) {
  const { n, d } = parseSig(sig);
  const cells = Math.max(1, Math.round((n * 16) / d)); // one cell = one 16th
  const perBeat = Math.max(1, Math.round(16 / d));

  // existing split → boundary cell indices (rescaled if the sig changed)
  const [bounds, setBounds] = useState<number[]>(() => {
    if (measure.slots.length <= 1) return [];
    const div =
      measure.div && measure.div.length === measure.slots.length
        ? measure.div
        : measure.slots.map(() => 1);
    const total = div.reduce((s, v) => s + v, 0);
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < div.length - 1; i++) {
      acc += div[i];
      out.push(Math.round((acc / total) * cells));
    }
    return [...new Set(out.filter((b) => b > 0 && b < cells))].sort((a, b) => a - b);
  });

  const toggle = (i: number) => {
    setBounds((bs) => {
      if (bs.includes(i)) return bs.filter((b) => b !== i);
      if (bs.length + 2 > MAX_SLOTS) return bs;
      return [...bs, i].sort((a, b) => a - b);
    });
  };

  const setEqual = (k: number) => {
    if (k <= 1) return setBounds([]);
    const out: number[] = [];
    for (let i = 1; i < k; i++) out.push(Math.round((i * cells) / k));
    setBounds([...new Set(out.filter((b) => b > 0 && b < cells))].sort((a, b) => a - b));
  };

  const div = useMemo(() => {
    const pts = [0, ...bounds, cells];
    const out: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) out.push(pts[i + 1] - pts[i]);
    return out;
  }, [bounds, cells]);

  const slotOfCell = (c: number) => bounds.filter((b) => b <= c).length;

  return (
    <Sheet title="Split measure" sub={`${sig} · ${cells} sixteenths`} label="Split measure" onClose={onClose}>
      <p className="share-note">
        Tap where a new chord should start — down to a 16th. Thicker lines mark beats.
      </p>
      <div className="split-grid">
        {Array.from({ length: cells }, (_, i) => (
          <button
            key={i}
            className={`split-cell ${slotOfCell(i) % 2 === 1 ? "split-alt" : ""} ${
              i % perBeat === 0 ? "split-beat" : ""
            } ${bounds.includes(i) ? "split-bound" : ""}`}
            disabled={i === 0}
            onClick={() => toggle(i)}
            aria-label={`Start a chord at sixteenth ${i + 1}`}
          />
        ))}
      </div>
      <p className="sheet-label">
        {div.length === 1
          ? "1 chord — whole measure"
          : `${div.length} chords · lengths ${div.join(" · ")} (in 16ths)`}
      </p>
      <div className="ext-pills">
        {[1, 2, 3, 4].map((k) => (
          <button key={k} className="ext-pill" onClick={() => setEqual(k)}>
            {k === 1 ? "whole" : `${k} equal`}
          </button>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="remove-chord" onClick={onClose}>Cancel</button>
        <button className="sheet-done" onClick={() => onApply(div)}>Apply</button>
      </div>
    </Sheet>
  );
}
