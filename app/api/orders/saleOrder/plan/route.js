// /api/orders/saleOrder/plan — Sale Order line → dispatch Production Plan line
// (Features → Sale Order → "Plan production from the Sale Order line",
// saleOrder.planFromOrder; lib/orders/soPlan.js). Switched off: refused.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { setAuditActor } from "@/lib/audit/context";
import { feature } from "@/lib/features/server";
import { addSoPlanLines } from "@/lib/orders/soPlan";

const OFF = "Planning from the Sale Order is switched off (Settings → Features → Sale Order).";

// GET ?so_no=123 → the plan lines already made for that Sale Order, latest first.
export const GET = guard(null, async (req) => {
  const soNo = Number(new URL(req.url).searchParams.get("so_no")) || null;
  if (!soNo) return NextResponse.json({ data: [] });
  const rows = await prisma.reqDetail.findMany({
    where: { so_no: soNo, master: { req_catagory: "DISPATCH" } },
    select: { itcd: true, tran_id: true, dated: true, qty: true, nature: true },
    orderBy: { id: "desc" },
  });
  return NextResponse.json({ data: rows });
});

// POST { so_no, lines: [{ itcd, plan_date: "YYYY-MM-DD", plan_qty }] }
export const POST = guard("requisition.create", async (req, { session }) => {
  if (!(await feature("saleOrder.planFromOrder"))) return NextResponse.json({ message: OFF }, { status: 403 });
  setAuditActor(session);
  const body = await req.json().catch(() => ({}));
  const result = await addSoPlanLines({
    soNo: body?.so_no,
    lines: Array.isArray(body?.lines) ? body.lines : [],
    session,
  });
  return NextResponse.json(
    { message: result.message, tran_id: result.tran_id ?? null },
    { status: result.ok ? 200 : result.status },
  );
});
