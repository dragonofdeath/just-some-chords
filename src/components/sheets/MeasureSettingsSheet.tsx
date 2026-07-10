import Sheet from "./Sheet";
import type { Measure, SongDocV2 } from "../../lib/songModel";
import { chordLabel } from "../../lib/theory";
import SoundOverrideRows from "./SoundOverrideRows";

interface Props {
  doc: SongDocV2;
  measure: Measure;
  inheritSig: string; // effective sig from line/part/song
  inheritPat: string; // effective pattern from line/part/song
  onSetSig: (sig: string | undefined) => void;
  onSetPat: (pat: string | undefined) => void;
  onNewPattern: () => void;
  onClose: () => void;
}

export default function MeasureSettingsSheet({
  doc,
  measure,
  inheritSig,
  inheritPat,
  onSetSig,
  onSetPat,
  onNewPattern,
  onClose,
}: Props) {
  const title = measure.slots.map((s) => (s ? chordLabel(s) : "—")).join(" / ");

  return (
    <Sheet title={title} sub="measure sound" label="Measure sound settings" onClose={onClose}>
      <SoundOverrideRows
        doc={doc}
        sig={measure.sig}
        pat={measure.pat}
        inheritSig={inheritSig}
        inheritPat={inheritPat}
        inheritLabel="inherit"
        onSetSig={onSetSig}
        onSetPat={onSetPat}
        onNewPattern={onNewPattern}
      />
      <div className="sheet-actions">
        <span />
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
