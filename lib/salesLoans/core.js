import prisma from "@/lib/prisma";
import { seesAllSales, visibleSalesPersons } from "@/lib/auth/salesScope";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";

/* ══════════════════════════════════════════════════════════════════════
   SALES LOAN REGISTER — shared rules

   A memo register of goods a sales person lends to a customer and gets
   back. It has no effect on stock, the ledger or any report.

   WHO SEES WHAT — same rule as Sales Targets:
     · a sales person sees and records loans only for their own customers
       (ACNO.salesArea = their User.id)
     · a team lead (salesTeam.viewTeam) also sees their team's loans
     · anyone holding salesTeam.viewAll (and ADMIN / ACCOUNTANT) sees every
       sales person's loans.

   Managed on Permissions → Sales visibility (lib/auth/salesScope.js).
   ══════════════════════════════════════════════════════════════════════ */

export const seesAllLoans = seesAllSales;

/**
 * Prisma `where` for SalesLoan limited to what this session may see: loans
 * out of their own customer's order, and loans given to their own customer.
 */
export async function loanScopeWhere(session) {
  const visible = await visibleSalesPersons(session);
  if (visible === null) return {};
  return { OR: [{ sales_person: { in: visible } }, { to_sales_person: { in: visible } }] };
}

/**
 * The customer the goods are GIVEN TO. Any customer may receive a loan —
 * often one looked after by another sales person, who then sees it too.
 * Returns { acno, acname, salesArea } or null.
 */
export async function anyCustomer(acno) {
  const id = Number(acno);
  if (!Number.isFinite(id)) return null;
  return prisma.aCNO.findFirst({
    where: { acno: id, macno: { in: await getCustomerMacnos() } },
    select: { acno: true, acname: true, salesArea: true },
  });
}

/**
 * The customer this session may record a loan against, or null.
 * Returns { acno, acname, salesArea }.
 */
export async function customerInScope(session, acno) {
  const id = Number(acno);
  if (!Number.isFinite(id)) return null;
  const customer = await prisma.aCNO.findFirst({
    where: { acno: id, macno: { in: await getCustomerMacnos() } },
    select: { acno: true, acname: true, salesArea: true },
  });
  if (!customer) return null;
  if (await seesAllLoans(session)) return customer;
  return customer.salesArea === session?.user?.id ? customer : null;
}

/** One loan by id, or null when it does not exist or is out of scope. */
export async function loanInScope(session, id, include) {
  const loanId = Number(id);
  if (!Number.isFinite(loanId)) return null;
  return prisma.salesLoan.findFirst({
    where: { AND: [{ id: loanId }, await loanScopeWhere(session)] },
    ...(include ? { include } : {}),
  });
}

// ── status ────────────────────────────────────────────────────────────

export const LOAN_STATUS = {
  OPEN: "OPEN",         // nothing returned yet
  PARTIAL: "PARTIAL",   // some returned
  RETURNED: "RETURNED", // everything returned
};

const EPS = 1e-6;

