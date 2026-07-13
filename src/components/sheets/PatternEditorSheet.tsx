import { useState } from "react";
import Sheet from "./Sheet";
import { IconPreview } from "../icons";

// Step grid over one 4/4 bar (tiled/truncated across other meters).
// Cell cycle: off → block → accent block → arpeggio → root → hold.
// "-" (hold) sustains the previous hit — that's how half/whole notes work.
const CYCLE = [".", "x", "X", "a", "r", "-"] as const;
const CELL_LABEL: Record<string, string> = { ".": "·", x: "♪", X: "♪!", a: "arp", r: "root", "-": "—" };

export interface PatternDraft {
  name: string;
  steps: string;
  res: 8 | 16;
}

interface Props {
  initial?: PatternDraft; // set when editing an existing pattern
  onSave: (draft: PatternDraft) => void;
  onPreview: (draft: PatternDraft) => void;
  onClose: () => void;
}

function initCells(initial?: PatternDraft): string[] {
  const res = initial?.res === 16 ? 16 : 8;
  const out: string[] = [];
  for (let i = 0; i < res; i++) {
    out.push(initial ? (initial.steps[i % initial.steps.length] ?? ".") : i % 2 === 0 ? (i === 0 ? "X" : "x") : ".");
  }
  return out;
}

export default function PatternEditorSheet({ initial, onSave, onPreview, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "My pattern");
  const [res, setRes] = useState<8 | 16>(initial?.res === 16 ? 16 : 8);
  const [cells, setCells] = useState<string[]>(() => initCells(initial));

  const cycle = (i: number) => {
    setCells((cs) => cs.map((c, j) => (j === i ? CYCLE[(CYCLE.indexOf(c as any) + 1) % CYCLE.length] : c)));
  };

  const setResolution = (next: 8 | 16) => {
    if (next === res) return;
    setRes(next);
    setCells((cs) => {
      if (next === 16) {
        // each eighth becomes hit+hold so the pattern sounds identical
        return cs.flatMap((c) => (c === "." || c === "-" ? [c, c] : [c, "-"]));
      }
      // 16 → 8: keep the cell on the eighth; rescue a hit from the offbeat 16th
      const out: string[] = [];
      for (let i = 0; i < cs.length; i += 2) {
        const a = cs[i];
        const b = cs[i + 1] ?? ".";
        out.push(a !== "." && a !== "-" ? a : b !== "." && b !== "-" ? b : a);
      }
      return out;
    });
  };

  const draft: PatternDraft = { name: name.trim() || "My pattern", steps: cells.join(""), res };
  const beatLabel = (i: number) =>
    res === 8 ? (i % 2 === 0 ? `${i / 2 + 1}` : "&") : i % 4 === 0 ? `${i / 4 + 1}` : ["", "e", "&", "a"][i % 4];

  return (
    <Sheet
      title={initial ? "Edit pattern" : "New pattern"}
      sub={`one bar of ${res}ths`}
      label="Pattern editor"
      onClose={onClose}
    >
      <input
        className="rename-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Pattern name"
      />
      <div className="ext-pills">
        {([8, 16] as const).map((r) => (
          <button key={r} className={`ext-pill ${res === r ? "ext-active" : ""}`} onClick={() => setResolution(r)}>
            {r}ths
          </button>
        ))}
        <button className="part-btn pat-preview" onClick={() => onPreview(draft)}>
          <IconPreview size={14} /> Preview
        </button>
      </div>
      <div className="pat-grid">
        {cells.map((c, i) => (
          <button
            key={i}
            className={`pat-cell ${c !== "." ? "pat-on" : ""} ${c === "X" ? "pat-accent" : ""} ${c === "-" ? "pat-hold" : ""}`}
            onClick={() => cycle(i)}
            aria-label={`Cell ${i + 1}: ${CELL_LABEL[c]}`}
          >
            <span className="pat-beat">{beatLabel(i)}</span>
            <span className="pat-sym">{CELL_LABEL[c]}</span>
          </button>
        ))}
      </div>
      <p className="share-note">
        Tap a cell to cycle: off → chord → accented → arpeggio → root → hold.
        A hold (—) sustains the previous hit, so a whole note is one chord
        followed by holds.
      </p>
      <div className="sheet-actions">
        <button className="remove-chord" onClick={onClose}>Cancel</button>
        <button className="sheet-done" onClick={() => onSave(draft)}>
          {initial ? "Save changes" : "Save pattern"}
        </button>
      </div>
    </Sheet>
  );
}
