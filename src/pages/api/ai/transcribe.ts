import type { APIRoute } from "astro";
import { members } from "@wix/members";
import { aiAllowed } from "../../../lib/ai";

// Mic input for the AI assistant — relays the recording to the gateway's
// Whisper endpoint and returns plain text.
const GATEWAY = "https://bo.wix.com/_api/ideju-ai-gateway";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const POST: APIRoute = async ({ request }) => {
  let email: string | null = null;
  try {
    const res = await members.getCurrentMember({ fieldsets: ["FULL"] });
    email = res.member?.loginEmail ?? null;
  } catch {
    // anonymous
  }
  if (!email) return json({ error: "Log in to use the assistant." }, 401);
  if (!aiAllowed(email)) return json({ error: "The assistant isn't available on this account yet." }, 403);

  let body: { base64Audio?: string; fileName?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  if (!body.base64Audio) return json({ error: "No audio." }, 400);

  try {
    const res = await fetch(`${GATEWAY}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Audio: body.base64Audio, fileName: body.fileName ?? "audio.webm" }),
    });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    const data = await res.json();
    const text = data?.content?.openAiTranscriptionResponse?.text ?? "";
    return json({ text: String(text).trim() });
  } catch (e) {
    console.error("ai transcribe failed", e);
    return json({ error: "Couldn't transcribe — try again or type instead." }, 502);
  }
};
