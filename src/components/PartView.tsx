import { useRef } from "react";
import type { Measure, Pos, SongDocV2 } from "../lib/songModel";
import { clampRepeat } from "../lib/songModel";
import { chordLabel, chordRoman, type Chord } from "../lib/theory";

export interface Sel {
  ai: number;
  li: number;
  a: number;
  b: number;
}

interface Props {
  doc: SongDocV2;
  keyIdx: number;
  sel: Sel | null;
  playPos: Pos | null;
  playing: boolean;
  active: { ai: number; li: number };
  registerRow: (ai: number, li: number, el: HTMLElement | null) => void;
  onTapMeasure: (ai: number, li: number, mi: number) => void;
  onDragRange: (ai: number, li: number, from: number, to: number) => void;
  onTapLine: (ai: number, li: number) => void;
  onOpenPart: (ai: number) => void;
  onOpenLine: (ai: number, li: number) => void;
  onAdd: () => void;
}

function slotLabel(slot: Chord | null): string {
  return slot ? chordLabel(slot) : "—";
}

function measureTop(m: Measure): string {
  return m.slots.map(slotLabel).join(" / ");
}

function measureSub(m: Measure, keyIdx: number): string {
  const romans = m.slots.map((s) => (s ? chordRoman(s, keyIdx) : "–")).join("/");
  const extras = [m.sig, m.pat ? "♪" : null].filter(Boolean).join(" ");
  return extras ? `${romans} · ${extras}` : romans;
}

export default function PartView({
  doc,
  keyIdx,
  sel,
  playPos,
  playing,
  active,
  registerRow,
  onTapMeasure,
  onDragRange,
  onTapLine,
  onOpenPart,
  onOpenLine,
  onAdd,
}: Props) {
  // Drag-select: touch implicitly captures the pressed element, so extension
  // is resolved via elementFromPoint against the chips' data attributes.
  const drag = useRef<{ ai: number; li: number; mi: number; moved: boolean } | null>(null);

  const onChipPointerDown = (ai: number, li: number, mi: number) => {
    drag.current = { ai, li, mi, moved: false };
  };
  const onChipPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-mi]") as HTMLElement | null;
    if (!el) return;
    const ai = Number(el.dataset.ai);
    const li = Number(el.dataset.li);
    const mi = Number(el.dataset.mi);
    if (ai !== d.ai || li !== d.li) return; // ranges live within one line
    if (mi === d.mi && !d.moved) return; // still on the start measure
    d.moved = true;
    onDragRange(d.ai, d.li, d.mi, mi);
  };
  const onChipPointerCancel = () => {
    drag.current = null;
  };
  const onChipClick = (ai: number, li: number, mi: number) => {
    const wasDrag = drag.current?.moved === true;
    drag.current = null;
    if (!wasDrag) onTapMeasure(ai, li, mi);
  };

  return (
    <div className="sections-scroll">
      {doc.arrangement.map((pl, ai) => {
        const part = doc.parts[pl.part];
        if (!part) return null;
        const partActive = active.ai === ai;
        return (
          <section key={ai} className={`section-block ${partActive ? "sb-active" : ""}`}>
            <div className="sb-head" onClick={() => onTapLine(ai, 0)}>
              <span className="sb-title-row">
                {clampRepeat(pl.repeat) > 1 && <span className="sb-repeat">{clampRepeat(pl.repeat)}×</span>}
                <span className="sb-name">{part.name}</span>
              </span>
              <span className="sb-side">
                <span className="sb-meta">{partActive ? "adding here" : ""}</span>
                <button
                  className="sb-more"
                  aria-label={`Edit part ${part.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPart(ai);
                  }}
                >
                  ⋯
                </button>
              </span>
            </div>

            {part.lines.map((line, li) => {
              const lineActive = partActive && active.li === li;
              return (
                <div
                  key={li}
                  ref={(el) => registerRow(ai, li, el)}
                  className={`line-row ${lineActive ? "line-active" : ""}`}
                  onClick={() => onTapLine(ai, li)}
                >
                  <div className="chips">
                    {line.measures.length === 0 && (
                      <span className="empty">{lineActive ? "Tap the wheel to add chords" : "Empty line"}</span>
                    )}
                    {line.measures.map((m, mi) => {
                      const selected = sel?.ai === ai && sel.li === li && mi >= sel.a && mi <= sel.b;
                      const isPlaying =
                        playing && playPos?.ai === ai && playPos.li === li && playPos.mi === mi;
                      return (
                        <button
                          key={mi}
                          data-ai={ai}
                          data-li={li}
                          data-mi={mi}
                          className={`chip ${selected ? "chip-selected" : ""} ${isPlaying ? "chip-playing" : ""}`}
                          title="Tap to select, drag to select a range"
                          onPointerDown={() => onChipPointerDown(ai, li, mi)}
                          onPointerMove={onChipPointerMove}
                          onPointerCancel={onChipPointerCancel}
                          onClick={(e) => {
                            e.stopPropagation();
                            onChipClick(ai, li, mi);
                          }}
                        >
                          <span className="c-name">{measureTop(m)}</span>
                          <span className="c-roman">{measureSub(m, keyIdx)}</span>
                        </button>
                      );
                    })}
                    <button
                      className={`line-badge ${clampRepeat(line.repeat) > 1 ? "line-badge-on" : ""}`}
                      aria-label="Line settings"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenLine(ai, li);
                      }}
                    >
                      {clampRepeat(line.repeat) > 1 ? `${clampRepeat(line.repeat)}×` : "⋯"}
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      <button className="add-section" onClick={onAdd}>＋ Add part</button>
    </div>
  );
}
