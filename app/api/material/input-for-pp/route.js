// app/api/material/input-for-pp/route.js
// ============================================================
// Planned quantities (INPUT_FOR_PP) — Production → Planned Quantities.
// A planning input for the Production Planning report (lib/production/plannedQuantities.js).
//
// GET ?year=2026[&period_type=MONTHLY|QUARTERLY] → { data, canEdit }   (report.productionPlanning.view)
// PUT { entries: [{ itcd, period_type, month?, quarter?, year, qty }] } (plannedQty.manage)
//     qty empty / null removes that entry. Many rows at once = the bulk save.
// ============================================================
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import {
  PLANNED_QTY_MANAGE, listPlannedQuantities, plannedEntry, savePlannedQuantities,
} from "@/lib/production/plannedQuantities";

export const GET = guard("report.productionPlanning.view", async (req, { session }) => {
  const params = new URL(req.url).searchParams;
  const year = parseInt(params.get("year") || String(new Date().getFullYear()), 10);
  const pt = String(params.get("period_type") || "").toUpperCase();
  const [data, canEdit] = await Promise.all([
    listPlannedQuantities({ year, periodType: ["MONTHLY", "QUARTERLY"].includes(pt) ? pt : undefined }),
    can(session, PLANNED_QTY_MANAGE),
  ]);
  return NextResponse.json({ data, canEdit });
});

export const PUT = guard(PLANNED_QTY_MANAGE, async (request) => {
  const { entries } = await request.json().catch(() => ({}));
  if (!Array.isArray(entries) || !entries.length) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  if (entries.length > 5000) return NextResponse.json({ error: "At most 5000 entries per save" }, { status: 400 });
  const rows = [];
  const errors = [];
  entries.forEach((e, i) => {
    const r = plannedEntry(e);
    if (typeof r === "string") errors.push(`Row ${i + 1}: ${r}`);
    else rows.push(r);
  });
  if (errors.length) return NextResponse.json({ error: errors.slice(0, 20).join("; ") }, { status: 422 });
  const { saved, removed } = await savePlannedQuantities(rows);
  return NextResponse.json({ message: `Saved ${saved} planned quantit${saved === 1 ? "y" : "ies"}${removed ? `, removed ${removed}` : ""}` });
});
