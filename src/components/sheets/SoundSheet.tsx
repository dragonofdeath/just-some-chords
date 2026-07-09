import Sheet from "./Sheet";
import { mixLevel, type Mix, type SongDocV2 } from "../../lib/songModel";
import { BASS_PATTERNS, BUILTIN_PATTERNS } from "../../lib/patterns";
import { DRUM_PRESETS } from "../../lib/drums";
import { INSTRUMENTS, instrumentLabel, type Instrument } from "../../lib/sampler";

const MIX_TRACKS: Array<{ key: keyof Mix; label: string }> = [
  { key: "chords", label: "Chords" },
  { key: "bass", label: "Bass" },
  { key: "drums", label: "Drums" },
];

interface Props {
  doc: SongDocV2;
  instrument: Instrument;
  onInstrument: (i: Instrument) => void;
  onPattern: (id: string) => void;
  onBass: (on: boolean) => void;
  onBassPattern: (id: string) => void;
  onDrums: (id: string) => void;
  onMix: (track: keyof Mix, value: number) => void;
  onMute: (track: keyof Mix, muted: boolean) => void;
  onNewPattern: () => void;
  onManage: () => void;
  onClose: () => void;
}

export default function SoundSheet({
  doc,
  instrument,
  onInstrument,
  onPattern,
  onBass,
  onBassPattern,
  onDrums,
  onMix,
  onMute,
  onNewPattern,
  onManage,
  onClose,
}: Props) {
  const pb = doc.playback ?? {};
  const pattern = pb.pattern ?? "block";
  const bassOn = pb.bass === true;
  const bassPattern = pb.bassPattern ?? "root5";
  const drums = pb.drums ?? "off";
  const customs = Object.entries(doc.patterns ?? {});

  return (
    <Sheet title="Sound" sub="whole song" label="Sound settings" onClose={onClose}>
      <p className="sheet-label">Mixer</p>
      {MIX_TRACKS.map(({ key, label }) => {
        const muted = pb.mute?.[key] === true;
        return (
          <div className="mix-row" key={key}>
            <span className="mix-name">{label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(mixLevel(pb.mix, key) * 100)}
              onChange={(e) => onMix(key, Number(e.target.value) / 100)}
              aria-label={`${label} volume`}
            />
            <button
              className={`mix-mute ${muted ? "mix-muted" : ""}`}
              onClick={() => onMute(key, !muted)}
              aria-pressed={muted}
              aria-label={`Mute ${label}`}
              title={muted ? "Unmute" : "Mute"}
            >
              M
            </button>
          </div>
        );
      })}

      <p className="sheet-label">Chord instrument</p>
      <div className="ext-pills">
        {INSTRUMENTS.map((i) => (
          <button
            key={i}
            className={`ext-pill ${instrument === i ? "ext-active" : ""}`}
            onClick={() => onInstrument(i)}
          >
            {instrumentLabel(i)}
          </button>
        ))}
      </div>

      <p className="sheet-label">Rhythm pattern</p>
      <div className="ext-pills">
        {Object.entries(BUILTIN_PATTERNS).map(([id, name]) => (
          <button
            key={id}
            className={`ext-pill ${pattern === id ? "ext-active" : ""}`}
            onClick={() => onPattern(id)}
          >
            {name}
          </button>
        ))}
        {customs.map(([id, p]) => (
          <button
            key={id}
            className={`ext-pill ${pattern === id ? "ext-active" : ""}`}
            onClick={() => onPattern(id)}
          >
            {p.name}
          </button>
        ))}
        <button className="ext-pill" onClick={onNewPattern}>＋ New…</button>
        {customs.length > 0 && (
          <button className="ext-pill" onClick={onManage}>⚙ Manage</button>
        )}
      </div>

      <p className="sheet-label">Bass</p>
      <div className="ext-pills">
        <button className={`ext-pill ${!bassOn ? "ext-active" : ""}`} onClick={() => onBass(false)}>
          Off
        </button>
        {Object.entries(BASS_PATTERNS).map(([id, name]) => (
          <button
            key={id}
            className={`ext-pill ${bassOn && bassPattern === id ? "ext-active" : ""}`}
            onClick={() => {
              onBass(true);
              onBassPattern(id);
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <p className="sheet-label">Drums</p>
      <div className="ext-pills">
        {Object.entries(DRUM_PRESETS).map(([id, name]) => (
          <button
            key={id}
            className={`ext-pill ${drums === id ? "ext-active" : ""}`}
            onClick={() => onDrums(id)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="sheet-actions">
        <span />
        <button className="sheet-done" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