export function lineStatus(issued, returned) {
  if (returned <= EPS) return LOAN_STATUS.OPEN;
  if (returned + EPS >= issued) return LOAN_STATUS.RETURNED;
  return LOAN_STATUS.PARTIAL;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Flatten a loan (with lines → returns) plus lookup maps into the shape the
 * page reads. Status and totals are derived here, never stored.
 */
export function shapeLoan(loan, { customers, users, items, orders, dispatches }) {
  const lines = (loan.lines ?? []).map((l) => {
    const returned = (l.returns ?? []).reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const issued = Number(l.qty_issued) || 0;
    const item = items.get(l.itcd);
    const lastReturn = (l.returns ?? [])
      .map((r) => r.return_date)
      .sort((a, b) => new Date(b) - new Date(a))[0];
    return {
      id: l.id,
      itcd: l.itcd,
      itemCode: item?.code ?? null,
      itemName: item?.item ?? `Item ${l.itcd}`,
      unit: l.unit || item?.unit || null,
      qty_issued: issued,
      qty_returned: Math.round(returned * 1000) / 1000,
      qty_balance: Math.max(0, Math.round((issued - returned) * 1000) / 1000),
      last_return_date: lastReturn ?? null,
      status: lineStatus(issued, returned),
      returns: (l.returns ?? [])
        .map((r) => ({
          id: r.id,
          return_date: r.return_date,
          qty: Number(r.qty) || 0,
          remarks: r.remarks,
          created_by: r.created_by,
          created_by_name: users.get(r.created_by) ?? null,
        }))
        .sort((a, b) => new Date(a.return_date) - new Date(b.return_date)),
    };
  });

  const issued = lines.reduce((s, l) => s + l.qty_issued, 0);
  const returned = lines.reduce((s, l) => s + l.qty_returned, 0);
  const status = lineStatus(issued, returned);
  const overdue =
    status !== LOAN_STATUS.RETURNED &&
    loan.expected_return_date &&
    new Date(loan.expected_return_date) < startOfToday();
  const allReturnDates = lines.map((l) => l.last_return_date).filter(Boolean);
  const customer = customers.get(loan.acno);
  const toCustomer = loan.to_acno ? customers.get(loan.to_acno) : null;
  const dispatch = loan.dispatch_tran_id ? dispatches.get(loan.dispatch_tran_id) : null;

  return {
    id: loan.id,
    // FROM: the customer whose Sale Order / Dispatch the goods come out of
    acno: loan.acno,
    customer: customer?.acname ?? `Customer ${loan.acno}`,
    sales_person: loan.sales_person,
    sales_person_name: users.get(loan.sales_person) ?? null,
    // GIVEN TO: the customer who receives the goods and returns them
    to_acno: loan.to_acno,
    to_customer: loan.to_acno ? toCustomer?.acname ?? `Customer ${loan.to_acno}` : null,
    to_sales_person: loan.to_sales_person,
    to_sales_person_name: users.get(loan.to_sales_person) ?? null,
    so_no: loan.so_no,
    so_date: loan.so_no ? orders.get(loan.so_no)?.dated ?? null : null,
    dispatch_tran_id: loan.dispatch_tran_id,
    dispatch_no: dispatch ? dispatch.dispatch_no ?? dispatch.vr_no ?? dispatch.tran_id : null,
    dispatch_date: dispatch?.dated ?? null,
    issue_date: loan.issue_date,
    expected_return_date: loan.expected_return_date,
    last_return_date: allReturnDates.sort((a, b) => new Date(b) - new Date(a))[0] ?? null,
    purpose: loan.purpose,
    remarks: loan.remarks,
    created_by: loan.created_by,
    created_by_name: users.get(loan.created_by) ?? null,
    created_at: loan.created_at,
    qty_issued: Math.round(issued * 1000) / 1000,
    qty_returned: Math.round(returned * 1000) / 1000,
    qty_balance: Math.max(0, Math.round((issued - returned) * 1000) / 1000),
    status,
    overdue: Boolean(overdue),
    hasReturns: lines.some((l) => l.returns.length > 0),
    lines,
  };
}

/** Fetch every name a set of loans refers to, in five queries. */
export async function loadLookups(loans) {
  const acnos = new Set();
  const userIds = new Set();
  const itcds = new Set();
  const soNos = new Set();
  const dispatchIds = new Set();
  for (const loan of loans) {
    acnos.add(loan.acno);
    if (loan.to_acno) acnos.add(loan.to_acno);
    if (loan.sales_person) userIds.add(loan.sales_person);
    if (loan.to_sales_person) userIds.add(loan.to_sales_person);
    if (loan.created_by) userIds.add(loan.created_by);
    if (loan.so_no) soNos.add(loan.so_no);
    if (loan.dispatch_tran_id) dispatchIds.add(loan.dispatch_tran_id);
    for (const l of loan.lines ?? []) {
      itcds.add(l.itcd);
      for (const r of l.returns ?? []) if (r.created_by) userIds.add(r.created_by);
    }
  }

  const [customers, users, items, orders, dispatches] = await Promise.all([
    acnos.size
      ? prisma.aCNO.findMany({ where: { acno: { in: [...acnos] } }, select: { acno: true, acname: true } })
      : [],
    userIds.size
      ? prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
      : [],
    itcds.size
      ? prisma.item.findMany({ where: { itcd: { in: [...itcds] } }, select: { itcd: true, item: true, code: true, unit: true } })
      : [],
    soNos.size
      ? prisma.orderMaster.findMany({ where: { order_no: { in: [...soNos] } }, select: { order_no: true, dated: true } })
      : [],
    dispatchIds.size
      ? prisma.transactionsMaster.findMany({
          where: { tran_id: { in: [...dispatchIds] }, tran_code: 6 },
          select: { tran_id: true, dispatch_no: true, vr_no: true, dated: true },
        })
      : [],
  ]);

  return {
    customers: new Map(customers.map((c) => [c.acno, c])),
    users: new Map(users.map((u) => [u.id, u.name])),
    items: new Map(items.map((i) => [i.itcd, i])),
    orders: new Map(orders.map((o) => [o.order_no, o])),
    dispatches: new Map(dispatches.map((d) => [d.tran_id, d])),
  };
}

export const LOAN_INCLUDE = { lines: { include: { returns: true } } };

// ── validation ────────────────────────────────────────────────────────

export function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Validate and normalise the header + lines of a create/update body.
 * Returns { data, lines } or { error }.
 */
export function readLoanBody(body) {
  const issue_date = parseDate(body.issue_date);
  if (!issue_date) return { error: "Issue date is required" };

  const expected_return_date = parseDate(body.expected_return_date);
  if (expected_return_date && expected_return_date < issue_date) {
    return { error: "Expected return date cannot be before the issue date" };
  }

  const so_no = body.so_no ? Number(body.so_no) : null;
  const dispatch_tran_id = body.dispatch_tran_id ? Number(body.dispatch_tran_id) : null;
  if (so_no !== null && !Number.isFinite(so_no)) return { error: "Invalid Sale Order" };
  if (dispatch_tran_id !== null && !Number.isFinite(dispatch_tran_id)) {
    return { error: "Invalid Dispatch" };
  }

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines = [];
  for (const [i, l] of rawLines.entries()) {
    const itcd = Number(l.itcd);
    const qty = Number(l.qty_issued);
    if (!Number.isFinite(itcd) && !l.qty_issued) continue; // blank row
    if (!Number.isFinite(itcd)) return { error: `Line ${i + 1}: select an item` };
    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: `Line ${i + 1}: quantity must be greater than 0` };
    }
    lines.push({ itcd, qty_issued: qty, unit: l.unit ? String(l.unit).slice(0, 25) : null });
  }
  if (lines.length === 0) return { error: "Add at least one item" };

  return {
    data: {
      issue_date,
      expected_return_date,
      so_no,
      dispatch_tran_id,
      purpose: body.purpose ? String(body.purpose).trim().slice(0, 500) || null : null,
      remarks: body.remarks ? String(body.remarks).trim().slice(0, 1000) || null : null,
    },
    lines,
  };
}

