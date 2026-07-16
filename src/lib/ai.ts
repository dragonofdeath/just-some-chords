// AI song assistant — the browser talks to the ideju-sukurys ai-gateway
// DIRECTLY (it reflects CORS for any origin). No server hop: the site-host
// kills API routes long before a full-song generation finishes, and the
// gateway is reachable from the Wix network only — which is also its real
// access gate. The whitelist below just decides who sees the button.
// Experimental: whitelisted accounts only.
import helpDoc from "../content/help.md?raw";

export const AI_WHITELIST = ["vaidask@wix.com"];

export function aiAllowed(email: string | null | undefined): boolean {
  return !!email && AI_WHITELIST.includes(email.toLowerCase());
}

// What the client sends to /api/ai and what the model must return in its
// ```json block — the full song, replaced wholesale (one-shot, not a diff).
export interface AiSong {
  title: string;
  songKey: string;
  bpm: number;
  timeSignature: string;
  doc: unknown; // SongDocV2 — migrateSong coerces whatever comes back
}

const GATEWAY = "https://bo.wix.com/_api/ideju-ai-gateway";
const MODEL = "CLAUDE_5_SONNET_1_0";
const MAX_TOKENS = 16000;
const ASK_TIMEOUT_MS = 115_000; // the gateway itself allows 120s

// The song format, hand-written for the system prompt. Kept deliberately
// compact; migrateSong forgives small mistakes, but idx semantics must be
// exact — they're the one thing coercion can't fix.
export const SONG_FORMAT_SPEC = `
A song is one JSON object:
{ "title": string, "songKey": string, "bpm": number, "timeSignature": string, "doc": SongDoc }

songKey — the tonic's name as a MAJOR root: one of C G D A E B F♯ D♭ A♭ E♭ B♭ F
  (use the unicode ♯/♭ characters). For minor/modal songs songKey stays the
  tonic name and doc.mode carries the mode ("A minor" = songKey "A" + mode "minor").
timeSignature — one of "2/4" "3/4" "4/4" "5/4" "6/8" "7/8" "9/8" "12/8".
bpm — quarter-note tempo, 40–220.

SongDoc:
{
  "v": 2,
  "mode"?: "major"|"minor"|"dorian"|"phrygian"|"lydian"|"mixolydian"|"locrian",   // absent = major
  "parts": { [partId]: Part },                  // partId = short slug, e.g. "verse"
  "arrangement": [ { "part": partId, "repeat"?: 1-16 } ],
      // Order of parts as played. The SAME partId may be placed several
      // times (a reused chorus) — its content is shared, edits show everywhere.
      // To make one occurrence different, give it its own part entry.
  "playback"?: {
    "pattern"?: patternId,                      // default chord rhythm, see below
    "instrument"?: "piano"|"guitar"|"synth",
    "bass"?: boolean,
    "bassPattern"?: "root"|"root5"|"oct"|"walk"|"pump",
    "drums"?: "off"|"click"|"rock"|"pop8"|"waltz"|"shuffle",
    "countIn"?: boolean,
    "mix"?: { "chords"?: 0-1, "bass"?: 0-1, "drums"?: 0-1 },
    "mute"?: { "chords"?: bool, "bass"?: bool, "drums"?: bool }
  },
  "patterns"?: { [id]: { "name": string, "steps": string, "res"?: 8|16 } },
      // custom rhythm grids over one 4/4 bar; steps chars: "." off,
      // "x" chord hit, "X" accented hit, "a" arpeggio, "r" root note,
      // "-" hold (sustains the previous hit)
  "note"?: string,                              // free text shown under the title
  "tags"?: string[]
}

Part:    { "name": string, "lines": Line[], "note"?: string, "sig"?: string, "pat"?: patternId }
Line:    { "measures": Measure[], "repeat"?: 1-16, "note"?: string, "sig"?: string, "pat"?: patternId }
Measure: { "slots": (Chord|null)[], "div"?: number[], "sig"?: string, "pat"?: patternId }
  - slots: usually ONE chord per measure. null = rest. Several slots split the
    measure; div then lists each slot's length in 16th-note cells and should
    sum to the measure's 16ths (e.g. 4/4 half-and-half: "div":[8,8]).
  - sig/pat are overrides; resolution is measure ?? line ?? part ?? song.

patternId (built-ins): "block" "strum-beats" "boom-chick" "arp-up" "arp-updown"
  "waltz" "skank" "off" — or the id of an entry in doc.patterns.

Chord: { "idx": 0-11, "quality": "maj"|"min", "ext"?: string }
  idx is the POSITION ON THE CIRCLE OF FIFTHS (not a pitch class), and
  quality picks between that slot's major and its RELATIVE minor:
    idx :  0    1    2    3    4    5    6    7    8    9    10   11
    maj :  C    G    D    A    E    B    F♯   D♭   A♭   E♭   B♭   F
    min :  Am   Em   Bm   F♯m  C♯m  G♯m  D♯m  B♭m  Fm   Cm   Gm   Dm
  So Am = {"idx":0,"quality":"min"}, Gm = {"idx":10,"quality":"min"},
  E major = {"idx":4,"quality":"maj"}. Get this exactly right.
  ext (optional): "7" "maj7" "6" "9" "add9" "sus2" "sus4" "dim" "aug" "5"
    "dim7" "7sus4" "6/9" "maj9" "11" "13" "7b5" "7#5" "7b9" "7#9".
    "dim" "aug" "5" "dim7" "7sus4" "sus2" "sus4" ignore quality (root-only);
    minor + "7b5" is the half-diminished (m7♭5).

Example — split (multi-chord) measures. The verse of "Yellow Submarine"
(The Beatles, key G, 4/4) changes chords mid-bar: | G D | C G | Em Am | C D |.
Each bar is ONE measure with two slots, halved by div (8+8 sixteenths):
  {"measures":[
    {"slots":[{"idx":1,"quality":"maj"},{"idx":2,"quality":"maj"}],"div":[8,8]},
    {"slots":[{"idx":0,"quality":"maj"},{"idx":1,"quality":"maj"}],"div":[8,8]},
    {"slots":[{"idx":1,"quality":"min"},{"idx":0,"quality":"min"}],"div":[8,8]},
    {"slots":[{"idx":0,"quality":"maj"},{"idx":2,"quality":"maj"}],"div":[8,8]}]}
Uneven splits work the same way: "div":[12,4] holds the first chord for three
beats and lands the second on beat 4; "div":[6,10] is fine too. Never model a
mid-bar change as two separate measures — that doubles the bar count.
`.trim();

