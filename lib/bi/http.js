// lib/bi/http.js — turn BI errors into JSON responses for app/api/bi/*.
import { NextResponse } from "next/server";
import { BiError } from "./engine";
import { assertBiReady, canDesign } from "./access";

export const biJson = (data, status = 200) => NextResponse.json(data, { status });

/** Wrap a guarded handler: BiError → its status; anything else → 500. */
export function bi(handler, { design = false } = {}) {
  return async (req, ctx) => {
    try {
      assertBiReady();
      if (design && !(await canDesign(ctx.session))) {
        return biJson({ error: "You do not have the BI Designer right (bi.design)." }, 403);
      }
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof BiError) return biJson({ error: e.message }, e.status);
      console.error("[bi]", e);
      return biJson({ error: e.message || "BI request failed" }, 500);
    }
  };
}

/** Parse + validate a numeric route id. */
export async function routeId(ctx) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) throw new BiError("Invalid id.");
  return n;
}
