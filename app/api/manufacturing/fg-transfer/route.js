// GET /api/manufacturing/fg-transfer  — list FG_TRANSFER requisitions
// PATCH /api/manufacturing/fg-transfer — accept / reject a requisition (or, with
// "fgTransfer.partialAcceptance", part of it / its remaining balance)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/auth/route";
import { checkPeriodLock } from "@/lib/periodLock";
import { closedGodownError } from "@/lib/godowns";
import { recordScopeError } from "@/lib/auth/documentScope";
import { checkStockForSave } from "@/lib/stock/checkStock";
import { getProductionSetup } from "@/lib/production/setup";
import { feature } from "@/lib/features/server";

const EPSILON = 0.001;
const remainingOf = (d) => (Number(d.qty) || 0) - (d.ap_qty ?? 0) - (d.rejected_qty ?? 0);

// Status from the lines (fgTransfer.partialAcceptance): Pending → Partial →
// Accepted / Rejected / Closed (part accepted, the rest rejected).
function deriveStatus(details) {
  let accepted = false, rejected = false, open = false;
  for (const d of details) {
    if ((d.ap_qty ?? 0) > EPSILON) accepted = true;
    if ((d.rejected_qty ?? 0) > EPSILON) rejected = true;
    if (remainingOf(d) > EPSILON) open = true;
  }
  if (!accepted && !rejected) return "Pending";
  if (open) return "Partial";
  if (accepted && rejected) return "Closed";
  return rejected ? "Rejected" : "Accepted";
}

