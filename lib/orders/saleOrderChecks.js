// lib/orders/saleOrderChecks.js — what Settings → Features checks on a Sale Order save
// (lib/features/catalog.js, group "saleOrder"). SERVER ONLY. Used by the orders route
// (app/api/orders/[type]/route.js) and /api/orders/saleOrder/foc-trial-check.
//
//   saleOrder.duplicateItems   duplicateItemsError     "refused" → one line per item
//   saleOrder.priceListOnly    priceListError          items on the customer's ticked Sales Items
//   saleOrder.focTrialWarning  focTrialHistory         no second FOC / Trial of the same item
//   saleOrder.creditLimit      customerCreditChecks    warn / hold (approval reason)
//   saleOrder.overdueCheck     customerCreditChecks    warn / hold (approval reason)
//   saleOrder.litreUnits       litreUnitsError         off → no new LTR lines
//
// Each check reads its feature itself, so a switched-off check costs nothing and the
// route cannot forget it. An edit never refuses what the stored order already had
// (switching a feature on does not lock old orders).
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { getCustomerOverdueTotals } from "@/lib/reports/customerAging";
import { isLitreUnit } from "@/lib/units/litres";
import { LINE_TYPE, freeLine } from "@/lib/orders/lineTypes";
import { SO_STATUS } from "@/lib/orders/saleOrderApproval";

const SO_CATEGORY = 6;

/** Approval reasons (OrderMaster.approval_reasons) added by the credit checks on "hold". */
export const CREDIT_LIMIT_REASON = "Credit limit exceeded";
export const OVERDUE_REASON = "Overdue invoices";

