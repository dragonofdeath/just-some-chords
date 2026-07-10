import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { playlistFields, ownedOnly } from "../../../lib/playlistFields";

// Runs with the caller's session — member-scoped like the songs routes.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const GET: APIRoute = async () => {
  try {
    const res = await items.query("playlists").descending("_updatedDate").limit(100).find();
    return json({ playlists: res.items });
  } catch {
    return json({ error: "Log in to see your playlists." }, 401);
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
    const fields = playlistFields(body);
    fields.songIds = { list: await ownedOnly((fields.songIds as any).list) };
    const created = await items.insert("playlists", fields);
    return json(created);
  } catch {
    return json({ error: "Log in to save playlists." }, 401);
  }
};
