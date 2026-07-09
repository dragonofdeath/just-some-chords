import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { items } from "@wix/data";

// Public, read-only lookup of a shared song by its unguessable shareId.
// The songs collection is member-scoped, so this read runs elevated — the
// shareId token is the access control, and only playback fields are returned.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const GET: APIRoute = async ({ params }) => {
  const shareId = params.shareId ?? "";
  if (!/^[A-Za-z0-9-]{16,64}$/.test(shareId)) {
    return json({ error: "This link isn't valid." }, 404);
  }
  try {
    // elevate() copies an SDK method — wrap items.query itself, not a closure.
    const elevatedQuery = auth.elevate(items.query);
    const res = await elevatedQuery("songs").eq("shareId", shareId).limit(1).find();
    const song: any = res.items[0];
    if (!song) return json({ error: "This song isn't shared (or the link was revoked)." }, 404);
    // Never leak owner/system fields — playback data only.
    return json({
      title: song.title ?? "Untitled",
      songKey: song.songKey ?? "G",
      bpm: song.bpm ?? 84,
      timeSignature: song.timeSignature ?? "4/4",
      sections: song.sections?.list ? song.sections : { list: [] },
    });
  } catch {
    return json({ error: "Couldn't load this song right now." }, 500);
  }
};
