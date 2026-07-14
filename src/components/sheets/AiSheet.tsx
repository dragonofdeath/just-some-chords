import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import { askAi, transcribeAudio, type AiSong } from "../../lib/ai";

// One-shot AI assistant: type (or dictate) an ask, get one text answer, and —
// when the model edited the song — the change is applied as a single undoable
// edit. No chat history; each ask sends the current song fresh. Talks to the
// ai-gateway straight from the browser (see lib/ai.ts for why).

interface Props {
  getSong: () => AiSong; // captured at submit time, not at open time
  onApply: (song: AiSong) => void;
  onClose: () => void;
}

export default function AiSheet({ getSong, onApply, onClose }: Props) {
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);

  // Don't leave the mic open if the sheet unmounts mid-recording.
  useEffect(() => () => rec.current?.stop(), []);

  const toggleMic = async () => {
    if (recording) {
      rec.current?.stop();
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4") // Safari/iOS
          ? "audio/mp4"
          : "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        rec.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        if (!blob.size) return;
        setTranscribing(true);
        try {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          const text = await transcribeAudio(
            btoa(bin),
            (r.mimeType || "").includes("mp4") ? "ask.m4a" : "ask.webm"
          );
          if (text) setAsk((a) => (a ? `${a} ` : "") + text);
        } catch (e: any) {
          setError(e?.message || "Couldn't transcribe — type instead.");
        }
        setTranscribing(false);
      };
      r.start();
      rec.current = r;
      setRecording(true);
    } catch {
      setError("Microphone unavailable — type instead.");
    }
  };

  const submit = async () => {
    const message = ask.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setReply(null);
    setApplied(false);
    try {
      const data = await askAi(message, getSong());
      setReply(data.reply || "Done.");
      if (data.song) {
        onApply({ ...(data.song as AiSong) });
        setApplied(true);
      }
    } catch (e: any) {
      setError(e?.message || "The assistant couldn't answer right now — try again.");
    }
    setBusy(false);
  };

  return (
    <Sheet title="Assistant" sub="one ask at a time" label="AI assistant" onClose={onClose}>
      {reply && <p className="ai-reply">{reply}</p>}
      {applied && <p className="ai-applied">Changes applied — undo reverts them if it's not right.</p>}
      {error && <p className="save-error">{error}</p>}
      <textarea
        className="note-input"
        rows={3}
        value={ask}
        onChange={(e) => setAsk(e.target.value)}
        placeholder="e.g. add a bridge with a iv–I turnaround, or: why does the chorus feel flat?"
        aria-label="Ask the assistant"
        disabled={busy}
      />
      <div className="sheet-actions">
        <button
          className={`part-btn ai-mic ${recording ? "ai-mic-on" : ""}`}
          onClick={toggleMic}
          disabled={busy || transcribing}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording" : "Dictate"}
        >
          {recording ? "Stop recording" : transcribing ? "Transcribing…" : "Dictate"}
        </button>
        <button className="sheet-done" onClick={submit} disabled={busy || !ask.trim()}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
    </Sheet>
  );
}
