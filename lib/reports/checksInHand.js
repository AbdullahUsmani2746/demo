import prisma from "@/lib/prisma";
import {
  CHECK_STATUS,
  CHECK_STATUSES,
  normalizeBank,
  startOfDay,
  endOfDay,
  toNumber,
  deriveCategory,
  categoryWhere,
} from "@/lib/accounts/checksInHand";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";

// ─────────────────────────────────────────────────────────────────────────────
//  Checks In Hand Report
//
//  Reproduces the legacy "CHECKS IN HAND" printout: post-dated / undeposited
//  customer cheques held by the company, grouped and subtotalled.
//
//  Filters
//    dateFrom / dateTo   - the range itself
//    dateField           - WHICH date the range applies to. Defaults to
//                          chqDate, the date printed on the cheque, which is
//                          what the legacy report's "01-JAN-26 TO 24-AUG-26"
//                          header ranges over. The other three dates a cheque
//                          carries are genuinely different sets - on this data
//                          a Jan-Aug 2026 range matches 900 rows by cheque
//                          date but 960 by entry/received date - so the basis
//                          is picked explicitly rather than assumed:
//                            chqDate    - printed on the cheque (default)
//                            chqRcvDate - physically received
//                            depDate    - deposited (Cleared cheques only;
//                                         Pending ones have no deposit date
//                                         and drop out of the range)
//                            dated      - entry/voucher date
//    customer            - single ACNO, or all
//    reportBase          - "salesPerson" (default) | "date"
//    status              - "all" (default) | PENDING | CLEARED
//    category            - dual book: "all" (default) | "active" (Official) |
//                          "inactive" (Unofficial). ACNO.isActive is the flag -
//                          true is the official book ("SEGMENT: E" on the
//                          legacy header), false is unofficial.
//
//  Sales Person is not stored on the cheque - it is the salesperson who owns
//  the customer (ACNO.salesArea -> User.name), same derivation the Sales Team
//  MIS report uses. Customers with nobody assigned group under "OPEN".
//
//  Output is one flat row per cheque; the wide report layout groups and
//  subtotals them (see buildSalesPersonWise / buildDateWise below).
// ─────────────────────────────────────────────────────────────────────────────

// Legacy printout formats every date as dd-MM-yy. Formatted here (not in the
// renderer) because grouped-detail-view "text" columns render values verbatim.
function fmtDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