/**
 * Resolve both customers of a loan for the caller. The FROM customer must be
 * one of the caller's own; the GIVEN TO customer may be anyone's, but not the
 * same account. Returns { from, to } or { error, status }.
 */
export async function resolveLoanParties(session, { acno, to_acno }) {
  const from = await customerInScope(session, acno);
  if (!from) return { error: "Select one of your own customers as the From customer", status: 403 };
  const to = await anyCustomer(to_acno);
  if (!to) return { error: "Select the customer the goods are given to", status: 400 };
  if (to.acno === from.acno) {
    return { error: "From and Given To must be two different customers", status: 400 };
  }
  return { from, to };
}

/**
 * The Sale Order / Dispatch referenced must belong to the loan's customer —
 * otherwise a loan could point at somebody else's paperwork.
 */
export async function checkReferences({ acno, so_no, dispatch_tran_id }) {
  if (so_no) {
    const so = await prisma.orderMaster.findFirst({
      where: { order_no: so_no, order_catagory: 6 },
      select: { party_code: true },
    });
    if (!so) return `Sale Order ${so_no} not found`;
    if (so.party_code !== acno) return `Sale Order ${so_no} belongs to another customer`;
  }
  if (dispatch_tran_id) {
    const d = await prisma.transactionsMaster.findFirst({
      where: { tran_id: dispatch_tran_id, tran_code: 6 },
      select: { pycd: true },
    });
    if (!d) return "Dispatch not found";
    if (d.pycd !== acno) return "That dispatch belongs to another customer";
  }
  return null;
}
