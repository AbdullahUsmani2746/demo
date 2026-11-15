// lib/dispatch/withoutGodown.js
// ============================================================
// "DESPATCH WITHOUT GODOWN" SALE ORDERS
//
// A Sale Order of this Order Type (OrderMaster.dispatchWithoutGodown) is
// invoiced for the customer's paperwork without anything being produced:
//
//   · approval   — "Despatch Without Godown" is an approval reason (status 3
//                  until approved), like Free of Cost / Trial
//   · dispatch   — always from WITHOUT_GODOWN_DISPATCH, whatever the form
//                  sent. That godown stays closed in Setup, so only these
//                  dispatches can post to it. No stock check (it goes
//                  negative), no packing consumption, no produce-on-dispatch
//                  BOM (no auto Material Issue / Production).
//   · sale acno  — each line credits its item category's nogodown_sale_acno
//                  instead of sale_acno, at dispatch and on Sale Invoicing
//                  (lib/accounts/itemAccounts.js, option withoutGodown) — no
//                  Account Settings fallback: a category without it is refused.
//   · invoice    — Sale Invoicing, exactly like any other dispatch
//
// Flag + godown constant: lib/orders/saleOrderApprovalRules.js
// ============================================================
import prisma from "@/lib/prisma";
import {
  WITHOUT_GODOWN_DISPATCH,
  WITHOUT_GODOWN_NOT_SET,
  withoutGodownConfigured,
} from "@/lib/orders/saleOrderApprovalRules";

/** The godown id these dispatches post to, or null while not configured. */
export const withoutGodownId = () =>
  withoutGodownConfigured() ? Number(WITHOUT_GODOWN_DISPATCH.value) : null;

export { WITHOUT_GODOWN_NOT_SET };

/** Is this Sale Order a Despatch Without Godown? */
export async function isWithoutGodownOrder(soNo) {
  const orderNo = Number(soNo);
  if (!Number.isInteger(orderNo) || orderNo <= 0) return false;
  const so = await prisma.orderMaster.findUnique({
    where: { order_no: orderNo },
    select: { dispatchWithoutGodown: true },
  });
  return so?.dispatchWithoutGodown === true;
}

/**
 * A planDispatchBom()-shaped result with nothing to issue or produce: a
 * Despatch Without Godown dispatch is not produced and not stock-checked.
 * syncDispatchBom() with it removes any auto Material Issue / Production the
 * dispatch had before.
 */
export const noProductionPlan = (master) => ({
  inputs: [],
  issueLines: [],
  prodLines: [],
  warnings: [],
  issueGodown: null,
  issueGodowns: [],
  dispatchGodown: Number(master?.godown) || null,
});
