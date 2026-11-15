// lib/hr/route.js — the wrapper every /api/hr route goes through.
//
//   export const GET = hrRoute([HR_PERMS.view], async (req, { session }) => …)
//
// Signed in (lib/auth/route.js guard), holding at least one of the codes, and
// errors answered the same way everywhere: a thrown error with a status < 500
// (validation, 403, 409) → { error } with that status; a duplicate → 409;
// anything else → 500, logged.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { requireAnyHr } from "@/lib/hr/access";

export function hrRoute(codes, handler) {
  return guard(null, async (req, ctx) => {
    try {
      if (codes?.length) await requireAnyHr(ctx.session, codes);
      return await handler(req, ctx);
    } catch (e) {
      if (e?.status && e.status < 500) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e?.code === "P2002") return NextResponse.json({ error: "That already exists." }, { status: 409 });
      console.error("[hr]", req.method, new URL(req.url).pathname, e);
      return NextResponse.json({ error: "Something went wrong on the server — try again, or tell IT if it keeps happening." }, { status: 500 });
    }
  });
}

/** Read a JSON body; an empty / broken body → 400. */
export async function jsonBody(req) {
  try {
    return await req.json();
  } catch {
    throw Object.assign(new Error("The request body is not valid JSON."), { status: 400 });
  }
}

/** Route param as an integer id, or a 400. */
export function intParam(v, label = "id") {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error(`Invalid ${label}.`), { status: 400 });
  return n;
}

/**
 * Refuse the request while a Settings → Features switch is off (CLAUDE.md
 * rule 16: a switched-off flow cannot happen through any request).
 */
export async function requireFeature(key) {
  const { feature, featureDef } = await import("@/lib/features/server");
  if (!(await feature(key))) {
    throw Object.assign(new Error(`“${featureDef(key)?.label ?? key}” is switched off (Settings → Features).`), { status: 403 });
  }
}
