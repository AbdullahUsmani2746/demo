// lib/dispatch/packingConsumption.js
// ============================================================
// PACKING MATERIAL CONSUMPTION ON DISPATCH
//
// Every dispatch line names the packing material it went out in
// (Transactions.packing_material_code) and how many packs (no_of_pack).
// Saving a dispatch keeps ONE tran_code 7 (Material Issue / consumption)
// voucher in step with it:
//
//   TRANSACTIONS_MASTER  tran_code 7, dated + godown = the dispatch's
//                        rmk1 = "AUTO_PACKING"           (marks it as ours)
//                        rmk4 = dispatch tran_id         (the link)
//                        rmk5 = dispatch_no
//   Transactions         one line per packing material:
//                        itcd = packing material, qty = Σ no_of_pack,
//                        acno = its stock account — category stock_acno, else
//                        the 'stock' Account Settings default (same rule as a
//                        manual Material Issue line), no amounts
//
// Created on dispatch create, rebuilt on edit, deleted with the dispatch.
// While the dispatch has no packing lines the entry is removed.
//
// Before the save, packing stock in the dispatch's godown is checked as the
// stock check policy says for "packing" (Settings → Stock checking,
// lib/stock/policy.js): off = not checked, warn = a warning and the dispatch
// saves (the default — what ENFORCE_PACKING_STOCK = false did), block = the
// dispatch is refused. Switch it to Block once FG-DESPATCH packing stock is
// correct and the manual "CONS" consumption entries have stopped.
// ============================================================
import { getGodownStock } from "@/lib/stock/godownStock";
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { getStockPolicy, modeOf, isExemptGodown } from "@/lib/stock/policy";

export const PACKING_MARKER = "AUTO_PACKING";

const num = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/**
 * Packs needed per packing material, from the dispatch's lines (raw form
 * lines or mapped rows — both shapes are accepted).
 * @returns {Map<number, number>} packing itcd → total packs
 */
export function packingNeeds(lines) {
  const needs = new Map();
  for (const l of lines ?? []) {
    if (l?.sub_tran_id != null && Number(l.sub_tran_id) !== 1) continue;
    const itcd = num(l?.packing_material_code);
    const packs = num(l?.no_of_pack);
    if (!itcd || packs <= 0) continue;
    needs.set(itcd, round3((needs.get(itcd) || 0) + packs));
  }
  return needs;
}

/** The consumption voucher(s) already linked to a dispatch. */
export async function findPackingConsumption(db, dispatchTranId) {
  return db.transactionsMaster.findMany({
    where: { tran_code: 7, rmk1: PACKING_MARKER, rmk4: String(dispatchTranId) },
    select: { tran_id: true, vr_no: true, dated: true },
  });
}

/**
 * Packing materials short in `godown` for this dispatch.
 * The dispatch's own existing consumption is left out of the stock figure,
 * since it is about to be rebuilt.
 * `mode` is the policy's "packing" mode: the caller refuses the save on
 * "block" and adds `message` to the warnings on "warn"; "off" checks nothing.
 * @returns {Promise<{ mode: string, shortages: object[], message: string|null }>}
 */
export async function checkPackingStock({ db, needs, godown, dispatchTranId = null }) {
  const policy = await getStockPolicy();
  const mode = modeOf(policy, "packing");
  if (mode === "off" || !needs.size || !godown || isExemptGodown(policy, godown)) {
    return { mode, shortages: [], message: null };
  }

  const existing = dispatchTranId ? await findPackingConsumption(db, dispatchTranId) : [];
  const stock = await getGodownStock([...needs.keys()], godown, {
    excludeTranIds: existing.map((e) => e.tran_id),
  });

  const short = [...needs].filter(([itcd, need]) => (stock.get(itcd) || 0) < need);
  if (!short.length) return { mode, shortages: [], message: null };

  const items = await db.item.findMany({
    where: { itcd: { in: short.map(([itcd]) => itcd) } },
    select: { itcd: true, item: true },
  });
  const nameOf = new Map(items.map((i) => [i.itcd, i.item]));

  const shortages = short.map(([itcd, need]) => ({
    itcd,
    item: nameOf.get(itcd) || `Item #${itcd}`,
    need,
    available: round3(stock.get(itcd) || 0),
  }));
  const list = shortages
    .map((s) => `${s.item}: need ${s.need}, in stock ${s.available}`)
    .join("; ");
  return {
    mode,
    shortages,
    message: `Not enough packing material in the dispatch godown — ${list}.`,
  };
}

/**
 * Stock account of every packing material in `needs` (category stock_acno →
 * 'stock' Account Settings default). Throws 422 when neither is set — call it
 * BEFORE writing the dispatch so a missing account refuses the whole save.
 * @returns {Promise<Record<number, number>>} packing itcd → acno
 */
