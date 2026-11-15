// lib/production/planNature.js — the Lab's Nature on dispatch Production Plan
// lines and what it means for dispatch. SERVER ONLY.
//
//   production.labNature                 a plan line carries ReqDetail.nature
//                                        (FINISHED / PROCESS / MANUFACTURING) +
//                                        nature_at (when the Lab marked it)
//   dispatch.requirePostedProcessOrder   dispatchReadyError — a dispatch line is
//                                        refused while its plan line is PROCESS /
//                                        MANUFACTURING with no posted Process Order,
//                                        or not marked yet (plan lines made after
//                                        the Lab started marking)
//   dispatch line stamps                 stampDispatchPlanLinks — Transactions.plan_no
//                                        / process_order_no, set only by the server
//
// soNatureStatus is the one reading of "is this Sale Order item ready", used by
// /api/orders/so-nature (screens) and by the checks above (server).
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";

export const PLAN_NATURES = ["FINISHED", "PROCESS", "MANUFACTURING"];
const IN_PRODUCTION = new Set(["PROCESS", "MANUFACTURING"]);
const PLAN_CATEGORY = "DISPATCH";

/** A select option / string → a known Nature, or null. */
export function natureOf(v) {
  const s = String((v && typeof v === "object" ? v.value : v) ?? "").trim().toUpperCase();
  return PLAN_NATURES.includes(s) ? s : null;
}

const itemOf = (l) => {
  const v = Number(l?.itcd?.value ?? l?.itcd);
  return Number.isInteger(v) && v > 0 ? v : null;
};

/**
 * Posted Process Orders of these Sale Orders: Map "so|itcd" → { id, req_no }.
 * A multi-output order counts for every item it produces.
 */
async function postedProcessOrders(soNos) {
  const posted = await prisma.productionPlanMaster.findMany({
    where: { sale_ord_no: { in: soNos }, status: "Posted" },
    select: { id: true, sale_ord_no: true, finished_id: true, req_no: true, outputs: { select: { finished_id: true } } },
    orderBy: { id: "desc" },
  });
  const by = new Map();
  for (const p of posted) {
    const items = new Set([p.finished_id, ...p.outputs.map((o) => o.finished_id)].filter(Boolean));
    for (const itcd of items) {
      const key = `${p.sale_ord_no}|${itcd}`;
      if (!by.has(key)) by.set(key, { id: p.id, req_no: p.req_no });
    }
  }
  return by;
}

/**
 * Per Sale Order: { lines: [{ itcd, item, nature, plan_no, po_no, in_production,
 * awaiting_lab, ready }] } — one entry per planned item (latest marked plan
 * line; else the latest unmarked one). An item not in any plan is not listed.
 * Read only.
 */
