import type { APIRoute } from "astro";
import { items } from "@wix/data";
import { migrateSong } from "../../../lib/songModel";

// All tags across the caller's songbook — feeds the tag picker in the
// editor's song settings. Member-scoped like the other song routes.

export const GET: APIRoute = async () => {
  try {
    const res = await items.query("songs").limit(100).find();
    const seen = new Map<string, string>(); // lower → display casing (first wins)
    for (const s of res.items as any[]) {
      for (const t of migrateSong(s.sections).tags ?? []) {
        if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
      }
    }
    const tags = [...seen.values()].sort((a, b) => a.localeCompare(b));
    return new Response(JSON.stringify({ tags }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ tags: [] }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
};
