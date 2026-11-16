// app/api/pos/orders/route.js — POS receipts.
//   GET  ?search=&from=&to=&kind=SALE|RETURN|ALL&limit=     receipts list (own receipts unless pos.allShifts)
//   POST { clientRef, lines, billDiscount, customer, payments, note }   ring up a sale (lib/pos/posting.js postSale)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { postSale, posRights, loadReceipt, POS_SALE, POS_RETURN } from "@/lib/pos/posting";
import { posErrorResponse, receiptScope, hasPosAccess } from "@/lib/pos/http";
import { getAccount } from "@/lib/accounts/accountSettings";

export const GET = guard(null, async (request, { session }) => {
  try {
    const rights = await posRights(session);
    if (!hasPosAccess(rights)) return NextResponse.json({ error: "No point of sale access." }, { status: 403 });
    const sp = new URL(request.url).searchParams;
    const search = (sp.get("search") || "").trim();
    const kind = (sp.get("kind") || "ALL").toUpperCase();
    const limit = Math.min(Math.max(parseInt(sp.get("limit")) || 50, 1), 500);

    // POS returns share tran_code 12 with Miscellaneous IN — only receipts made at the till (pos_receipts).
    const where = { tran_code: kind === "SALE" ? POS_SALE : kind === "RETURN" ? POS_RETURN : { in: [POS_SALE, POS_RETURN] }, ...receiptScope(session, rights) };
    const and = [];
    if (kind !== "SALE") {
      const retIds = await prisma.posReceipt.findMany({ where: { kind: "RETURN" }, select: { tran_id: true } });
      and.push({ OR: [{ tran_code: POS_SALE }, { tran_id: { in: retIds.map((r) => r.tran_id) } }] });
    }
    if (sp.get("from") || sp.get("to")) {
      const from = sp.get("from") ? new Date(sp.get("from")) : null;
      const to = sp.get("to") ? new Date(sp.get("to")) : null;
      if (from) from.setHours(0, 0, 0, 0);
      if (to) to.setHours(23, 59, 59, 999);
      where.dated = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }
    if (search) {
      const n = Number(search.replace(/^(POS|RET)-/i, ""));
      and.push({
        OR: [
          { invoice_no: { contains: search, mode: "insensitive" } },
          ...(Number.isInteger(n) && n > 0 ? [{ vr_no: n }] : []),
          { acno: { acname: { contains: search, mode: "insensitive" } } },
        ],
      });
    }
    if (and.length) where.AND = and;

    const rows = await prisma.transactionsMaster.findMany({
      where,
      orderBy: [{ dated: "desc" }, { tran_id: "desc" }],
      take: limit,
      select: { tran_id: true, tran_code: true, vr_no: true, invoice_no: true, dated: true, time: true, user_id: true, tr_amount: true, acno: { select: { acno: true, acname: true } } },
    });
    const ids = rows.map((r) => r.tran_id);
    const [receipts, payments, users, saleTotals] = await Promise.all([
      prisma.posReceipt.findMany({ where: { tran_id: { in: ids } } }),
      prisma.posPayment.findMany({ where: { tran_id: { in: ids } } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.user_id).filter(Boolean))] } }, select: { id: true, name: true } }),
      // Old POS sales (before pos_receipts): total from their lines.
      prisma.transactions.groupBy({ by: ["tran_id"], where: { tran_id: { in: ids }, sub_tran_id: 3 }, _sum: { damt: true, camt: true } }),
    ]);
    const rec = new Map(receipts.map((r) => [r.tran_id, r]));
    // A walk-in bill's party is the POS Cash / Card account — shown as walk-in, not as a customer.
    const till = new Set((await Promise.all([getAccount("pos_cash"), getAccount("pos_card")])).filter((a) => a != null));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const lineTotal = new Map(saleTotals.map((t) => [t.tran_id, Number(t._sum.damt || 0) || Number(t._sum.camt || 0)]));
    return NextResponse.json({
      receipts: rows.map((r) => {
        const x = rec.get(r.tran_id);
        return {
          tran_id: r.tran_id,
          tran_code: r.tran_code,
          kind: r.tran_code === POS_SALE ? "SALE" : "RETURN",
          vr_no: r.vr_no,
          invoice_no: r.invoice_no,
          dated: r.time || r.dated,
          customer: x ? x.customer_name || null : r.acno && !till.has(r.acno.acno) ? r.acno.acname : null,
          total: x?.total ?? r.tr_amount ?? lineTotal.get(r.tran_id) ?? null,
          methods: [...new Set(payments.filter((p) => p.tran_id === r.tran_id).map((p) => p.method))],
          entered_by: r.user_id ? userName.get(r.user_id) || null : "System",
          ref_tran_id: x?.ref_tran_id ?? null,
        };
      }),
    });
  } catch (error) {
    return posErrorResponse(error, "POS receipts");
  }
});

export const POST = guard("pos.sell", async (request, { session }) => {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const result = await postSale(session, body);
    const receipt = await loadReceipt(result.tran_id);
    return NextResponse.json({ ...result, receipt }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return posErrorResponse(error, "POS sale");
  }
});
