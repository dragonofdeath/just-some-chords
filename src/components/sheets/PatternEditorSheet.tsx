import { useState } from "react";
import Sheet from "./Sheet";

// One bar of eighths (8 cells at 4/4); tiled/truncated across other meters.
// Cell cycle: off → block → accent block → arpeggio tone → root note → off.
const CYCLE = [".", "x", "X", "a", "r"] as const;
const CELL_LABEL: Record<string, string> = { ".": "·", x: "♪", X: "♪!", a: "arp", r: "root" };

interface Props {
  onSave: (name: string, steps: string) => void;
  onClose: () => void;
}

export default function PatternEditorSheet({ onSave, onClose }: Props) {
  const [name, setName] = useState("My pattern");
  const [cells, setCells] = useState<string[]>(["X", ".", "x", ".", "x", ".", "x", "."]);

  const cycle = (i: number) => {
    setCells((cs) =>
      cs.map((c, j) => (j === i ? CYCLE[(CYCLE.indexOf(c as any) + 1) % CYCLE.length] : c))
    );
  };

  return (
    <Sheet title="New pattern" sub="one bar of eighths" label="Pattern editor" onClose={onClose}>
      <input
        className="rename-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Pattern name"
      />
      <div className="pat-grid">
        {cells.map((c, i) => (
          <button
            key={i}
            className={`pat-cell ${c !== "." ? "pat-on" : ""} ${c === "X" ? "pat-accent" : ""}`}
            onClick={() => cycle(i)}
            aria-label={`Eighth ${i + 1}: ${CELL_LABEL[c]}`}
          >
            <span className="pat-beat">{i % 2 === 0 ? `${i / 2 + 1}` : "&"}</span>
            <span className="pat-sym">{CELL_LABEL[c]}</span>
          </button>
        ))}
      </div>
      <p className="share-note">
        Tap a cell to cycle: off → chord → accented chord → arpeggio note → root note.
      </p>
      <div className="sheet-actions">
        <button className="remove-chord" onClick={onClose}>Cancel</button>
        <button
          className="sheet-done"
          onClick={() => onSave(name.trim() || "My pattern", cells.join(""))}
        >
          Save pattern
        </button>
      </div>
    </Sheet>
  );
}
