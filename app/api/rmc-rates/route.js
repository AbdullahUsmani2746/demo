// app/api/rmc-rates/route.js
// ============================================================
// RMC Input Rates (/accounting/rmc-rates) — the company's own rate per raw /
// packing material for the RMC report's "Input Based" summary type. Feature
// "reports.rmcInputRates" (lib/rmc/inputRates.js); switched off → 403.
//
// GET  → { data: [{ itcd, code, item, normal_rate, input_rate, rate, updated_at, updated_by }], canEdit }
//        (report.rmc.view)
// PUT  { rates: [{ itcd, rate }] } → saves into RmcInputRate only (rmcRates.manage).
//        rate empty / null → the item's input rate is removed (back to the monthly rate).
// MonthlyOpeningRate is never written here.
// ============================================================
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { feature } from "@/lib/features/server";
import { RMC_INPUT_FEATURE } from "@/lib/rmc/inputRates";
import { getRmcRateItems } from "@/lib/reports/rmc";

const MANAGE = "rmcRates.manage";
const OFF = () =>
  NextResponse.json({ error: "RMC input rates are switched off (Settings → Features)." }, { status: 403 });

export const GET = guard("report.rmc.view", async (req, { session }) => {
  if (!(await feature(RMC_INPUT_FEATURE))) return OFF();
  const [data, canEdit] = await Promise.all([getRmcRateItems(), can(session, MANAGE)]);
  return NextResponse.json({ data, canEdit });
});

export const PUT = guard(MANAGE, async (request, { session }) => {
  if (!(await feature(RMC_INPUT_FEATURE))) return OFF();
  const { rates } = await request.json().catch(() => ({}));
  if (!Array.isArray(rates) || !rates.length) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  const toSave = [];
  const toClear = [];
  const errors = [];
  for (const r of rates) {
    const itcd = parseInt(r?.itcd, 10);
    if (!Number.isFinite(itcd)) continue;
    if (r.rate === "" || r.rate == null) {
      toClear.push(itcd);
      continue;
    }
    const rate = Number(r.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      errors.push(`Item ${itcd}: rate must be 0 or more`);
      continue;
    }
    toSave.push({ itcd, rate });
  }
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 422 });

  // Only the items the RMC report prices may get an input rate.
  const allowed = new Set((await getRmcRateItems()).map((i) => i.itcd));
  const foreign = toSave.filter((r) => !allowed.has(r.itcd)).map((r) => r.itcd);
  if (foreign.length) {
    return NextResponse.json(
      { error: `Item(s) ${foreign.join(", ")} are not raw / packing materials of an active BOM` },
      { status: 422 },
    );
  }

  const by = String(session?.user?.name || session?.user?.email || session?.user?.id || "").slice(0, 50) || null;
  await prisma.$transaction([
    ...toSave.map(({ itcd, rate }) =>
      prisma.rmcInputRate.upsert({
        where: { itcd },
        create: { itcd, rate, updated_by: by },
        update: { rate, updated_by: by },
      }),
    ),
    ...(toClear.length ? [prisma.rmcInputRate.deleteMany({ where: { itcd: { in: toClear } } })] : []),
  ]);

  return NextResponse.json({
    message: `Saved ${toSave.length} rate(s)${toClear.length ? `, ${toClear.length} back to the monthly rate` : ""}`,
    data: await getRmcRateItems(),
  });
});