// ── GET: list all FG_TRANSFER requisitions, optionally filtered by status ──
export async function GET(req) {
  try {
    const url    = new URL(req.url);
    const status = url.searchParams.get("status") || "";  // Pending | Partial | Accepted | Rejected | Closed | ""
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

    return NextResponse.json({ data: rows.map((r) => ({ ...r, details: (r.details || []).map((d) => ({ ...d, remainingQty: Math.max(0, remainingOf(d)) })) })), total, page, limit, totalPages: Math.ceil(total / limit) });
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

    const { tran_id, action, lines: lineRequests } = await req.json();
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
    // Settings → Features "fgTransfer.partialAcceptance" (ported from Accounting):
    // on → accept part of the remaining balance (each acceptance posts its own
    // transfer) and reject the rest (ReqDetail.rejected_qty); Partial stays open.
    // off → the whole requisition is accepted or rejected, as before.
    const partial = await feature("fgTransfer.partialAcceptance");
    const openStatuses = partial ? ["Pending", "Partial"] : ["Pending"];
    if (!openStatuses.includes(existing.status)) {
      return NextResponse.json({ error: `Requisition is already ${existing.status}` }, { status: 409 });
    }

    // The requisition names both godowns (issued_by → issued_for); one
    // without them uses Settings → Production setup (production godown →
    // "FG transfer to").
    const setup = await getProductionSetup();
    const fromGodown = existing.issued_by ?? setup.productionGodown;
    const toGodown = existing.issued_for ?? setup.fgTransferGodown;

    const now       = new Date();
    const warnings  = [];

    // What this action accepts: [{ detail, qty }]
    let targets = [];
    if (action === "accept") {
      if (!partial) {
        targets = existing.details.map((d) => ({ detail: d, qty: d.qty }));
      } else if (Array.isArray(lineRequests) && lineRequests.length) {
        for (const line of lineRequests) {
          const detail = existing.details.find((d) => d.id === parseInt(line?.detail_id));
          if (!detail) {
            return NextResponse.json({ error: `Line ${line?.detail_id} is not on this requisition` }, { status: 400 });
          }
          const remaining = remainingOf(detail);
          const qty = parseFloat(line.qty);
          if (!(qty > 0) || qty > remaining + EPSILON) {
            return NextResponse.json({ error: `Accept qty for item #${detail.itcd} must be more than 0 and at most ${remaining}` }, { status: 422 });
          }
          targets.push({ detail, qty });
        }
      } else {
        targets = existing.details.filter((d) => remainingOf(d) > EPSILON).map((d) => ({ detail: d, qty: remainingOf(d) }));
      }
      if (!targets.some((t) => t.qty > 0)) {
        return NextResponse.json({ error: "Nothing left to accept on this requisition" }, { status: 422 });
      }
    }

    // Accepting posts a tran_code=11 transfer dated today
    if (action === "accept") {
      const lockError = await checkPeriodLock(now, 11, { action: "create" });
      if (lockError) return NextResponse.json({ error: lockError }, { status: 422 });

      // Posts fromGodown → toGodown below; refuse if either has been closed
      const godownError = await closedGodownError([fromGodown, toGodown]);
      if (godownError) return NextResponse.json({ error: godownError }, { status: 422 });

      // Data scope (Admin → Permissions): either side must be the user's.
      const scopeError = await recordScopeError(session, "godown", [fromGodown, toGodown]);
      if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

      // Stock check policy "fgTransfer" (Settings → Stock checking): the
      // transfer takes the goods out of the issuing godown.
      try {
        const { message } = await checkStockForSave({
          type: "fgTransfer",
          godown: fromGodown,
          lines: targets.map((t) => ({ itcd: t.detail.itcd, qty: t.qty })),
          where: `godown ${fromGodown}`,
        });
        if (message) warnings.push(message);
      } catch (e) {
        if (e?.statusCode === 422) return NextResponse.json({ error: e.message }, { status: 422 });
        throw e;
      }
    }

    // When accepted: fill ap_qty + create tran_code=11 godown transfer (fromGodown → toGodown)
    if (action === "accept") {
      for (const t of targets) {
        await prisma.reqDetail.update({
          where: { id: t.detail.id },
          data:  { ap_qty: partial ? (t.detail.ap_qty ?? 0) + t.qty : t.qty },
        });
      }
      const isPart = partial && existing.details.some((d) => {
        const t = targets.find((x) => x.detail.id === d.id);
        return remainingOf(d) - (t ? t.qty : 0) > EPSILON;
      });
      const tag = isPart ? " (Partial)" : "";

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

      // Create the godown transfer master (issuing godown → receiving godown)
      const transferMaster = await prisma.transactionsMaster.create({
        data: {
          company_id: 1,
          dated:      now,
          time:       now,
          tran_code:  11,
          vr_no:      vrNo,
          godown:     fromGodown,
          godown2:    toGodown,
          req_no:     parseInt(tran_id),
          rmk:        `FG Transfer from Production Floor - Req #${tran_id}${tag}`,
          rmk5:       existing.plan_id ? String(existing.plan_id) : null,
          user_id:    session.user.id,
        },
      });

      // One Transactions line per accepted detail
      const lines = targets
        .filter((t) => t.detail.itcd != null && t.qty > 0)
        .map((t) => ({
          tran_id:    transferMaster.tran_id,
          itcd:       t.detail.itcd,
          qty:        t.qty,
          godown:     fromGodown,
          narration1: `FG Transfer - Req #${tran_id}${tag}`,
          narration2: existing.plan_id ? `Process Order #${existing.plan_id}` : null,
        }));

      if (lines.length > 0) {
        await prisma.transactions.createMany({ data: lines });
      }
    } else if (partial) {
      // Reject the remaining balance — of the lines asked for, or of every line
      const ids = Array.isArray(lineRequests) && lineRequests.length
        ? lineRequests.map((l) => parseInt(l?.detail_id))
        : existing.details.map((d) => d.id);
      for (const d of existing.details) {
        const remaining = remainingOf(d);
        if (!ids.includes(d.id) || remaining <= EPSILON) continue;
        await prisma.reqDetail.update({
          where: { id: d.id },
          data:  { rejected_qty: (d.rejected_qty ?? 0) + remaining },
        });
      }
    }

    // Status: whole accept / reject (off), or from the lines' state (on)
    let newStatus = action === "accept" ? "Accepted" : "Rejected";
    if (partial) {
      const refreshed = await prisma.reqDetail.findMany({ where: { tran_id: parseInt(tran_id) } });
      newStatus = deriveStatus(refreshed.length ? refreshed : existing.details);
    }
    await prisma.reqMaster.update({
      where: { tran_id: parseInt(tran_id) },
      data: {
        status:   newStatus,
        app_date: now,
      },
    });

    return NextResponse.json({ message: `Requisition ${newStatus.toLowerCase()} successfully`, tran_id, status: newStatus, warnings });
  } catch (err) {
    console.error("[fg-transfer] PATCH error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
