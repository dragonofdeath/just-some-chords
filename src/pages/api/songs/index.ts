import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { songFields } from "../../../lib/songFields";

// Runs with the caller's session — a logged-in member's token scopes rows via
// SITE_MEMBER_AUTHOR; anonymous callers are rejected by the platform (403).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const GET: APIRoute = async () => {
  try {
    const res = await items.query("songs").descending("_updatedDate").limit(100).find();
    return json({ songs: res.items });
  } catch {
    return json({ error: "Log in to see your songs." }, 401);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  try {
    // Never set _owner — the platform stamps it from the member identity.
    const created = await items.insert("songs", songFields(body));
    return json(created);
  } catch {
    return json({ error: "Log in to save songs." }, 401);
  }
};
