import type { APIRoute } from "astro";
import { members } from "@wix/members";

// Who am I — feeds the SPA's client-side auth gate and greeting.

export const GET: APIRoute = async () => {
  let member: { nickname?: string; email?: string } | null = null;
  try {
    const res = await members.getCurrentMember({ fieldsets: ["FULL"] });
    if (res.member) {
      member = {
        nickname: res.member.profile?.nickname ?? undefined,
        email: res.member.loginEmail ?? undefined,
      };
    }
  } catch {
    // anonymous — member stays null
  }
  return new Response(JSON.stringify({ member }), {
    headers: { "Content-Type": "application/json" },
  });
};
