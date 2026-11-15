// /api/fixed-assets — Fixed Assets → Register (app/(pages)/accounting/fixed-assets).
//   GET  ?status=&category=&department=&search=&asOf=   register rows   (fixedAsset.manage)
//   POST { action: "backfill" }   register GRN asset units saved before the
//        register existed (no journals — their cost was booked then)   (fixedAsset.manage)
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { setAuditActor } from "@/lib/audit/context";
import { getFeatures } from "@/lib/features/server";
import { loadAssets, backfillFromGrns } from "@/lib/fixedAssets/register";
import { faResponse, actorOf } from "./_shared";

const int = (v) => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : null;
};

export const GET = guard("fixedAsset.manage", async (req, { session }) => {
  try {
    const url = new URL(req.url);
    const where = {};
    const status = url.searchParams.get("status");
    if (status && status !== "all") where.status = status;
    if (int(url.searchParams.get("category")) != null) where.ic_id = int(url.searchParams.get("category"));
    if (int(url.searchParams.get("department")) != null) where.department_id = int(url.searchParams.get("department"));
    const { assets, settings } = await loadAssets({ where, asOf: url.searchParams.get("asOf") || null });
    const term = (url.searchParams.get("search") || "").trim().toLowerCase();
    const rows = assets
      .filter((a) => !term || [a.asset_label, a.asset_no, a.item, a.category, a.department, a.employee, a.location].some((v) => String(v ?? "").toLowerCase().includes(term)))
      .map(({ lines, ...a }) => a);
    const [features, canDispose, canRun, canSettings] = await Promise.all([
      getFeatures(), can(session, "fixedAsset.dispose"), can(session, "fixedAsset.depreciation.run"), can(session, "settings.manage"),
    ]);
    const totals = rows.reduce((t, a) => ({ cost: t.cost + a.cost, accumulated: t.accumulated + a.accumulated, nbv: t.nbv + a.nbv }), { cost: 0, accumulated: 0, nbv: 0 });
    return NextResponse.json({
      data: rows,
      totals,
      settings,
      meta: {
        canDispose, canRun, canSettings,
        features: Object.fromEntries(Object.entries(features).filter(([k]) => k.startsWith("fixedAssets."))),
      },
    });
  } catch (error) {
    return faResponse(error, "GET");
  }
});

export const POST = guard("fixedAsset.manage", async (req, { session }) => {
  setAuditActor(session);
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "backfill") return NextResponse.json({ message: "Unknown action" }, { status: 400 });
    const res = await backfillFromGrns({ actor: actorOf(session) });
    return NextResponse.json({ message: `${res.registered} asset(s) registered from ${res.grns} GRN(s).`, ...res });
  } catch (error) {
    return faResponse(error, "POST");
  }
});
