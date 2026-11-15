// lib/saleReturns/dispatchLink.js
// ============================================================
// A Sale Return (tran_code 10) and the dispatch it returns — Settings →
// Features "saleReturn.requireDispatchLink" (ported from Accounting).
//
//   on  → a return names its Dispatch (master.dispatch_no) and holds only
//         items of that dispatch; or, for a dispatch from before the system
//         started, the Old Dispatch No (master.ref_dispatch_no) + the
//         warehouse the goods come back into, each line carrying its cost
//         rate (Transactions.cost_rate): the system-start opening rate, or
//         the rate typed on the line when the item has none.
//         A linked return never takes a cost rate from the request — its cost
//         is the dispatch month's (lib/costing/saleReturnCost.js).
//   off → as before: no server check. Nothing new is written to
//         ref_dispatch_no / cost_rate; an edit keeps what the return had.
//
// saleReturnLinkError(master, lines, { storedTranId }) adjusts master / lines
// in place and returns an error message or null. Called by the voucher route
// on create and edit, before normalizeMaster.
// ============================================================
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { getSystemStartRates } from "@/lib/costing/saleReturnCost";

export const REQUIRE_DISPATCH_LINK_FEATURE = "saleReturn.requireDispatchLink";

const intOf = (v) => {
  const x = parseInt(v?.value ?? v, 10);
  return Number.isInteger(x) && x > 0 ? x : null;
};

export async function saleReturnLinkError(master, lines, { storedTranId = null } = {}) {
  if (!master) return null;
  const list = Array.isArray(lines) ? lines : [];

  if (!(await feature(REQUIRE_DISPATCH_LINK_FEATURE))) {
    // Off governs new work only: an edit keeps the stored old dispatch no / cost rates.
    if (storedTranId) {
      const [stored, storedLines] = await Promise.all([
        prisma.transactionsMaster.findUnique({ where: { tran_id: Number(storedTranId) }, select: { ref_dispatch_no: true } }),
        prisma.transactions.findMany({
          where: { tran_id: Number(storedTranId), cost_rate: { not: null }, itcd: { not: null } },
          select: { itcd: true, cost_rate: true },
        }),
      ]);
      master.ref_dispatch_no = stored?.ref_dispatch_no ?? null;
      const rates = new Map(storedLines.map((s) => [Number(s.itcd), s.cost_rate]));
      for (const l of list) l.cost_rate = rates.get(intOf(l?.itcd)) ?? null;
    } else {
      delete master.ref_dispatch_no;
      for (const l of list) delete l.cost_rate;
    }
    return null;
  }

  // A named dispatch wins over an old dispatch number typed as well.
  const oldDispatchNo = intOf(master.dispatch_no) ? "" : String(master.ref_dispatch_no ?? "").trim();
  if (oldDispatchNo) {
    // Not in the system: no dispatch / Sale Order link, the warehouse is required.
    master.ref_dispatch_no = oldDispatchNo.slice(0, 150);
    master.dispatch_no = null;
    master.so_no = null;
    if (!intOf(master.godown)) return "Select the Warehouse the returned goods come back into.";
    const { rates } = await getSystemStartRates(list.map((l) => intOf(l?.itcd)));
    const missing = [];
    for (const l of list) {
      const itcd = intOf(l?.itcd);
      if (!itcd) continue;
      const start = rates.get(itcd)?.total_rate;
      const typed = Number(l.cost_rate);
      if (start > 0) l.cost_rate = start;
      else if (Number.isFinite(typed) && typed > 0) l.cost_rate = typed;
      else missing.push(itcd);
    }
    if (missing.length) {
      return `Item ${[...new Set(missing)].join(", ")} has no system-start rate — type the cost rate it was sold at.`;
    }
    return null;
  }

  // Linked return: the cost always comes from the system, never from the line.
  master.ref_dispatch_no = null;
  for (const l of list) l.cost_rate = null;

  const dispatchNo = intOf(master.dispatch_no);
  if (!dispatchNo) {
    return "Select the Dispatch this return is against, or enter the Old Dispatch No for a dispatch from before the system started.";
  }
  const dispatches = await prisma.transactionsMaster.findMany({
    where: { tran_code: 6, dispatch_no: dispatchNo },
    select: { tran_id: true, pycd: true },
  });
  if (!dispatches.length) return `Dispatch #${dispatchNo} was not found.`;
  const party = intOf(master.pycd);
  if (party && !dispatches.some((d) => Number(d.pycd) === party)) {
    return `Dispatch #${dispatchNo} belongs to another customer.`;
  }
  const onDispatch = new Set(
    (
      await prisma.transactions.findMany({
        where: { tran_id: { in: dispatches.map((d) => d.tran_id) }, itcd: { not: null } },
        select: { itcd: true },
        distinct: ["itcd"],
      })
    ).map((t) => Number(t.itcd)),
  );
  const foreign = list.map((l) => intOf(l?.itcd)).filter((itcd) => itcd && !onDispatch.has(itcd));
  if (foreign.length) return `Item ${[...new Set(foreign)].join(", ")} is not on Dispatch #${dispatchNo}.`;
  return null;
}
