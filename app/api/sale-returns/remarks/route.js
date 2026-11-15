import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import {
  REASON,
  SR_STATUS,
  seesAllSaleReturns,
  scopedCustomerAcnos,
  saleReturnInScope,
  loadSaleReturns,
  parseDate,
} from "@/lib/saleReturns/remarks";

// ============================================================
// /api/sale-returns/remarks — the sales person's reason for a Sale Return
// ============================================================
// GET  ?filter=all|none|commercial|technical|pending|approved|rejected
//      &dateFrom&dateTo (return date) &search &salesPerson
//      → { data, summary, seesAll }
// POST { tran_id, reason_type: TECHNICAL|COMMERCIAL, remarks }
//      COMMERCIAL → saved, nothing else.
//      TECHNICAL  → saved as PENDING; the approvers are notified.
//      Refused once a Technical reason has been approved.
// Rules: lib/saleReturns/remarks.js
// ============================================================

export const GET = guard(null, async (req, { session }) => {
  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "all";
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const salesPerson = url.searchParams.get("salesPerson") || "";
    const dateFrom = parseDate(url.searchParams.get("dateFrom"));
    const dateTo = parseDate(url.searchParams.get("dateTo"));
    if (dateFrom) dateFrom.setHours(0, 0, 0, 0);
    if (dateTo) dateTo.setHours(23, 59, 59, 999);

    const seesAll = await seesAllSaleReturns(session);
    const acnos = await scopedCustomerAcnos(session);

    let data = await loadSaleReturns({ acnos, dateFrom, dateTo });
    // The filter can narrow a "see all" view to one sales person; it can
    // never widen a sales person's own view.
    if (seesAll && salesPerson) data = data.filter((r) => r.sales_person === salesPerson);

    // Summary describes the whole scoped window, before the tab and search.
    const summary = {
      total: data.length,
      none: data.filter((r) => !r.reason_type).length,
      commercial: data.filter((r) => r.reason_type === REASON.COMMERCIAL).length,
      technical: data.filter((r) => r.reason_type === REASON.TECHNICAL).length,
      pending: data.filter((r) => r.status === SR_STATUS.PENDING).length,
      approved: data.filter((r) => r.status === SR_STATUS.APPROVED).length,
      rejected: data.filter((r) => r.status === SR_STATUS.REJECTED).length,
    };

    if (filter === "none") data = data.filter((r) => !r.reason_type);
    else if (filter === "commercial") data = data.filter((r) => r.reason_type === REASON.COMMERCIAL);
    else if (filter === "technical") data = data.filter((r) => r.reason_type === REASON.TECHNICAL);
    else if (filter !== "all") data = data.filter((r) => r.status === filter.toUpperCase());

    if (search) {
      data = data.filter((r) =>
        [
          r.vr_no,
          r.tran_id,
          r.customer,
          r.acno,
          r.invoice_no,
          r.sales_person_name,
          r.remarks,
          ...r.lines.flatMap((l) => [l.item, l.code]),
        ]
          .filter((v) => v !== null && v !== undefined)
          .some((v) => String(v).toLowerCase().includes(search)),
      );
    }

    return NextResponse.json({ data, summary, seesAll });
  } catch (error) {
    console.error("sale-returns/remarks GET error:", error);
    return NextResponse.json(
      { error: "Failed to load sale returns", detail: error.message },
      { status: 500 },
    );
  }
});

export const POST = guard(null, async (req, { session }) => {
  try {
    const { tran_id, reason_type, remarks } = await req.json();

    const reason = String(reason_type || "").toUpperCase();
    if (reason !== REASON.TECHNICAL && reason !== REASON.COMMERCIAL) {
      return NextResponse.json({ error: "Select Technical or Commercial reason" }, { status: 400 });
    }
    const text = String(remarks ?? "").trim().slice(0, 1000);
    if (!text) {
      return NextResponse.json({ error: "Write the reason in remarks" }, { status: 400 });
    }

    const sr = await saleReturnInScope(session, tran_id);
    if (!sr) {
      return NextResponse.json(
        { error: "Sale return not found, or it is not one of your customers" },
        { status: 404 },
      );
    }

    const existing = await prisma.saleReturnRemark.findUnique({ where: { tran_id: sr.tran_id } });
    // No approval any more, so nothing is locked by one.
    // if (existing?.reason_type === REASON.TECHNICAL && existing.status === SR_STATUS.APPROVED) {
    //   return NextResponse.json(
    //     { error: "This Technical reason is already approved — it cannot be changed" },
    //     { status: 422 },
    //   );
    // }

    // Technical and Commercial are both just saved — no approval. saleReturn.approve
    // holders are notified and see it on the remarks list page.
    const data = {
      reason_type: reason,
      remarks: text,
      // status: reason === REASON.TECHNICAL ? SR_STATUS.PENDING : null,
      status: null,
      entered_by: session.user.id,
      entered_at: new Date(),
      decided_by: null,
      decided_at: null,
      decision_remarks: null,
    };

    if (existing) {
      await prisma.saleReturnRemark.update({ where: { tran_id: sr.tran_id }, data });
    } else {
      await prisma.saleReturnRemark.create({ data: { tran_id: sr.tran_id, ...data } });
    }

    return NextResponse.json({
      success: true,
      // message:
      //   reason === REASON.TECHNICAL
      //     ? `Sale Return #${sr.vr_no ?? sr.tran_id} sent for approval`
      //     : `Remarks saved for Sale Return #${sr.vr_no ?? sr.tran_id}`,
      message: `Remarks saved for Sale Return #${sr.vr_no ?? sr.tran_id}`,
    });
  } catch (error) {
    console.error("sale-returns/remarks POST error:", error);
    return NextResponse.json(
      { error: "Failed to save remarks", detail: error.message },
      { status: 500 },
    );
  }
});
