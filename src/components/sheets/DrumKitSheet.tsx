import Sheet from "./Sheet";
import {
  adaptGrid,
  defaultGrid,
  MET_SOUNDS,
  type DrumGrid,
  type MetSettings,
  type Subdivision,
} from "../../lib/metronome";
import { parseSig } from "../../lib/theory";

// The drum machine behind the metronome face — kept in its own sheet so the
// main screen stays a plain metronome. Changes apply live from the next bar.

const SUBS: { v: Subdivision; label: string }[] = [
  { v: 1, label: "Beat" },
  { v: 2, label: "8ths" },
  { v: 3, label: "Triplets" },
  { v: 4, label: "16ths" },
];

const ROWS: { key: "hat" | "snare" | "kick"; name: string }[] = [
  { key: "hat", name: "Hat" },
  { key: "snare", name: "Snare" },
  { key: "kick", name: "Kick" },
];

interface Props {
  settings: MetSettings;
  onChange: (patch: Partial<MetSettings>) => void;
  onClose: () => void;
}

export default function DrumKitSheet({ settings, onChange, onClose }: Props) {
  const s = settings;
  const grid = adaptGrid(s.grid, s.sig);
  const cells = grid.kick.length;
  const { n } = parseSig(s.sig);
  const perBeat = cells / n;

  const cycleCell = (key: "hat" | "snare" | "kick", i: number) => {
    const row = grid[key];
    const next = row[i] === "." ? "x" : row[i] === "x" ? "X" : ".";
    onChange({ grid: { ...grid, [key]: row.slice(0, i) + next + row.slice(i + 1) } });
  };

  const setRes = (res: 8 | 16) => {
    if (res === grid.res) return;
    const convert = (row: string) => {
      if (res === 16) return [...row].map((c) => c + ".").join("");
      let out = "";
      for (let i = 0; i < row.length; i += 2) {
        const a = row[i];
        const b = row[i + 1] ?? ".";
        out += a !== "." ? a : b; // keep the 8th; rescue a hit from the offbeat 16th
      }
      return out;
    };
    onChange({
      grid: adaptGrid({ res, kick: convert(grid.kick), snare: convert(grid.snare), hat: convert(grid.hat) }, s.sig),
    });
  };

  return (
    <Sheet title="Metronome sound" sub="changes apply on the next bar" label="Metronome sound" onClose={onClose}>
      <div className="ext-pills">
        {Object.entries(MET_SOUNDS).map(([key, name]) => (
          <button
            key={key}
            className={`ext-pill ${s.sound === key ? "ext-active" : ""}`}
            onClick={() => onChange({ sound: key })}
          >
            {name}
          </button>
        ))}
      </div>

      {s.sound === "click" && (
        <>
          <p className="met-sheet-label">Click every</p>
          <div className="ext-pills">
            {SUBS.map(({ v, label }) => (
              <button
                key={v}
                className={`ext-pill ${s.sub === v ? "ext-active" : ""}`}
                onClick={() => onChange({ sub: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {s.sound === "custom" && (
        <>
          <div className="ext-pills">
            {([8, 16] as const).map((r) => (
              <button key={r} className={`ext-pill ${grid.res === r ? "ext-active" : ""}`} onClick={() => setRes(r)}>
                {r}ths
              </button>
            ))}
            <button
              className="ext-pill"
              onClick={() => onChange({ grid: defaultGrid(s.sig, grid.res) })}
            >
              Reset
            </button>
          </div>
          <div className="met-grid-scroll">
            {ROWS.map(({ key, name }) => (
              <div key={key} className="met-grid-row">
                <span className="met-grid-name">{name}</span>
                <div
                  className="met-grid-cells"
                  style={{ gridTemplateColumns: `repeat(${cells}, 1fr)`, minWidth: cells > 16 ? cells * 20 : undefined }}
                >
                  {[...grid[key]].map((c, i) => (
                    <button
                      key={i}
                      className={`met-cell ${c !== "." ? "pat-on" : ""} ${c === "X" ? "pat-accent" : ""} ${i % perBeat === 0 ? "met-cell-beat" : ""}`}
                      onClick={() => cycleCell(key, i)}
                      aria-label={`${name} cell ${i + 1}: ${c === "." ? "off" : c === "x" ? "hit" : "accent"}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="share-note">One bar of {s.sig}. Tap a cell to cycle: off → hit → accent.</p>
        </>
      )}

      <div className="mix-row met-vol">
        <span className="mix-name">Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(s.volume * 100)}
          onChange={(e) => onChange({ volume: Number(e.target.value) / 100 })}
          aria-label="Metronome volume"
        />
      </div>

      <div className="sheet-actions">
        <span />
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
