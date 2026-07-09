import Sheet from "./Sheet";
import type { SongDocV2 } from "../../lib/songModel";
import { clampRepeat, partAt, placementCount } from "../../lib/songModel";
import { SECTION_NAMES } from "../../lib/theory";

interface PartProps {
  doc: SongDocV2;
  ai: number;
  onRename: (name: string) => void;
  onRepeat: (delta: number) => void;
  onMove: (dir: -1 | 1) => void;
  onAddLine: () => void;
  onAddPlacement: () => void; // place this same part again (reference)
  onDuplicateAsNew: () => void; // deep copy into an independent part
  onDeletePlacement: () => void;
  onClose: () => void;
}

export function PartSheet({
  doc,
  ai,
  onRename,
  onRepeat,
  onMove,
  onAddLine,
  onAddPlacement,
  onDuplicateAsNew,
  onDeletePlacement,
  onClose,
}: PartProps) {
  const at = partAt(doc, ai);
  if (!at) return null;
  const pl = doc.arrangement[ai];
  const rep = clampRepeat(pl.repeat);
  const places = placementCount(doc, at.partId);

  return (
    <Sheet
      title={at.part.name}
      sub={places > 1 ? `used ${places}× in the song` : "used once"}
      label="Edit part"
      onClose={onClose}
    >
      <p className="sheet-label">Name — renames every use</p>
      <input
        className="rename-input"
        value={at.part.name}
        onChange={(e) => onRename(e.target.value)}
        aria-label="Part name"
      />
      <div className="ext-pills">
        {SECTION_NAMES.map((n) => (
          <button key={n} className="ext-pill" onClick={() => onRename(n)}>
            {n}
          </button>
        ))}
      </div>

      <div className="repeat-row">
        <span className="repeat-label">Repeats (this placement)</span>
        <div className="repeat-stepper">
          <button className="bpm-btn" disabled={rep <= 1} onClick={() => onRepeat(-1)} aria-label="Fewer repeats">−</button>
          <span className="repeat-value">{rep}×</span>
          <button className="bpm-btn" disabled={rep >= 16} onClick={() => onRepeat(1)} aria-label="More repeats">+</button>
        </div>
      </div>

      <div className="part-actions">
        <button className="part-btn" disabled={ai === 0} onClick={() => onMove(-1)}>↑ Move up</button>
        <button className="part-btn" disabled={ai === doc.arrangement.length - 1} onClick={() => onMove(1)}>↓ Move down</button>
        <button className="part-btn" onClick={onAddLine}>＋ Add line</button>
        <button className="part-btn" onClick={onAddPlacement}>⇊ Use again below</button>
        <button className="part-btn" onClick={onDuplicateAsNew}>⧉ Duplicate as new</button>
      </div>

      <div className="sheet-actions">
        <button
          className="remove-chord"
          disabled={doc.arrangement.length <= 1}
          onClick={onDeletePlacement}
        >
          {places > 1 ? "Remove from here" : "Delete part"}
        </button>
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}

interface LineProps {
  doc: SongDocV2;
  ai: number;
  li: number;
  onRepeat: (delta: number) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onLoop: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function LineSheet({ doc, ai, li, onRepeat, onMove, onDuplicate, onLoop, onDelete, onClose }: LineProps) {
  const at = partAt(doc, ai);
  const line = at?.part.lines[li];
  if (!at || !line) return null;
  const rep = clampRepeat(line.repeat);

  return (
    <Sheet
      title={`${at.part.name} — line ${li + 1}`}
      sub={`${line.measures.length} measures`}
      label="Edit line"
      onClose={onClose}
    >
      <div className="repeat-row">
        <span className="repeat-label">Repeats</span>
        <div className="repeat-stepper">
          <button className="bpm-btn" disabled={rep <= 1} onClick={() => onRepeat(-1)} aria-label="Fewer repeats">−</button>
          <span className="repeat-value">{rep}×</span>
          <button className="bpm-btn" disabled={rep >= 16} onClick={() => onRepeat(1)} aria-label="More repeats">+</button>
        </div>
      </div>
      <div className="part-actions">
        <button className="part-btn" disabled={line.measures.length === 0} onClick={onLoop}>⟳ Loop this line</button>
        <button className="part-btn" disabled={li === 0} onClick={() => onMove(-1)}>↑ Move up</button>
        <button className="part-btn" disabled={li === at.part.lines.length - 1} onClick={() => onMove(1)}>↓ Move down</button>
        <button className="part-btn" onClick={onDuplicate}>⧉ Duplicate</button>
      </div>
      <div className="sheet-actions">
        <button className="remove-chord" disabled={at.part.lines.length <= 1} onClick={onDelete}>
          Delete line
        </button>
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}

interface AddProps {
  doc: SongDocV2;
  onNewPart: () => void;
  onReuse: (partId: string) => void;
  onClose: () => void;
}

export function AddPartSheet({ doc, onNewPart, onReuse, onClose }: AddProps) {
  return (
    <Sheet title="Add part" sub="new or reused" label="Add part" onClose={onClose}>
      <p className="sheet-label">Reuse an existing part (stays in sync)</p>
      <div className="ext-pills">
        {Object.entries(doc.parts).map(([id, p]) => (
          <button key={id} className="ext-pill" onClick={() => onReuse(id)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="part-btn" onClick={onNewPart}>＋ New empty part</button>
        <button className="sheet-done" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