const itemOf = (l) => {
  const v = Number(l?.itcd?.value ?? l?.itcd);
  return Number.isInteger(v) && v > 0 ? v : null;
};
const itemsOf = (lines) => [...new Set((lines || []).map(itemOf).filter(Boolean))];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (n) => num(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

async function itemNames(itcds) {
  if (!itcds.length) return new Map();
  const rows = await prisma.item.findMany({ where: { itcd: { in: itcds } }, select: { itcd: true, code: true, item: true } });
  return new Map(rows.map((i) => [i.itcd, `${i.code ? `${i.code} - ` : ""}${i.item}`]));
}

/** Items of the stored order (an edit keeps what it already had). */
async function storedItems(orderNo) {
  if (!orderNo) return [];
  return prisma.orderDetail.findMany({ where: { order_no: Number(orderNo) }, select: { itcd: true, unit: true } });
}

/** saleOrder.duplicateItems = "refused": the same item on two lines. */
export async function duplicateItemsError(lines) {
  if ((await feature("saleOrder.duplicateItems")) !== "refused") return null;
  const seen = new Set();
  const twice = new Set();
  for (const l of lines || []) {
    const it = itemOf(l);
    if (!it) continue;
    if (seen.has(it)) twice.add(it);
    seen.add(it);
  }
  if (!twice.size) return null;
  const names = await itemNames([...twice]);
  return `An item may be on one line only — ${[...twice].map((i) => names.get(i) || i).join(", ")} is on more than one. Put its quantity on one line.`;
}

/** saleOrder.priceListOnly: every item on the customer's Sales Items, ticked (checked ≠ false). */
export async function priceListError(party, lines, orderNo = null) {
  if (!(await feature("saleOrder.priceListOnly"))) return null;
  const itcds = itemsOf(lines);
  if (!party || !itcds.length) return null;
  const [allowed, kept] = await Promise.all([
    prisma.sALES_ITEM_CUST.findMany({
      where: { acno: Number(party), itcd: { in: itcds }, OR: [{ checked: true }, { checked: null }] },
      select: { itcd: true },
    }),
    storedItems(orderNo),
  ]);
  const ok = new Set([...allowed, ...kept].map((r) => Number(r.itcd)));
  const bad = itcds.filter((i) => !ok.has(i));
  if (!bad.length) return null;
  const names = await itemNames(bad);
  return `Only items on this customer's price list (Sales Items, ticked) can be ordered — not ${bad.map((i) => names.get(i) || i).join(", ")}.`;
}

/**
 * Earlier Free of Cost / Trial of these items to this customer (any Sale Order
 * but rejected ones and `exclude`): a Trial line, or a 0-rate line of a Free of
 * Cost / Trial Process order. → message or null. Items already on `exclude`
 * (the order being edited) are not asked about.
 */
export async function focTrialHistory({ party, itcds, exclude = null }) {
  let ids = [...new Set((itcds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!party || !ids.length) return null;
  if (exclude) {
    const own = new Set((await storedItems(exclude)).map((d) => d.itcd));
    ids = ids.filter((i) => !own.has(i));
    if (!ids.length) return null;
  }
  const earlier = await prisma.orderDetail.findMany({
    where: {
      itcd: { in: ids },
      orderMaster: {
        party_code: Number(party),
        order_catagory: SO_CATEGORY,
        status: { not: SO_STATUS.REJECTED },
        ...(exclude ? { order_no: { not: Number(exclude) } } : {}),
      },
      OR: [
        { line_type: LINE_TYPE.TRIAL },
        {
          rate: 0,
          orderMaster: { OR: [{ freeOfCost: true }, { trialProcess: true }] },
        },
      ],
    },
    select: { itcd: true, order_no: true, line_type: true, orderMaster: { select: { freeOfCost: true, trialProcess: true } } },
    orderBy: { order_no: "asc" },
  });
  if (!earlier.length) return null;
  const names = await itemNames([...new Set(earlier.map((d) => d.itcd))]);
  const byItem = new Map();
  for (const d of earlier) {
    if (byItem.has(d.itcd)) continue;
    const trial = d.line_type === LINE_TYPE.TRIAL || (d.orderMaster?.trialProcess && !d.orderMaster?.freeOfCost);
    byItem.set(d.itcd, `${names.get(d.itcd) || `Item ${d.itcd}`} (${trial ? "Trial" : "Free of Cost"}, SO #${d.order_no})`);
  }
  return `This customer has already received ${[...byItem.values()].join("; ")}. The same item cannot be sent to them again as Free of Cost or Trial.`;
}

/** saleOrder.focTrialWarning on a save: the order's free lines checked against history. */
export async function focTrialError({ party, master, lines, orderNo = null }) {
  if (!(await feature("saleOrder.focTrialWarning"))) return null;
  const free = (lines || []).filter((l) => freeLine(master, l)).map(itemOf).filter(Boolean);
  return focTrialHistory({ party, itcds: free, exclude: orderNo });
}

/** The order's value with tax (as the form computed it, else qty × rate). */
const orderValue = (lines) =>
  (lines || []).reduce((s, l) => {
    const qty = isLitreUnit(l?.unit) ? num(l?.qty_ltr) : num(l?.qty);
    const amount = l?.amount != null && l.amount !== "" ? num(l.amount) : qty * num(l?.rate);
    const tax = l?.st_amount != null && l.st_amount !== "" ? num(l.st_amount) : (amount * num(l?.st_rate)) / 100;
    return s + amount + tax;
  }, 0);

/**
 * The customer's credit position for an order (Customer Aging figures,
 * lib/reports/customerAging.js) — what the credit checks below decide on and
 * what the Approvals panel shows behind "Credit limit exceeded" / "Overdue
 * invoices". A held order is not yet a debt, so it is never in `outstanding`.
 *   → { limit, outstanding, orderValue, total, overBy, overdue }
 */
export async function customerCreditPosition(party, lines) {
  const acno = Number(party);
  const [customer, [aging]] = await Promise.all([
    prisma.aCNO.findUnique({ where: { acno }, select: { crLimit: true } }),
    getCustomerOverdueTotals({ acnos: [acno] }),
  ]);
  const limit = num(customer?.crLimit);
  const outstanding = num(aging?.totalOutstanding);
  const value = orderValue(lines);
  const total = outstanding + value;
  return {
    limit,
    outstanding,
    orderValue: value,
    total,
    overBy: limit > 0 ? Math.max(0, total - limit) : 0,
    overdue: num(aging?.overdueAmount),
  };
}

/**
 * saleOrder.creditLimit / saleOrder.overdueCheck — the customer's position
 * (customerCreditPosition above).
 *   → { holdReasons: string[], warnings: string[] }
 */
export async function customerCreditChecks(party, lines) {
  const [limitMode, overdueMode] = await Promise.all([feature("saleOrder.creditLimit"), feature("saleOrder.overdueCheck")]);
  const out = { holdReasons: [], warnings: [] };
  if ((limitMode === "off" && overdueMode === "off") || !party) return out;
  const pos = await customerCreditPosition(party, lines);
  if (limitMode !== "off" && pos.limit > 0 && pos.total > pos.limit + 0.005) {
    const text = `Credit limit exceeded: outstanding ${money(pos.outstanding)} + this order ${money(pos.orderValue)} = ${money(pos.total)}, limit ${money(pos.limit)}.`;
    if (limitMode === "hold") out.holdReasons.push(CREDIT_LIMIT_REASON);
    out.warnings.push(text);
  }
  if (overdueMode !== "off" && pos.overdue > 0.5) {
    const text = `This customer has ${money(pos.overdue)} overdue (past their credit days).`;
    if (overdueMode === "hold") out.holdReasons.push(OVERDUE_REASON);
    out.warnings.push(text);
  }
  return out;
}

/**
 * saleOrder.litreUnits off: no new LTR line. An edit keeps the items that were
 * LTR on the stored order.
 */
export async function litreUnitsError(lines, orderNo = null) {
  if (await feature("saleOrder.litreUnits")) return null;
  const ltr = (lines || []).filter((l) => isLitreUnit(l?.unit)).map(itemOf).filter(Boolean);
  if (!ltr.length) return null;
  const keptLtr = new Set((await storedItems(orderNo)).filter((d) => isLitreUnit(d.unit)).map((d) => d.itcd));
  const bad = [...new Set(ltr.filter((i) => !keptLtr.has(i)))];
  if (!bad.length) return null;
  const names = await itemNames(bad);
  return `Ordering in litres is switched off — enter ${bad.map((i) => names.get(i) || i).join(", ")} in KG.`;
}

