import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import {
  loanInScope,
  shapeLoan,
  loadLookups,
  parseDate,
  LOAN_INCLUDE,
} from "@/lib/salesLoans/core";

// ============================================================
// /api/sales-loans/[id]/returns
// ============================================================
// POST   { return_date, remarks?, lines: [{ line_id, qty }] }
//        Records goods coming back. A line can never be returned beyond what
//        is still out on it.
// DELETE ?returnId=  removes one return entry (a mistake), putting that qty
//        back on loan.
// ============================================================

const EPS = 1e-6;

export const POST = guard(null, async (req, { params, session }) => {
  try {
    const { id } = await params;
    const loan = await loanInScope(session, id, LOAN_INCLUDE);
    if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });

    const body = await req.json();
    const return_date = parseDate(body.return_date);
    if (!return_date) return NextResponse.json({ error: "Return date is required" }, { status: 400 });

    const issueDay = new Date(loan.issue_date);
    issueDay.setHours(0, 0, 0, 0);
    if (return_date < issueDay) {
      return NextResponse.json(
        { error: "Return date cannot be before the issue date" },
        { status: 400 },
      );
    }

    const lineById = new Map(loan.lines.map((l) => [l.id, l]));
    const rows = [];
    for (const r of Array.isArray(body.lines) ? body.lines : []) {
      const qty = Number(r.qty);
      if (!qty) continue;
      const line = lineById.get(Number(r.line_id));
      if (!line) return NextResponse.json({ error: "Unknown loan line" }, { status: 400 });
      if (!Number.isFinite(qty) || qty < 0) {
        return NextResponse.json({ error: "Return quantity must be greater than 0" }, { status: 400 });
      }
      const already = line.returns.reduce((s, x) => s + (Number(x.qty) || 0), 0);
      const balance = (Number(line.qty_issued) || 0) - already;
      if (qty > balance + EPS) {
        return NextResponse.json(
          { error: `Only ${Math.round(balance * 1000) / 1000} is still out on one of the items — cannot return ${qty}` },
          { status: 400 },
        );
      }
      rows.push({
        line_id: line.id,
        return_date,
        qty,
        remarks: body.remarks ? String(body.remarks).trim().slice(0, 500) || null : null,
        created_by: session.user.id,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "Enter a quantity for at least one item" }, { status: 400 });
    }

    await prisma.salesLoanReturn.createMany({ data: rows });

    const fresh = await prisma.salesLoan.findUnique({ where: { id: loan.id }, include: LOAN_INCLUDE });
    const lookups = await loadLookups([fresh]);
    return NextResponse.json({ data: shapeLoan(fresh, lookups) }, { status: 201 });
  } catch (error) {
    console.error("sales-loans return POST error:", error);
    return NextResponse.json(
      { error: "Failed to record return", detail: error.message },
      { status: 500 },
    );
  }
});

export const DELETE = guard(null, async (req, { params, session }) => {
  const { id } = await params;
  const loan = await loanInScope(session, id, LOAN_INCLUDE);
  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });

  const returnId = Number(new URL(req.url).searchParams.get("returnId"));
  const belongs = loan.lines.some((l) => l.returns.some((r) => r.id === returnId));
  if (!belongs) return NextResponse.json({ error: "Return entry not found" }, { status: 404 });

  await prisma.salesLoanReturn.delete({ where: { id: returnId } });
  return NextResponse.json({ success: true });
});
