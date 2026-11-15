// lib/dispatch/dispatchChecks.js — what Settings → Features changes on a dispatch save
// (lib/features/catalog.js, group "dispatch"). SERVER ONLY, used by the voucher route
// (app/api/voucher/[type]/route.js, dispatch / dispatchEdit).
//
//   dispatch.extraFields           stripExtraFields        off → Manual DC No / City / Route not written
//   dispatch.withoutSaleOrder      withoutSaleOrderError   "refused" → a new dispatch names its Sale Order
//   dispatch.batchRequired         batchRequiredError      every item line has a Batch No
//   saleOrder.litreUnits           dispatchLitreError      off → LTR only where the order / saved line is LTR
//   dispatch.overDispatchTolerance overDispatchError       Σ dispatched ≤ ordered × (1 + band); also the
//                                  overDispatchBand        band checkOrderStatus closes a line within
//   dispatch.packingConsumption    packingConsumptionOn    off → no automatic packing issue on new work
//
// An edit never refuses what the stored dispatch already had (switching a
// feature on does not lock old dispatches).
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { isLitreUnit } from "@/lib/units/litres";
import { findPackingConsumption } from "@/lib/dispatch/packingConsumption";

const itemOf = (l) => {
  const v = Number(l?.itcd?.value ?? l?.itcd);
  return Number.isInteger(v) && v > 0 ? v : null;
};
const blank = (v) => String(v?.value ?? v ?? "").trim() === "";
const kg = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });

async function itemNames(itcds) {
  if (!itcds.length) return new Map();
  const rows = await prisma.item.findMany({ where: { itcd: { in: itcds } }, select: { itcd: true, code: true, item: true } });
  return new Map(rows.map((i) => [i.itcd, `${i.code ? `${i.code} - ` : ""}${i.item}`]));
}

const storedLines = (tranId) =>
  tranId
    ? prisma.transactions.findMany({
        where: { tran_id: Number(tranId), sub_tran_id: 1, itcd: { not: null } },
        select: { itcd: true, unit: true, batch_no: true },
      })
    : Promise.resolve([]);

/** dispatch.extraFields off: the form's Manual DC No / City / Route are not written (an edit keeps the stored ones). */
export async function stripExtraFields(master) {
  if (await feature("dispatch.extraFields")) return;
  delete master.manual_no;
  delete master.city;
  delete master.route;
}

/** dispatch.withoutSaleOrder = "refused": a dispatch must name its Sale Order (one saved without may stay so). */
export async function withoutSaleOrderError(soNo, stored = null) {
  if ((await feature("dispatch.withoutSaleOrder")) !== "refused") return null;
  if (soNo) return null;
  if (stored && !stored.so_no) return null;
  return "A dispatch must be made against a Sale Order — pick the Sale Order.";
}

/** dispatch.batchRequired: every item line has a Batch No; on an edit an item saved without one may stay so. */
export async function batchRequiredError(lines, tranId = null) {
  if (!(await feature("dispatch.batchRequired"))) return null;
  const missing = (lines || []).filter((l) => itemOf(l) && blank(l.batch_no)).map(itemOf);
  if (!missing.length) return null;
  const keptBlank = new Set((await storedLines(tranId)).filter((l) => blank(l.batch_no)).map((l) => l.itcd));
  const bad = [...new Set(missing.filter((i) => !keptBlank.has(i)))];
  if (!bad.length) return null;
  const names = await itemNames(bad);
  return `Batch No is required on every dispatch line — missing for ${bad.map((i) => names.get(i) || i).join(", ")}.`;
}

/**
 * saleOrder.litreUnits off: a dispatch line may be LTR only when its Sale
 * Order line is LTR, or the stored dispatch line was LTR.
 */
export async function dispatchLitreError(lines, { soNo = null, tranId = null } = {}) {
  if (await feature("saleOrder.litreUnits")) return null;
  const ltr = (lines || []).filter((l) => isLitreUnit(l?.unit)).map(itemOf).filter(Boolean);
  if (!ltr.length) return null;
  const [soLines, saved] = await Promise.all([
    soNo ? prisma.orderDetail.findMany({ where: { order_no: Number(soNo) }, select: { itcd: true, unit: true } }) : [],
    storedLines(tranId),
  ]);
  const ok = new Set([...soLines, ...saved].filter((l) => isLitreUnit(l.unit)).map((l) => l.itcd));
  const bad = [...new Set(ltr.filter((i) => !ok.has(i)))];
  if (!bad.length) return null;
  const names = await itemNames(bad);
  return `Litres are switched off — dispatch ${bad.map((i) => names.get(i) || i).join(", ")} in KG.`;
}

/** The over-dispatch band as a fraction (0.1 = 10 %). */
export async function overDispatchBand() {
  const v = Number(await feature("dispatch.overDispatchTolerance"));
  return Number.isFinite(v) && v >= 0 ? v / 100 : 0.1;
}

/**
 * Against a Sale Order: per item, everything dispatched on it (other
 * dispatches + this one, KG) must stay within ordered × (1 + band). Items not
 * on the order are not checked here. `excludeTranId` = the dispatch being edited.
 */
export async function overDispatchError({ soNo, lines, excludeTranId = null }) {
  if (!soNo) return null;
  const mine = new Map();
  for (const l of lines || []) {
    const it = itemOf(l);
    if (it) mine.set(it, (mine.get(it) || 0) + (Number(l.qty) || 0));
  }
  if (!mine.size) return null;
  const itcds = [...mine.keys()];
  const [band, ordered, sent] = await Promise.all([
    overDispatchBand(),
    prisma.orderDetail.groupBy({ by: ["itcd"], where: { order_no: Number(soNo), itcd: { in: itcds } }, _sum: { qty: true } }),
    prisma.transactions.groupBy({
      by: ["itcd"],
      where: {
        itcd: { in: itcds },
        sub_tran_id: 1,
        transactionsMaster: { tran_code: 6, so_no: Number(soNo), ...(excludeTranId ? { tran_id: { not: Number(excludeTranId) } } : {}) },
      },
      _sum: { qty: true },
    }),
  ]);
  const orderedOf = new Map(ordered.map((r) => [r.itcd, Number(r._sum.qty) || 0]));
  const sentOf = new Map(sent.map((r) => [r.itcd, Number(r._sum.qty) || 0]));
  const over = [];
  for (const [it, qty] of mine) {
    const o = orderedOf.get(it);
    if (!(o > 0)) continue;
    const max = o * (1 + band);
    const total = (sentOf.get(it) || 0) + qty;
    if (total > max + 0.0005) over.push({ it, o, sent: sentOf.get(it) || 0, qty, max });
  }
  if (!over.length) return null;
  const names = await itemNames(over.map((x) => x.it));
  const pct = Math.round(band * 100);
  return over
    .map(
      (x) =>
        `${names.get(x.it) || x.it}: ordered ${kg(x.o)} KG, already dispatched ${kg(x.sent)} KG, this dispatch ${kg(x.qty)} KG — ` +
        `more than the ${pct} % allowed over the Sale Order (max ${kg(x.max)} KG).`,
    )
    .join(" ");
}

/**
 * dispatch.packingConsumption: on → as SMS; off → no automatic packing issue
 * for new work, but a dispatch that already has one keeps it in step on edit.
 */
export async function packingConsumptionOn(dispatchTranId = null) {
  if (await feature("dispatch.packingConsumption")) return true;
  if (!dispatchTranId) return false;
  const existing = await findPackingConsumption(prisma, Number(dispatchTranId));
  return Array.isArray(existing) ? existing.length > 0 : !!existing;
}