export async function soNatureStatus(soNos) {
  soNos = [...new Set((soNos || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!soNos.length) return {};
  const lines = await prisma.reqDetail.findMany({
    where: { so_no: { in: soNos }, master: { req_catagory: PLAN_CATEGORY } },
    select: {
      id: true, so_no: true, itcd: true, nature: true, tran_id: true, dated: true, created_at: true,
      item: { select: { code: true, item: true } },
    },
    orderBy: { id: "desc" },
  });

  const latest = new Map();
  const unmarked = new Map();
  for (const l of lines) {
    if (l.itcd == null) continue;
    const key = `${l.so_no}|${l.itcd}`;
    const nature = natureOf(l.nature);
    if (nature) {
      if (!latest.has(key)) latest.set(key, { ...l, nature });
    } else if (!unmarked.has(key)) unmarked.set(key, l);
  }
  for (const key of latest.keys()) unmarked.delete(key);

  // "Awaiting Lab" only for plan lines made after the Lab first marked a Nature
  // (older plans were never going to be marked).
  let labFrom = null;
  if (unmarked.size) {
    const first = await prisma.reqDetail.findFirst({
      where: { nature_at: { not: null } },
      orderBy: { nature_at: "asc" },
      select: { nature_at: true },
    });
    labFrom = first?.nature_at ?? null;
  }
  const withoutGodown = new Set();
  if (unmarked.size && labFrom) {
    const rows = await prisma.orderMaster.findMany({
      where: { order_no: { in: [...new Set([...unmarked.values()].map((l) => l.so_no))] }, dispatchWithoutGodown: true },
      select: { order_no: true },
    });
    for (const o of rows) withoutGodown.add(o.order_no);
  }

  const poBy = await postedProcessOrders(soNos);
  const name = (l) => [l.item?.code, l.item?.item].filter(Boolean).join(" - ") || String(l.itcd);
  const data = {};
  for (const [key, l] of latest) {
    const inProd = IN_PRODUCTION.has(l.nature);
    const po = inProd ? poBy.get(key) ?? null : null;
    (data[l.so_no] ??= { lines: [] }).lines.push({
      itcd: l.itcd, item: name(l), nature: l.nature, plan_no: l.tran_id,
      po_no: po?.id ?? null, in_production: inProd && !po, awaiting_lab: false, ready: !(inProd && !po),
    });
  }
  for (const [key, l] of unmarked) {
    const awaiting = Boolean(labFrom) && !withoutGodown.has(l.so_no) && new Date(l.created_at ?? l.dated) >= new Date(labFrom);
    (data[l.so_no] ??= { lines: [] }).lines.push({
      itcd: l.itcd, item: name(l), nature: null, plan_no: l.tran_id,
      po_no: poBy.get(key)?.id ?? null, in_production: false, awaiting_lab: awaiting, ready: !awaiting,
    });
  }
  return data;
}

/**
 * dispatch.requirePostedProcessOrder: why these dispatch lines may not go yet,
 * or null. On an edit, items the stored dispatch already had are not refused.
 */
export async function dispatchReadyError({ soNo, lines, tranId = null }) {
  if (!(await feature("dispatch.requirePostedProcessOrder"))) return null;
  soNo = Number(soNo) || null;
  if (!soNo) return null;
  const items = [...new Set((lines || []).map(itemOf).filter(Boolean))];
  if (!items.length) return null;
  const stored = tranId
    ? new Set(
        (await prisma.transactions.findMany({
          where: { tran_id: Number(tranId), sub_tran_id: 1, itcd: { not: null } },
          select: { itcd: true },
        })).map((t) => t.itcd),
      )
    : new Set();
  const status = (await soNatureStatus([soNo]))[soNo]?.lines || [];
  const blocked = status.filter((s) => !s.ready && items.includes(s.itcd) && !stored.has(s.itcd));
  if (!blocked.length) return null;
  return `Not ready for dispatch: ${blocked
    .map((s) =>
      s.awaiting_lab
        ? `${s.item} — the Lab has not marked its Nature on Production Plan #${s.plan_no}`
        : `${s.item} — ${s.nature}, its Process Order is not posted yet (Plan #${s.plan_no})`,
    )
    .join("; ")}.`;
}

/**
 * Dispatch lines get the Plan No / Process Order No of their Sale Order item
 * (while saleOrder.planFromOrder or dispatch.requirePostedProcessOrder is on).
 * An edit keeps what each item was stamped with; anything the client sent is
 * dropped. Switched off: no new stamps, stored ones kept.
 */
export async function stampDispatchPlanLinks({ soNo, lines, tranId = null }) {
  const on = (await feature("saleOrder.planFromOrder")) || (await feature("dispatch.requirePostedProcessOrder"));
  const before = tranId
    ? await prisma.transactions.findMany({
        where: { tran_id: Number(tranId), sub_tran_id: 1, itcd: { not: null } },
        select: { itcd: true, plan_no: true, process_order_no: true },
      })
    : [];
  const kept = new Map(before.filter((b) => b.plan_no != null || b.process_order_no != null).map((b) => [b.itcd, b]));
  const status = on && Number(soNo) ? (await soNatureStatus([Number(soNo)]))[Number(soNo)]?.lines || [] : [];
  const fresh = new Map(status.map((s) => [s.itcd, { plan_no: s.plan_no ?? null, process_order_no: s.po_no ?? null }]));
  return (lines || []).map(({ plan_no: _p, process_order_no: _o, ...l }) => {
    const it = itemOf(l);
    if (it == null) return l;
    const k = kept.get(it);
    if (k) return { ...l, plan_no: k.plan_no, process_order_no: k.process_order_no };
    const f = fresh.get(it);
    return f ? { ...l, ...f } : l;
  });
}