export async function resolvePackingAccounts(needs, { db } = {}) {
  if (!needs.size) return {};
  const { lineAcno } = await resolveItemAccounts(
    [...needs.keys()].map((itcd) => ({ itcd })),
    7,
    db ? { db } : undefined,
  );
  return lineAcno;
}

/**
 * Create / rebuild / remove the dispatch's consumption voucher inside `tx`.
 * @param {object} tx
 * @param {{ tran_id, dispatch_no, dated, godown, user_id, company_id }} dispatch
 * @param {Map<number, number>} needs  from packingNeeds()
 * @param {{ acnoByItcd?: Record<number, number> }} [opts]  from
 *        resolvePackingAccounts(); resolved here when not passed
 * @returns {Promise<number|null>} the consumption tran_id, or null if none
 */
export async function syncPackingConsumption(tx, dispatch, needs, { acnoByItcd } = {}) {
  const existing = await findPackingConsumption(tx, dispatch.tran_id);

  // Nothing packed any more → no consumption entry.
  if (!needs.size) {
    for (const e of existing) {
      await tx.transactions.deleteMany({ where: { tran_id: e.tran_id } });
      await tx.transactionsMaster.delete({ where: { tran_id: e.tran_id } });
    }
    return null;
  }

  // Each line posts to its packing material's stock account, exactly as a
  // manual Material Issue line would (lib/accounts/itemAccounts.js, tran 7).
  const acnoOf = acnoByItcd ?? (await resolvePackingAccounts(needs, { db: tx }));

  const dated = dispatch.dated ? new Date(dispatch.dated) : new Date();
  const header = {
    company_id: dispatch.company_id ?? 1,
    dated,
    time: dated,
    tran_code: 7,
    godown: dispatch.godown ?? null,
    rmk: `Packing material consumed for dispatch no: ${dispatch.dispatch_no ?? dispatch.tran_id}`,
    rmk1: PACKING_MARKER,
    rmk4: String(dispatch.tran_id),
    rmk5: dispatch.dispatch_no != null ? String(dispatch.dispatch_no) : null,
    user_id: dispatch.user_id ?? null,
  };

  let consumptionId;
  const [keep, ...extra] = existing;
  for (const e of extra) {
    // Should never happen; keep exactly one entry per dispatch.
    await tx.transactions.deleteMany({ where: { tran_id: e.tran_id } });
    await tx.transactionsMaster.delete({ where: { tran_id: e.tran_id } });
  }

  // Daily voucher number, as send-to-production numbers its tran_code 7.
  const nextVrNo = async () => {
    const dayStart = new Date(dated.getFullYear(), dated.getMonth(), dated.getDate());
    const dayEnd = new Date(dated.getFullYear(), dated.getMonth(), dated.getDate() + 1);
    const last = await tx.transactionsMaster.findFirst({
      where: { tran_code: 7, dated: { gte: dayStart, lt: dayEnd } },
      orderBy: { vr_no: "desc" },
      select: { vr_no: true },
    });
    return (last?.vr_no ?? 0) + 1;
  };

  if (keep) {
    consumptionId = keep.tran_id;
    // (dated, tran_code, vr_no) is unique: moved to another day (the
    // dispatch's date was edited) → the next number on that day.
    const was = keep.dated ? new Date(keep.dated) : null;
    const moved = !was || was.toDateString() !== dated.toDateString();
    await tx.transactionsMaster.update({
      where: { tran_id: keep.tran_id },
      data: { ...header, ...(moved && { vr_no: await nextVrNo() }) },
    });
    await tx.transactions.deleteMany({ where: { tran_id: keep.tran_id } });
  } else {
    const created = await tx.transactionsMaster.create({
      data: { ...header, vr_no: await nextVrNo() },
      select: { tran_id: true },
    });
    consumptionId = created.tran_id;
  }

  await tx.transactions.createMany({
    data: [...needs].map(([itcd, packs]) => ({
      tran_id: consumptionId,
      sub_tran_id: 1,
      itcd,
      qty: packs,
      godown: dispatch.godown ?? null,
      acno: acnoOf[itcd] ?? null,
      damt: 0,
      camt: 0,
      narration1: `Packing for dispatch ${dispatch.dispatch_no ?? dispatch.tran_id}`,
    })),
  });

  return consumptionId;
}

/** Remove a dispatch's consumption voucher (dispatch being deleted). */
export async function deletePackingConsumption(tx, dispatchTranId) {
  const existing = await findPackingConsumption(tx, dispatchTranId);
  for (const e of existing) {
    await tx.transactions.deleteMany({ where: { tran_id: e.tran_id } });
    await tx.transactionsMaster.delete({ where: { tran_id: e.tran_id } });
  }
  return existing.length;
}