// Group key for the date-wise base: sorts correctly as a plain string.
function dateKey(value) {
  if (!value) return "0000-00-00";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "0000-00-00";
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// Only these four columns may be ranged over — a filter value straight off the
// query string must never reach a Prisma `where` key unchecked.
const DATE_FIELDS = new Set(["chqDate", "chqRcvDate", "depDate", "dated"]);

export async function getChecksInHandReport(filters = {}) {
  const {
    dateFrom,
    dateTo,
    dateField: rawDateField,
    customer,
    reportBase = "salesPerson",
    status = "all",
    category = "all",
  } = filters;

  const dateField = DATE_FIELDS.has(rawDateField) ? rawDateField : "chqDate";

  const where = {};

  if (dateFrom || dateTo) {
    where[dateField] = {
      ...(dateFrom ? { gte: startOfDay(dateFrom) } : {}),
      ...(dateTo ? { lte: endOfDay(dateTo) } : {}),
    };
  }

  if (customer && customer !== "all") {
    where.acno = Number(customer);
  }

  if (status && status !== "all") {
    const s = normalizeBank(status);
    if (CHECK_STATUSES.includes(s)) where.status = s;
  }

  // Dual book. Restrict to real customer ledgers either way so a stray cheque
  // parked on a non-customer account cannot leak into the report.
  const customerWhere = { macno: { in: await getCustomerMacnos() } };
  const catWhere = categoryWhere(category);
  if (catWhere) Object.assign(customerWhere, catWhere);
  where.customer = customerWhere;

  const cheques = await prisma.checksInHand.findMany({
    where,
    include: {
      customer: {
        select: {
          acno: true, acname: true, isActive: true, salesArea: true,
          mainAccount: { select: { isActive: true } },
        },
      },
      depositBank: { select: { acname: true } },
    },
    orderBy: [{ chqDate: "asc" }, { id: "asc" }],
  });

  const emptySummary = {
    totalCount: 0,
    totalAmount: 0,
    pendingCount: 0,
    pendingAmount: 0,
    clearedCount: 0,
    clearedAmount: 0,
  };

  if (!cheques.length) {
    return { data: [], summary: emptySummary };
  }

  // Resolve Sales Person ids -> names in one query.
  const salesPersonIds = [
    ...new Set(cheques.map((c) => c.customer?.salesArea).filter(Boolean)),
  ];
  const users = salesPersonIds.length
    ? await prisma.user.findMany({
        where: { id: { in: salesPersonIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  // Flat, display-ready rows shared by both bases.
  const rows = cheques.map((c) => {
    const isActive =
      (c.customer?.isActive ?? true) && c.customer?.mainAccount?.isActive !== false;
    return {
      id: c.id,
      acno: c.acno,
      customerCode: c.acno,
      customer: c.customer?.acname || "UNKNOWN",
      salesPersonId: c.customer?.salesArea || "",
      salesPersonName:
        (c.customer?.salesArea && nameById.get(c.customer.salesArea)) || "OPEN",
      category: deriveCategory(c.customer),
      chqNo: c.chqNo,
      chqDate: fmtDate(c.chqDate),
      chqDateKey: dateKey(c.chqDate),
      // Date-wise grouping follows the basis the range was filtered on, so a
      // report ranged over deposit dates does not group by cheque date.
      groupDate: fmtDate(c[dateField]),
      groupDateKey: dateKey(c[dateField]),
      chqRcvDate: fmtDate(c.chqRcvDate),
      bank: c.bank,
      depAcno: c.depositBank?.acname || "",
      amount: toNumber(c.amount),
      depDate: fmtDate(c.depDate),
      rmk: c.rmk || "",
      chqBrBy: c.chqBrBy || "",
      status: c.status,
    };
  });

  const summary = rows.reduce((acc, r) => {
    acc.totalCount += 1;
    acc.totalAmount += r.amount;
    if (r.status === CHECK_STATUS.CLEARED) {
      acc.clearedCount += 1;
      acc.clearedAmount += r.amount;
    } else {
      acc.pendingCount += 1;
      acc.pendingAmount += r.amount;
    }
    return acc;
  }, { ...emptySummary });

  const data =
    reportBase === "date" ? buildDateWise(rows) : buildSalesPersonWise(rows);

  return { data, summary };
}

// ─── Flat rows (CLAUDE.md rule 15) ───────────────────────────────────────────
// One row per cheque, in print order. The viewer draws the groups and their
// subtotals from these fields (components/Reports/config.js checksInHand
// `layout.rowGroupBy`, contiguous so this order is kept):
//   Sales Person wise : salesPersonName › customer   (A-Z, then cheque date)
//   Date wise         : groupDateKey (label groupDate), customers A-Z
// `count: 1` per row gives the cheque count of every subtotal and the total.
function buildSalesPersonWise(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        a.r.salesPersonName.localeCompare(b.r.salesPersonName) ||
        a.r.customer.localeCompare(b.r.customer) ||
        String(a.r.acno).localeCompare(String(b.r.acno), undefined, { numeric: true }) ||
        a.i - b.i,
    )
    .map(({ r }) => ({ ...r, count: 1 }));
}

function buildDateWise(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        String(a.r.groupDateKey ?? a.r.chqDateKey).localeCompare(String(b.r.groupDateKey ?? b.r.chqDateKey)) ||
        a.r.customer.localeCompare(b.r.customer) ||
        a.i - b.i,
    )
    .map(({ r }) => ({ ...r, groupDate: r.groupDate || r.chqDate, count: 1 }));
}
