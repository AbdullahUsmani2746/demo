// GET /api/manufacturing/fg-transfer  — list FG_TRANSFER requisitions
// PATCH /api/manufacturing/fg-transfer — accept / reject a requisition
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";
import { closedGodownError } from "@/lib/godowns";
import { recordScopeError } from "@/lib/auth/documentScope";
import { checkStockForSave } from "@/lib/stock/checkStock";

// ── GET: list all FG_TRANSFER requisitions, optionally filtered by status ──
export async function GET(req) {
  try {
    const url    = new URL(req.url);
    const status = url.searchParams.get("status") || "";  // Pending | Accepted | Rejected | ""
    const page   = Math.max(1, parseInt(url.searchParams.get("page")  || "1"));
    const limit  = Math.max(1, parseInt(url.searchParams.get("limit") || "20"));

    const where = {
      req_catagory: "FG_TRANSFER",
      ...(status && { status }),
    };

    const [rows, total] = await Promise.all([
      prisma.reqMaster.findMany({
        where,
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { tran_id: "desc" },
        include: {
          details: {
            include: { item: { select: { itcd: true, item: true, code: true, unit: true } } },
          },
          godownDetails:  { select: { id: true, godown: true } },   // issued_for (FG dept)
          godown2Details: { select: { id: true, godown: true } },   // issued_by  (prod floor)
        },
      }),
      prisma.reqMaster.count({ where }),
    ]);

    return NextResponse.json({ data: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("[fg-transfer] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── PATCH: accept or reject a single requisition ─────────────────────────────
// Body: { tran_id: number, action: "accept" | "reject" }
export const PATCH = guard("fgTransfer.create", async (req) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tran_id, action } = await req.json();
    if (!tran_id || !["accept", "reject"].includes(action)) {
      return NextResponse.json({ error: "tran_id and action (accept|reject) are required" }, { status: 400 });
    }

    const existing = await prisma.reqMaster.findUnique({
      where: { tran_id: parseInt(tran_id) },
      include: { details: true },
    });

    if (!existing)  return NextResponse.json({ error: "Requisition not found" }, { status: 404 });
    if (existing.req_catagory !== "FG_TRANSFER") {
      return NextResponse.json({ error: "Only FG_TRANSFER requisitions can be processed here" }, { status: 400 });
    }
    if (existing.status !== "Pending") {
      return NextResponse.json({ error: `Requisition is already ${existing.status}` }, { status: 409 });
    }

    const newStatus = action === "accept" ? "Accepted" : "Rejected";
    const now       = new Date();
    const warnings  = [];

    // Accepting posts a tran_code=11 transfer dated today
    if (action === "accept") {
      const lockError = await checkPeriodLock(now, 11, { action: "create" });
      if (lockError) return NextResponse.json({ error: lockError }, { status: 422 });

      // Posts godown 2 → 6 below; refuse if either has been closed
      const godownError = await closedGodownError([2, 6]);
      if (godownError) return NextResponse.json({ error: godownError }, { status: 422 });

      // Data scope (Admin → Permissions): either side must be the user's.
      const scopeError = await recordScopeError(session, "godown", [2, 6]);
      if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

      // Stock check policy "fgTransfer" (Settings → Stock checking): the
      // transfer takes the goods out of godown 2 (production floor).
      try {
        const { message } = await checkStockForSave({
          type: "fgTransfer",
          godown: 2,
          lines: existing.details.map((d) => ({ itcd: d.itcd, qty: d.qty })),
          where: "godown 2 (production floor)",
        });
        if (message) warnings.push(message);
      } catch (e) {
        if (e?.statusCode === 422) return NextResponse.json({ error: e.message }, { status: 422 });
        throw e;
      }
    }

    // Update master status + approval date
    await prisma.reqMaster.update({
      where: { tran_id: parseInt(tran_id) },
      data: {
        status:   newStatus,
        app_date: now,
      },
    });

    // When accepted: fill ap_qty + create tran_code=11 godown transfer (godown 2 → godown 6)
    if (action === "accept") {
      for (const d of existing.details) {
        await prisma.reqDetail.update({
          where: { id: d.id },
          data:  { ap_qty: d.qty },
        });
      }

      // Get next vr_no for tran_code 11 today
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const lastVoucher = await prisma.transactionsMaster.findFirst({
        where: {
          tran_code: 11,
          dated: { gte: todayStart, lt: todayEnd },
        },
        orderBy: { vr_no: "desc" },
        select:  { vr_no: true },
      });
      const vrNo = (lastVoucher?.vr_no ?? 0) + 1;

      // Create the godown transfer master (godown 2 = Prod Floor → godown 6 = FG)
      const transferMaster = await prisma.transactionsMaster.create({
        data: {
          company_id: 1,
          dated:      now,
          time:       now,
          tran_code:  11,
          vr_no:      vrNo,
          godown:     2,   // from: Production Floor
          godown2:    6,   // to:   FG godown
          req_no:     parseInt(tran_id),
          rmk:        `FG Transfer from Production Floor - Req #${tran_id}`,
          rmk5:       existing.plan_id ? String(existing.plan_id) : null,
          user_id:    session.user.id,
        },
      });

      // Create one Transactions line per detail
      const lines = existing.details
        .filter((d) => d.itcd != null && d.qty > 0)
        .map((d) => ({
          tran_id:    transferMaster.tran_id,
          itcd:       d.itcd,
          qty:        d.qty,
          godown:     2,
          narration1: `FG Transfer - Req #${tran_id}`,
          narration2: existing.plan_id ? `Process Order #${existing.plan_id}` : null,
        }));

      if (lines.length > 0) {
        await prisma.transactions.createMany({ data: lines });
      }
    }

    return NextResponse.json({ message: `Requisition ${newStatus.toLowerCase()} successfully`, tran_id, warnings });
  } catch (err) {
    console.error("[fg-transfer] PATCH error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
