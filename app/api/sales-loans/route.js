import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import {
  seesAllLoans,
  loanScopeWhere,
  resolveLoanParties,
  shapeLoan,
  loadLookups,
  readLoanBody,
  checkReferences,
  parseDate,
  LOAN_INCLUDE,
  LOAN_STATUS,
} from "@/lib/salesLoans/core";

// ============================================================
// /api/sales-loans — Sales Loan Register (memo only, no stock/ledger effect)
// ============================================================
// GET  ?status=all|open|partial|returned|overdue|pending
//      &dateFrom&dateTo (issue date) &search &salesPerson &acno
//      → { data, summary, seesAll }
// POST { acno (FROM customer), to_acno (GIVEN TO customer), so_no?,
//        dispatch_tran_id?, issue_date, expected_return_date?, purpose?,
//        remarks?, lines: [{ itcd, qty_issued, unit? }] }
//      Goods out of the FROM customer's Sale Order / Dispatch are given to
//      the GIVEN TO customer, who returns them.
// Scope rules live in lib/salesLoans/core.js.
// ============================================================

export const GET = guard(null, async (req, { session }) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "all";
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const salesPerson = url.searchParams.get("salesPerson") || "";
    const acno = Number(url.searchParams.get("acno")) || null;
    const dateFrom = parseDate(url.searchParams.get("dateFrom"));
    const dateTo = parseDate(url.searchParams.get("dateTo"));
    if (dateFrom) dateFrom.setHours(0, 0, 0, 0);
    if (dateTo) dateTo.setHours(23, 59, 59, 999);

    const seesAll = await seesAllLoans(session);
    const and = [await loanScopeWhere(session)];
    // The filter can narrow a "see all" view to one sales person (either side
    // of the loan); it can never widen a sales person's own view.
    if (seesAll && salesPerson) {
      and.push({ OR: [{ sales_person: salesPerson }, { to_sales_person: salesPerson }] });
    }
    if (acno) and.push({ OR: [{ acno }, { to_acno: acno }] });
    if (dateFrom || dateTo) {
      and.push({
        issue_date: {
          ...(dateFrom ? { gte: dateFrom } : {}),
          ...(dateTo ? { lte: dateTo } : {}),
        },
      });
    }
    const where = { AND: and };

    const loans = await prisma.salesLoan.findMany({
      where,
      include: LOAN_INCLUDE,
      orderBy: [{ issue_date: "desc" }, { id: "desc" }],
    });

    const lookups = await loadLookups(loans);
    let data = loans.map((l) => shapeLoan(l, lookups));

    // Summary describes the whole scoped window, before the status tab and
    // the search box narrow the list.
    const summary = {
      total: data.length,
      open: data.filter((l) => l.status === LOAN_STATUS.OPEN).length,
      partial: data.filter((l) => l.status === LOAN_STATUS.PARTIAL).length,
      returned: data.filter((l) => l.status === LOAN_STATUS.RETURNED).length,
      overdue: data.filter((l) => l.overdue).length,
      qty_issued: data.reduce((s, l) => s + l.qty_issued, 0),
      qty_returned: data.reduce((s, l) => s + l.qty_returned, 0),
      qty_balance: data.reduce((s, l) => s + l.qty_balance, 0),
    };

    if (status === "pending") data = data.filter((l) => l.status !== LOAN_STATUS.RETURNED);
    else if (status === "overdue") data = data.filter((l) => l.overdue);
    else if (status !== "all") data = data.filter((l) => l.status === status.toUpperCase());

    if (search) {
      data = data.filter((l) =>
        [
          l.id,
          l.customer,
          l.acno,
          l.to_customer,
          l.to_acno,
          l.to_sales_person_name,
          l.so_no,
          l.dispatch_no,
          l.sales_person_name,
          l.purpose,
          l.remarks,
          ...l.lines.flatMap((x) => [x.itemName, x.itemCode]),
        ]
          .filter((v) => v !== null && v !== undefined)
          .some((v) => String(v).toLowerCase().includes(search)),
      );
    }

    return NextResponse.json({ data, summary, seesAll });
  } catch (error) {
    console.error("sales-loans GET error:", error);
    return NextResponse.json(
      { error: "Failed to load loans", detail: error.message },
      { status: 500 },
    );
  }
});

export const POST = guard(null, async (req, { session }) => {
  try {
    const body = await req.json();

    const parties = await resolveLoanParties(session, body);
    if (parties.error) {
      return NextResponse.json({ error: parties.error }, { status: parties.status });
    }
    const { from, to } = parties;

    const parsed = readLoanBody(body);
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // The Sale Order / Dispatch are the FROM customer's.
    const refError = await checkReferences({ acno: from.acno, ...parsed.data });
    if (refError) return NextResponse.json({ error: refError }, { status: 400 });

    const loan = await prisma.salesLoan.create({
      data: {
        ...parsed.data,
        acno: from.acno,
        // Each customer's own sales person sees the loan, even when a manager
        // records it on their behalf.
        sales_person: from.salesArea || session.user.id,
        to_acno: to.acno,
        to_sales_person: to.salesArea || null,
        created_by: session.user.id,
        lines: { create: parsed.lines },
      },
      include: LOAN_INCLUDE,
    });

    const lookups = await loadLookups([loan]);
    return NextResponse.json({ data: shapeLoan(loan, lookups) }, { status: 201 });
  } catch (error) {
    console.error("sales-loans POST error:", error);
    return NextResponse.json(
      { error: "Failed to save loan", detail: error.message },
      { status: 500 },
    );
  }
});
