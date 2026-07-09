import { useEffect, useRef, useState } from "react";
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
  moveSel: Sel | null; // measures being moved; non-null = move mode
  playPos: Pos | null;
  playing: boolean;
  active: { ai: number; li: number };
  registerRow: (ai: number, li: number, el: HTMLElement | null) => void;
  onTapMeasure: (ai: number, li: number, mi: number) => void;
  onMoveStart: (ai: number, li: number, mi: number) => void;
  onDrop: (ai: number, li: number, index: number) => void;
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

const HOLD_MS = 550;
const WIGGLE_PX = 10;

export default function PartView({
  doc,
  keyIdx,
  sel,
  moveSel,
  playPos,
  playing,
  active,
  registerRow,
  onTapMeasure,
  onMoveStart,
  onDrop,
  onTapLine,
  onOpenPart,
  onOpenLine,
  onAdd,
}: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(0);
  const press = useRef<{
    t?: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null>(null);
  const cb = useRef({ onDrop, onMoveStart });
  cb.current = { onDrop, onMoveStart };

  const setHoverBoth = (v: string | null) => {
    hoverRef.current = v;
    setHover(v);
  };

  const cancelPress = () => {
    if (press.current?.t) clearTimeout(press.current.t);
    press.current = null;
  };

  const beginPress = (ai: number, li: number, mi: number, x: number, y: number) => {
    cancelPress();
    press.current = {
      x,
      y,
      t: setTimeout(() => {
        dragging.current = true;
        suppressClick.current = Date.now();
        cb.current.onMoveStart(ai, li, mi);
      }, HOLD_MS),
    };
  };

  useEffect(() => {
    const track = (x: number, y: number): boolean => {
      if (press.current && !dragging.current) {
        if (Math.hypot(x - press.current.x, y - press.current.y) > WIGGLE_PX) cancelPress();
        return false;
      }
      if (!dragging.current) return false;
      const el = document.elementFromPoint(x, y);
      const mark = el?.closest?.("[data-drop]") as HTMLElement | null;
      if (mark) {
        setHoverBoth(`${mark.dataset.dai}:${mark.dataset.dli}:${mark.dataset.didx}`);
        return true;
      }
      const chip = el?.closest?.("[data-mchip]") as HTMLElement | null;
      if (chip) {
        const r = chip.getBoundingClientRect();
        const idx = Number(chip.dataset.mi) + (x > r.left + r.width / 2 ? 1 : 0);
        setHoverBoth(`${chip.dataset.ai}:${chip.dataset.li}:${idx}`);
      }
      return true;
    };
    const finish = () => {
      cancelPress();
      if (dragging.current) {
        dragging.current = false;
        suppressClick.current = Date.now();
        const h = hoverRef.current;
        setHoverBoth(null);
        if (h) {
          const [ai, li, idx] = h.split(":").map(Number);
          cb.current.onDrop(ai, li, idx);
        }
        // no hover target → stay in move mode; the markers take a tap instead
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && track(t.clientX, t.clientY)) e.preventDefault(); // stop scroll while dragging
    };
    const onMouseMove = (e: MouseEvent) => track(e.clientX, e.clientY);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", finish);
    return () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", finish);
    };
  }, []);

  const moveMode = !!moveSel;

  const dropMark = (ai: number, li: number, index: number) => {
    const key = `${ai}:${li}:${index}`;
    return (
      <button
        key={`d${index}`}
        className={`drop-mark ${hover === key ? "drop-hot" : ""}`}
        data-drop
        data-dai={ai}
        data-dli={li}
        data-didx={index}
        aria-label="Place here"
        onClick={(e) => {
          e.stopPropagation();
          onDrop(ai, li, index);
        }}
      />
    );
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
                <span className="sb-meta">{partActive && !moveMode ? "adding here" : ""}</span>
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
                    {moveMode && dropMark(ai, li, 0)}
                    {line.measures.length === 0 && !moveMode && (
                      <span className="empty">{lineActive ? "Tap the wheel to add chords" : "Empty line"}</span>
                    )}
                    {line.measures.map((m, mi) => {
                      const selected = sel?.ai === ai && sel.li === li && mi >= sel.a && mi <= sel.b;
                      const isMoving =
                        moveSel?.ai === ai && moveSel.li === li && mi >= moveSel.a && mi <= moveSel.b;
                      const isPlaying =
                        playing && playPos?.ai === ai && playPos.li === li && playPos.mi === mi;
                      return (
                        <span key={mi} style={{ display: "contents" }}>
                          <button
                            data-mchip
                            data-ai={ai}
                            data-li={li}
                            data-mi={mi}
                            className={`chip ${selected ? "chip-selected" : ""} ${isPlaying ? "chip-playing" : ""} ${isMoving ? "chip-moving" : ""}`}
                            title="Tap to select, hold to move"
                            onTouchStart={(e) => {
                              const t = e.touches[0];
                              if (t) beginPress(ai, li, mi, t.clientX, t.clientY);
                            }}
                            onMouseDown={(e) => beginPress(ai, li, mi, e.clientX, e.clientY)}
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelPress();
                              if (Date.now() - suppressClick.current < 500) return;
                              onTapMeasure(ai, li, mi);
                            }}
                          >
                            <span className="c-name">{measureTop(m)}</span>
                            <span className="c-roman">{measureSub(m, keyIdx)}</span>
                          </button>
                          {moveMode && dropMark(ai, li, mi + 1)}
                        </span>
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
