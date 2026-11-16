// lib/pos/shift.js
// ============================================================
// POS shifts and the Z report. A shift is opened with a float and closed with
// the cash counted; the Z report is worked out from the shift's receipts
// (pos_receipts / pos_payments) and frozen into pos_shifts.summary at close.
// Only writer of pos_shifts.
// ============================================================
import prisma from "@/lib/prisma";
import { round2 } from "@/lib/pos/calc";
import { PosError, openShiftOf } from "@/lib/pos/posting";

const METHODS = ["CASH", "CARD", "CREDIT"];

/** Z report of a set of receipts (by shift id, or by tran ids for a day). */
export async function summarize({ shiftId = null, tranIds = null, openingFloat = 0 }) {
  const where = shiftId != null ? { shift_id: Number(shiftId) } : { tran_id: { in: tranIds || [] } };
  const receipts = await prisma.posReceipt.findMany({ where, orderBy: { tran_id: "asc" } });
  const ids = receipts.map((r) => r.tran_id);
  const [payments, lines] = await Promise.all([
    ids.length ? prisma.posPayment.findMany({ where: { tran_id: { in: ids } } }) : [],
    ids.length
      ? prisma.transactions.groupBy({ by: ["tran_id"], where: { tran_id: { in: ids }, sub_tran_id: 1, itcd: { not: null } }, _sum: { qty: true } })
      : [],
  ]);
  const qtyOf = new Map(lines.map((l) => [l.tran_id, Number(l._sum.qty || 0)]));
  const kindOf = new Map(receipts.map((r) => [r.tran_id, r.kind]));

  const sales = receipts.filter((r) => r.kind === "SALE");
  const rets = receipts.filter((r) => r.kind === "RETURN");
  const sum = (list, f) => round2(list.reduce((s, r) => s + Number(r[f] || 0), 0));
  const byMethod = (kind) =>
    Object.fromEntries(METHODS.map((m) => [m, round2(payments.filter((p) => p.method === m && kindOf.get(p.tran_id) === kind).reduce((s, p) => s + p.amount, 0))]));

  const salesBy = byMethod("SALE");
  const refundsBy = byMethod("RETURN");
  const expectedCash = round2(Number(openingFloat || 0) + salesBy.CASH - refundsBy.CASH);
  return {
    receipts: sales.length,
    returns: rets.length,
    itemsSold: round2(sales.reduce((s, r) => s + (qtyOf.get(r.tran_id) || 0), 0)),
    itemsReturned: round2(rets.reduce((s, r) => s + (qtyOf.get(r.tran_id) || 0), 0)),
    grossSales: sum(sales, "subtotal"),
    discounts: sum(sales, "discount"),
    tax: round2(sum(sales, "tax") - sum(rets, "tax")),
    rounding: round2(sum(sales, "rounding") - sum(rets, "rounding")),
    salesTotal: sum(sales, "total"),
    returnsTotal: sum(rets, "total"),
    netSales: round2(sum(sales, "total") - sum(rets, "total")),
    salesByMethod: salesBy,
    refundsByMethod: refundsBy,
    openingFloat: round2(Number(openingFloat || 0)),
    expectedCash,
    firstReceipt: ids[0] ?? null,
    lastReceipt: ids[ids.length - 1] ?? null,
  };
}

export async function openShift(session, { openingFloat = 0, godown = null } = {}) {
  const userId = String(session.user.id);
  const existing = await openShiftOf(userId);
  if (existing) throw new PosError("You already have an open shift — close it first.", 409);
  const float = Number(openingFloat);
  if (!Number.isFinite(float) || float < 0) throw new PosError("The opening float must be 0 or more.", 400);
  try {
    return await prisma.posShift.create({ data: { user_id: userId, godown, opening_float: round2(float) } });
  } catch (e) {
    if (e?.code === "P2002") throw new PosError("You already have an open shift — close it first.", 409);
    throw e;
  }
}

export async function closeShift(session, shiftId, { countedCash, notes } = {}, { mayCloseOthers = false } = {}) {
  const shift = await prisma.posShift.findUnique({ where: { id: Number(shiftId) } });
  if (!shift) throw new PosError("Shift not found.", 404);
  if (shift.status !== "OPEN") throw new PosError("This shift is already closed.", 409);
  if (shift.user_id !== String(session.user.id) && !mayCloseOthers) throw new PosError("You may close only your own shift (pos.allShifts).", 403);
  const counted = Number(countedCash);
  if (!Number.isFinite(counted) || counted < 0) throw new PosError("Type the cash counted in the drawer.", 400);

  const summary = await summarize({ shiftId: shift.id, openingFloat: shift.opening_float });
  const difference = round2(counted - summary.expectedCash);
  // Only an open shift is closed — a second click / another till cannot close it twice.
  const { count } = await prisma.posShift.updateMany({
    where: { id: shift.id, status: "OPEN" },
    data: {
      status: "CLOSED",
      closed_at: new Date(),
      closed_by: String(session.user.id),
      expected_cash: summary.expectedCash,
      counted_cash: round2(counted),
      difference,
      notes: notes ? String(notes).slice(0, 500) : null,
      summary: { ...summary, countedCash: round2(counted), difference },
    },
  });
  if (!count) throw new PosError("This shift is already closed.", 409);
  return prisma.posShift.findUnique({ where: { id: shift.id } });
}
