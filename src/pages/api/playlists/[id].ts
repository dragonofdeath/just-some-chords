import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { playlistFields, ownedOnly } from "../../../lib/playlistFields";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const GET: APIRoute = async ({ params }) => {
  try {
    const res = await items.query("playlists").eq("_id", params.id!).limit(1).find();
    const playlist = res.items[0];
    if (!playlist) return json({ error: "Playlist not found." }, 404);
    return json(playlist);
  } catch {
    return json({ error: "Log in to see your playlists." }, 401);
  }
};

export const PUT: APIRoute = async ({ params, request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  try {
    const fields = playlistFields(body);
    fields.songIds = { list: await ownedOnly((fields.songIds as any).list) };
    // items.update REPLACES the whole item — always send the full field set.
    const updated = await items.update("playlists", { _id: params.id!, ...fields });
    return json(updated);
  } catch {
    return json({ error: "Couldn't update — log in and make sure this playlist is yours." }, 401);
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  try {
    await items.remove("playlists", params.id!);
    return json({ ok: true });
  } catch {
    return json({ error: "Couldn't delete — log in and make sure this playlist is yours." }, 401);
  }
};
