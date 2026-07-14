// AI song assistant — shared config. The server (`/api/ai/*`) is the real
// gate; the client only uses the whitelist to decide whether to show the
// button. Experimental: whitelisted accounts only.

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
`.trim();
