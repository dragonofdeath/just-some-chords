import Sheet from "./Sheet";
import type { Measure, Pos, SongDocV2 } from "../../lib/songModel";
import { BUILTIN_PATTERNS, patternLabel } from "../../lib/patterns";
import {
  EXTENSIONS,
  FIFTHS,
  TIME_SIGNATURES,
  chordLabel,
  chordRoman,
  extLabel,
} from "../../lib/theory";

interface Props {
  doc: SongDocV2;
  pos: Pos;
  slot: number;
  measure: Measure;
  keyIdx: number;
  songSig: string;
  songPattern: string;
  onSelectSlot: (slot: number) => void;
  onSlotCount: (count: number) => void;
  onToggleRest: () => void;
  onSetExt: (ext: string) => void;
  onSetSig: (sig: string | undefined) => void;
  onSetPat: (pat: string | undefined) => void;
  onRemoveMeasure: () => void;
  onNewPattern: () => void;
  onClose: () => void;
}

export default function EditMeasureSheet({
  doc,
  slot,
  measure,
  keyIdx,
  songSig,
  songPattern,
  onSelectSlot,
  onSlotCount,
  onToggleRest,
  onSetExt,
  onSetSig,
  onSetPat,
  onRemoveMeasure,
  onNewPattern,
  onClose,
}: Props) {
  const chord = measure.slots[slot] ?? null;
  const title = measure.slots.map((s) => (s ? chordLabel(s) : "—")).join(" / ");
  const customs = Object.entries(doc.patterns ?? {});

  return (
    <Sheet
      title={title}
      sub={chord ? `${chordRoman(chord, keyIdx)} in ${FIFTHS[keyIdx].maj}` : "rest"}
      label="Edit measure"
      onClose={onClose}
    >
      <p className="sheet-label">Chords in this measure</p>
      <div className="ext-pills">
        {[1, 2, 3, 4].map((k) => (
          <button
            key={k}
            className={`ext-pill ${measure.slots.length === k ? "ext-active" : ""}`}
            onClick={() => onSlotCount(k)}
          >
            {k}
          </button>
        ))}
      </div>

      {measure.slots.length > 1 && (
        <div className="ext-pills slot-tabs">
          {measure.slots.map((s, i) => (
            <button
              key={i}
              className={`ext-pill ${i === slot ? "ext-active" : ""}`}
              onClick={() => onSelectSlot(i)}
            >
              {s ? chordLabel(s) : "—"}
            </button>
          ))}
        </div>
      )}
      <p className="share-note">
        Tap the wheel to replace {measure.slots.length > 1 ? "the selected chord" : "this chord"}.
      </p>

      <div className="ext-pills">
        <button className={`ext-pill ${!chord ? "ext-active" : ""}`} onClick={onToggleRest}>
          — rest
        </button>
        {chord &&
          EXTENSIONS.map((ext) => (
            <button
              key={ext || "triad"}
              className={`ext-pill ${(chord.ext ?? "") === ext ? "ext-active" : ""}`}
              onClick={() => onSetExt(ext)}
            >
              {extLabel(ext)}
            </button>
          ))}
      </div>

      <p className="sheet-label">Measure time signature</p>
      <div className="ext-pills">
        <button className={`ext-pill ${!measure.sig ? "ext-active" : ""}`} onClick={() => onSetSig(undefined)}>
          song ({songSig})
        </button>
        {TIME_SIGNATURES.map((sig) => (
          <button
            key={sig}
            className={`ext-pill ${measure.sig === sig ? "ext-active" : ""}`}
            onClick={() => onSetSig(sig)}
          >
            {sig}
          </button>
        ))}
      </div>

      <p className="sheet-label">Measure rhythm</p>
      <div className="ext-pills">
        <button className={`ext-pill ${!measure.pat ? "ext-active" : ""}`} onClick={() => onSetPat(undefined)}>
          song ({patternLabel(songPattern, doc)})
        </button>
        {Object.entries(BUILTIN_PATTERNS).map(([id, name]) => (
          <button
            key={id}
            className={`ext-pill ${measure.pat === id ? "ext-active" : ""}`}
            onClick={() => onSetPat(id)}
          >
            {name}
          </button>
        ))}
        {customs.map(([id, p]) => (
          <button
            key={id}
            className={`ext-pill ${measure.pat === id ? "ext-active" : ""}`}
            onClick={() => onSetPat(id)}
          >
            {p.name}
          </button>
        ))}
        <button className="ext-pill" onClick={onNewPattern}>＋ New…</button>
      </div>

      <div className="sheet-actions">
        <button className="remove-chord" onClick={onRemoveMeasure}>Remove measure</button>
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
