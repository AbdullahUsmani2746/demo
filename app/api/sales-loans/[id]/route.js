import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import {
  loanInScope,
  resolveLoanParties,
  shapeLoan,
  loadLookups,
  readLoanBody,
  checkReferences,
  LOAN_INCLUDE,
} from "@/lib/salesLoans/core";

// ============================================================
// /api/sales-loans/[id]
// ============================================================
// GET     one loan
// PUT     edit it. Header fields can always change. The items can only be
//         replaced while nothing has been returned against them — after the
//         first return the lines are fixed, so returns never point at a line
//         that no longer exists.
// DELETE  only while nothing has been returned.
// ============================================================

const notFound = () => NextResponse.json({ error: "Loan not found" }, { status: 404 });

export const GET = guard(null, async (req, { params, session }) => {
  const { id } = await params;
  const loan = await loanInScope(session, id, LOAN_INCLUDE);
  if (!loan) return notFound();
  const lookups = await loadLookups([loan]);
  return NextResponse.json({ data: shapeLoan(loan, lookups) });
});

export const PUT = guard(null, async (req, { params, session }) => {
  try {
    const { id } = await params;
    const loan = await loanInScope(session, id, LOAN_INCLUDE);
    if (!loan) return notFound();

    const body = await req.json();
    const hasReturns = loan.lines.some((l) => l.returns.length > 0);

    // Either customer can change only while nothing is returned. A change is
    // checked exactly like a new loan: FROM must be the caller's own
    // customer, GIVEN TO any other customer.
    let acno = loan.acno;
    let salesPerson = loan.sales_person;
    let toAcno = loan.to_acno;
    let toSalesPerson = loan.to_sales_person;
    const fromChanged = body.acno && Number(body.acno) !== loan.acno;
    const toChanged = body.to_acno && Number(body.to_acno) !== loan.to_acno;
    if (fromChanged || toChanged) {
      if (hasReturns) {
        return NextResponse.json(
          { error: "Customers cannot change after goods have been returned" },
          { status: 422 },
        );
      }
      const parties = await resolveLoanParties(session, {
        acno: body.acno ?? loan.acno,
        to_acno: body.to_acno ?? loan.to_acno,
      });
      if (parties.error) {
        return NextResponse.json({ error: parties.error }, { status: parties.status });
      }
      acno = parties.from.acno;
      salesPerson = parties.from.salesArea || salesPerson;
      toAcno = parties.to.acno;
      toSalesPerson = parties.to.salesArea || null;
    }

    // Lines are optional on an edit: without them, the existing ones stand.
    const parsed = readLoanBody({
      ...body,
      lines: body.lines ?? loan.lines.map((l) => ({ itcd: l.itcd, qty_issued: l.qty_issued, unit: l.unit })),
    });
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const refError = await checkReferences({ acno, ...parsed.data });
    if (refError) return NextResponse.json({ error: refError }, { status: 400 });

    const replaceLines = Array.isArray(body.lines);
    if (replaceLines && hasReturns) {
      return NextResponse.json(
        { error: "Items cannot change after goods have been returned — delete the returns first" },
        { status: 422 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.salesLoan.update({
        where: { id: loan.id },
        data: {
          ...parsed.data,
          acno,
          sales_person: salesPerson,
          to_acno: toAcno,
          to_sales_person: toSalesPerson,
        },
      });
      if (replaceLines) {
        await tx.salesLoanLine.deleteMany({ where: { loan_id: loan.id } });
        await tx.salesLoanLine.createMany({
          data: parsed.lines.map((l) => ({ ...l, loan_id: loan.id })),
        });
      }
    });

    const fresh = await prisma.salesLoan.findUnique({ where: { id: loan.id }, include: LOAN_INCLUDE });
    const lookups = await loadLookups([fresh]);
    return NextResponse.json({ data: shapeLoan(fresh, lookups) });
  } catch (error) {
    console.error("sales-loans PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update loan", detail: error.message },
      { status: 500 },
    );
  }
});

export const DELETE = guard(null, async (req, { params, session }) => {
  const { id } = await params;
  const loan = await loanInScope(session, id, LOAN_INCLUDE);
  if (!loan) return notFound();
  if (loan.lines.some((l) => l.returns.length > 0)) {
    return NextResponse.json(
      { error: "This loan has returns recorded — delete the returns first" },
      { status: 422 },
    );
  }
  await prisma.salesLoan.delete({ where: { id: loan.id } });
  return NextResponse.json({ success: true });
});
