import { items } from "@wix/data";

// A playlist may only reference the caller's own songs: the shared-playlist
// page reads its songs ELEVATED, so an unchecked id list would let anyone
// publish other people's private songs. This query runs with the caller's
// member scope, so it can only ever return songs they own.
export async function ownedOnly(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const res = await items.query("songs").in("_id", ids).limit(200).find();
  const owned = new Set(res.items.map((s: any) => s._id));
  return ids.filter((id) => owned.has(id));
}

// Normalize an incoming request body to the playlists collection's field set.
export function playlistFields(body: any) {
  const list = Array.isArray(body?.songIds?.list) ? body.songIds.list : [];
  const fields: Record<string, unknown> = {
    title:
      typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled playlist",
    songIds: { list: list.filter((x: any) => typeof x === "string").slice(0, 200) },
  };
  // Public-share token: only a sane opaque id passes through; omitting the
  // field on update clears it (update replaces the whole item).
  if (typeof body.shareId === "string" && /^[A-Za-z0-9-]{16,64}$/.test(body.shareId)) {
    fields.shareId = body.shareId;
  }
  return fields;
}
