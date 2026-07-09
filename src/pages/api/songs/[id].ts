import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { songFields } from "../../../lib/songFields";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const GET: APIRoute = async ({ params }) => {
  try {
    const res = await items.query("songs").eq("_id", params.id!).limit(1).find();
    const song = res.items[0];
    if (!song) return json({ error: "Song not found." }, 404);
    return json(song);
  } catch {
    return json({ error: "Log in to see your songs." }, 401);
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
    // items.update REPLACES the whole item — always send the full field set.
    const updated = await items.update("songs", {
      _id: params.id!,
      ...songFields(body),
    });
    return json(updated);
  } catch {
    return json({ error: "Couldn't update — log in and make sure this song is yours." }, 401);
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  try {
    await items.remove("songs", params.id!);
    return json({ ok: true });
  } catch {
    return json({ error: "Couldn't delete — log in and make sure this song is yours." }, 401);
  }
};
