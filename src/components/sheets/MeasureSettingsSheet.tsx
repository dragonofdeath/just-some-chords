import Sheet from "./Sheet";
import type { Measure, SongDocV2 } from "../../lib/songModel";
import { BUILTIN_PATTERNS, patternLabel } from "../../lib/patterns";
import { TIME_SIGNATURES, chordLabel } from "../../lib/theory";

interface Props {
  doc: SongDocV2;
  measure: Measure;
  songSig: string;
  songPattern: string;
  onSetSig: (sig: string | undefined) => void;
  onSetPat: (pat: string | undefined) => void;
  onNewPattern: () => void;
  onClose: () => void;
}

export default function MeasureSettingsSheet({
  doc,
  measure,
  songSig,
  songPattern,
  onSetSig,
  onSetPat,
  onNewPattern,
  onClose,
}: Props) {
  const title = measure.slots.map((s) => (s ? chordLabel(s) : "—")).join(" / ");
  const customs = Object.entries(doc.patterns ?? {});

  return (
    <Sheet title={title} sub="measure settings" label="Measure settings" onClose={onClose}>
      <p className="sheet-label">Time signature</p>
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

      <p className="sheet-label">Rhythm</p>
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
        <span />
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