function systemPrompt(song: AiSong): string {
  return [
    "You are the song assistant inside Just Some Chords, a mobile songwriting app",
    "built on a circle-of-fifths chord wheel. The user is editing one song and",
    "sends you one message; you get exactly one reply (no follow-up turns).",
    "",
    "You can do two things, separately or together:",
    "1. Answer questions — about the song, harmony/theory, or how to do",
    "   something in the app (the app's help page is included below).",
    "2. Edit the song — when the user asks for a change, apply it.",
    "",
    "Reply format (strict):",
    "- Start with a short plain-text answer (a few sentences, no markdown",
    "  headings). Mention what you changed and why it works musically.",
    "- If and ONLY if you changed the song, end the reply with one fenced",
    "  ```json block containing the COMPLETE updated song object (the full",
    "  shape below — not a fragment, not a diff), as compact single-line",
    "  JSON. No text after the block.",
    "- Never edit when the user only asked a question.",
    "",
    "Editing rules:",
    "- Preserve everything the user didn't ask to change (ids, notes, tags,",
    "  playback settings, custom patterns).",
    "- Remember parts are shared by reference in the arrangement: editing a",
    "  part edits every placement of it.",
    "",
    "## Song format",
    "",
    SONG_FORMAT_SPEC,
    "",
    "## The user's current song",
    "",
    "```json",
    JSON.stringify(song),
    "```",
    "",
    "## App help page (for how-do-I questions)",
    "",
    helpDoc,
  ].join("\n");
}

// Split the model's reply into prose + the trailing ```json block, if any.
function splitReply(text: string): { reply: string; song?: unknown } {
  const m = /```json\s*([\s\S]*?)```\s*$/.exec(text);
  if (!m) return { reply: text.trim() };
  try {
    return { reply: text.slice(0, m.index).trim(), song: JSON.parse(m[1]) };
  } catch {
    // Malformed JSON — surface the prose, drop the broken edit.
    return { reply: text.slice(0, m.index).trim() };
  }
}

/** One-shot ask. Throws with a user-facing message on failure. */
export async function askAi(message: string, song: AiSong): Promise<{ reply: string; song?: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/generate-by-object`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      body: JSON.stringify({
        prompt: {
          invokeAnthropicModelRequest: {
            model: MODEL,
            maxTokens: MAX_TOKENS,
            systemPrompt: [{ text: systemPrompt(song) }],
            messages: [{ role: "USER", content: [{ textContent: { text: message.slice(0, 4000) } }] }],
          },
        },
      }),
    });
  } catch {
    throw new Error("Couldn't reach the assistant — it needs the Wix network (VPN).");
  }
  if (!res.ok) throw new Error(`The assistant couldn't answer (gateway ${res.status}) — try again.`);
  const data = await res.json();
  const text = data?.content?.response?.generatedTexts?.[0];
  if (typeof text !== "string" || !text.trim()) throw new Error("The assistant gave an empty answer — try again.");
  return splitReply(text);
}

/** Whisper speech-to-text for the mic button. Throws on failure. */
export async function transcribeAudio(base64Audio: string, fileName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ base64Audio, fileName }),
    });
  } catch {
    throw new Error("Couldn't reach the assistant — it needs the Wix network (VPN).");
  }
  if (!res.ok) throw new Error(`Couldn't transcribe (gateway ${res.status}) — type instead.`);
  const data = await res.json();
  return String(data?.content?.openAiTranscriptionResponse?.text ?? "").trim();
}
