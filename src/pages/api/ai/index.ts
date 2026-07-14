import type { APIRoute } from "astro";
import { members } from "@wix/members";
import { aiAllowed, SONG_FORMAT_SPEC, type AiSong } from "../../../lib/ai";
// The user help page doubles as the assistant's app documentation.
import helpDoc from "../../../content/help.md?raw";

// One-shot AI song assistant. The client sends the user's ask plus the whole
// current song; the model answers in text and, when it edits, appends ONE
// ```json block with the complete updated song. We split the two here so the
// client never parses model output.
//
// Goes through the ideju-sukurys ai-gateway (no auth; the URL is hardcoded
// on purpose — this is a public repo and the gateway is internal-network).
const GATEWAY = "https://bo.wix.com/_api/ideju-ai-gateway";
const MODEL = "CLAUDE_5_SONNET_1_0";
const MAX_TOKENS = 16000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function memberEmail(): Promise<string | null> {
  try {
    const res = await members.getCurrentMember({ fieldsets: ["FULL"] });
    return res.member?.loginEmail ?? null;
  } catch {
    return null;
  }
}

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
    "  shape below — not a fragment, not a diff). No text after the block.",
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

export const POST: APIRoute = async ({ request }) => {
  const email = await memberEmail();
  if (!email) return json({ error: "Log in to use the assistant." }, 401);
  if (!aiAllowed(email)) return json({ error: "The assistant isn't available on this account yet." }, 403);

  let body: { message?: string; song?: AiSong };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message || !body.song) return json({ error: "Nothing to ask." }, 400);

  try {
    const res = await fetch(`${GATEWAY}/generate-by-object`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: {
          invokeAnthropicModelRequest: {
            model: MODEL,
            maxTokens: MAX_TOKENS,
            systemPrompt: [{ text: systemPrompt(body.song) }],
            messages: [{ role: "USER", content: [{ textContent: { text: message } }] }],
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    const data = await res.json();
    const text = data?.content?.response?.generatedTexts?.[0];
    if (typeof text !== "string" || !text.trim()) throw new Error("empty response");
    return json(splitReply(text));
  } catch (e) {
    console.error("ai generate failed", e);
    return json({ error: "The assistant couldn't answer right now — try again." }, 502);
  }
};
