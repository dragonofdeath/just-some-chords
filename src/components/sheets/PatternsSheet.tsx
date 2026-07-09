import Sheet from "./Sheet";
import type { SongDocV2 } from "../../lib/songModel";

interface Props {
  doc: SongDocV2;
  onEdit: (id: string) => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

export default function PatternsSheet({ doc, onEdit, onClone, onDelete, onNew, onClose }: Props) {
  const customs = Object.entries(doc.patterns ?? {});
  return (
    <Sheet title="My patterns" sub={`${customs.length} custom`} label="Manage patterns" onClose={onClose}>
      {customs.length === 0 && <p className="share-note">No custom patterns yet — create one below.</p>}
      {customs.map(([id, p]) => (
        <div className="pat-row" key={id}>
          <span className="pat-row-info">
            <span className="pat-row-name">{p.name}</span>
            <span className="pat-row-steps">{p.steps} · {p.res === 16 ? "16ths" : "8ths"}</span>
          </span>
          <button className="part-btn" onClick={() => onEdit(id)}>Edit</button>
          <button className="part-btn" onClick={() => onClone(id)}>⧉</button>
          <button className="pat-del" onClick={() => onDelete(id)} aria-label={`Delete ${p.name}`}>🗑</button>
        </div>
      ))}
      <div className="sheet-actions">
        <button className="part-btn" onClick={onNew}>＋ New pattern</button>
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
