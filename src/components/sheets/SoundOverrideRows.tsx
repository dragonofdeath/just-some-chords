import type { SongDocV2 } from "../../lib/songModel";
import { BUILTIN_PATTERNS, patternLabel } from "../../lib/patterns";
import { TIME_SIGNATURES } from "../../lib/theory";
import { IconAdd } from "../icons";

// The two per-scope sound rows (time signature + rhythm pattern), shared by
// the part, line and measure sheets. `sig`/`pat` are THIS scope's overrides;
// the first pill clears them back to the inherited value shown in its label.

interface Props {
  doc: SongDocV2;
  sig: string | undefined;
  pat: string | undefined;
  inheritSig: string; // effective signature when this scope has no override
  inheritPat: string; // effective pattern id when this scope has no override
  inheritLabel: string; // "song", "part", "line & part"… for the clear pills
  onSetSig: (sig: string | undefined) => void;
  onSetPat: (pat: string | undefined) => void;
  onNewPattern?: () => void;
}

export default function SoundOverrideRows({
  doc,
  sig,
  pat,
  inheritSig,
  inheritPat,
  inheritLabel,
  onSetSig,
  onSetPat,
  onNewPattern,
}: Props) {
  const customs = Object.entries(doc.patterns ?? {});
  return (
    <>
      <p className="sheet-label">Time signature</p>
      <div className="ext-pills">
        <button className={`ext-pill ${!sig ? "ext-active" : ""}`} onClick={() => onSetSig(undefined)}>
          {inheritLabel} ({inheritSig})
        </button>
        {TIME_SIGNATURES.map((s) => (
          <button key={s} className={`ext-pill ${sig === s ? "ext-active" : ""}`} onClick={() => onSetSig(s)}>
            {s}
          </button>
        ))}
      </div>

      <p className="sheet-label">Rhythm</p>
      <div className="ext-pills">
        <button className={`ext-pill ${!pat ? "ext-active" : ""}`} onClick={() => onSetPat(undefined)}>
          {inheritLabel} ({patternLabel(inheritPat, doc)})
        </button>
        {Object.entries(BUILTIN_PATTERNS).map(([id, name]) => (
          <button key={id} className={`ext-pill ${pat === id ? "ext-active" : ""}`} onClick={() => onSetPat(id)}>
            {name}
          </button>
        ))}
        {customs.map(([id, p]) => (
          <button key={id} className={`ext-pill ${pat === id ? "ext-active" : ""}`} onClick={() => onSetPat(id)}>
            {p.name}
          </button>
        ))}
        {onNewPattern && (
          <button className="ext-pill" onClick={onNewPattern}><IconAdd size={11} /> New…</button>
        )}
      </div>
    </>
  );
}
