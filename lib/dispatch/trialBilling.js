// lib/dispatch/trialBilling.js — billing Trial / Rate Negotiation items the client
// approved (feature "orders.trialLineBilling", ported from Eastland). SERVER ONLY.
//
// 1. A dispatch line remembers what its Sale Order line was when it was
//    dispatched (Transactions.line_type TRIAL / RATE_NEG — stampDispatchLineTypes,
//    called by the voucher route). Such a line prices at 0 on Sale Invoicing
//    (lib/invoicing/core.js) — the goods went out on trial, nothing is sold yet;
//    a dispatch whose every line is on trial is not invoiced at all.
// 2. The client approves = the Sale Order line is edited to Normal with its
//    rate (lib/orders/trialBilling.js tells the user).
// 3. Sale Invoicing → Approved trial items → "Bill" MOVES the approved items
//    off the trial dispatch into a part of it with the same dispatch_no and the
//    next dispatch_part (1234-2), on the SAME date as the dispatch. There is NO
//    Sale Return and nothing is posted twice: the lines themselves move, so
//    stock stays as it was (same date, godown, qty). The part then sits on Sale
//    Invoicing like any dispatch and is invoiced there at the Sale Order's (now
//    Normal) rate. When every item of an uninvoiced, all-trial dispatch is
//    approved, the dispatch itself is simply un-marked and invoiced — no part.
//    (Eastland's trial-items route comment still speaks of "a 0-rate Sale Return
//    + a billing dispatch part"; that was an earlier design — its code, and this
//    port, move the lines and post no return.)
//    The sale is in the dispatch's month: a locked month blocks billing
//    (checkPeriodLock) until it is unlocked. A part, and a dispatch that has
//    parts, cannot be edited or deleted by hand (trialDispatchLockError); a
//    wrong billing is corrected with a Sale Return of the part.
// Stamps already on dispatches stay when the feature is switched off (they
// keep pricing at 0); billing them needs the feature on.
import prisma from "@/lib/prisma";
import { checkPeriodLock } from "@/lib/periodLock";
import { LINE_TYPE, WAITING_LINE_TYPES } from "@/lib/orders/lineTypes";
import { SO_HELD_STATUSES } from "@/lib/orders/saleOrderApproval";

export const TRIAL_LINE_TYPES = WAITING_LINE_TYPES;
export const isTrialLine = (line) => TRIAL_LINE_TYPES.includes(line?.line_type);

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const r3 = (n) => (n == null ? null : round3(n));
const SO_CATEGORY = 6;
const itemOf = (l) => {
  const v = Number(l?.itcd?.value ?? l?.itcd);
  return Number.isInteger(v) && v > 0 ? v : null;
};

/** "1234-2" — a dispatch's number with its part. */
export const dispatchLabel = (m) =>
  m?.dispatch_no == null ? "" : Number(m.dispatch_part) > 1 ? `${m.dispatch_no}-${m.dispatch_part}` : String(m.dispatch_no);

/**
 * Dispatch save: stamp each item line (form lines, before mapping) with its
 * Sale Order line's type when that is Trial / Rate Negotiation. An edit keeps
 * the type each item had when it was first dispatched (an item approved since
 * must not turn billable on the old dispatch — it is billed by its own part).
 * `enabled` false (feature off): new lines get no stamp; an edit still keeps
 * the stamps the dispatch was saved with. Anything the client sent as
 * line_type is ignored.
 */
export async function stampDispatchLineTypes({ soNo, tranId = null, lines, enabled }) {
  const [soLines, before] = await Promise.all([
    enabled && soNo
      ? prisma.orderDetail.findMany({ where: { order_no: Number(soNo) }, select: { itcd: true, line_type: true } })
      : [],
    tranId
      ? prisma.transactions.findMany({ where: { tran_id: Number(tranId), sub_tran_id: 1, itcd: { not: null } }, select: { itcd: true, line_type: true } })
      : [],
  ]);
  const soType = new Map(soLines.map((d) => [d.itcd, d.line_type]));
  const kept = new Map(before.map((l) => [l.itcd, l.line_type ?? null]));
  return lines.map(({ line_type: _ignored, ...l }) => {
    const it = itemOf(l);
    if (it == null) return l;
    const t = kept.has(it) ? kept.get(it) : soType.get(it);
    return TRIAL_LINE_TYPES.includes(t) ? { ...l, line_type: t } : l;
  });
}

/**
 * Why this dispatch may not be edited / deleted by hand, or null:
 *   · a billing part (dispatch_part > 1)
 *   · a trial dispatch that has billing parts (its lines were moved into them)
 */
export async function trialDispatchLockError(master) {
  if (!master || Number(master.tran_code) !== 6) return null;
  if (Number(master.dispatch_part) > 1) {
    return `Dispatch ${dispatchLabel(master)} bills approved trial items — it cannot be edited or deleted. Correct it with a Sale Return.`;
  }
  if (master.dispatch_no == null) return null;
  const parts = await prisma.transactionsMaster.count({
    where: { tran_code: 6, dispatch_no: master.dispatch_no, dispatch_part: { gt: 1 } },
  });
  return parts
    ? `Approved trial items of dispatch ${dispatchLabel(master)} are billed on its parts — it cannot be edited or deleted. Correct it with a Sale Return.`
    : null;
}

/**
 * Unbilled trial items, one row per (trial dispatch, item): dispatched on a
 * Trial / Rate Negotiation line, qty left after Sale Returns against that
 * dispatch; `approved` when the Sale Order line is now Normal with a rate and
 * the order is not waiting for approval.
 *   { soNo?, tranId?, scope? } — scope = documentScopeWhere(session, 6)
 */
export async function approvedTrialItems({ soNo = null, tranId = null, scope = [] } = {}) {
  const lines = await prisma.transactions.findMany({
    where: {
      sub_tran_id: 1,
      line_type: { in: TRIAL_LINE_TYPES },
      transactionsMaster: {
        tran_code: 6,
        ...(soNo ? { so_no: Number(soNo) } : { so_no: { not: null } }),
        ...(tranId ? { tran_id: Number(tranId) } : {}),
        ...(scope.length ? { AND: scope } : {}),
      },
    },
    select: {
      id: true, tran_id: true, itcd: true, qty: true, qty_ltr: true, unit: true, line_type: true,
      itemDetails: { select: { code: true, item: true } },
      transactionsMaster: {
        select: { tran_id: true, dated: true, so_no: true, pycd: true, godown: true, dispatch_no: true, dispatch_part: true, invoice_no: true, acno: { select: { acname: true } } },
      },
    },
    orderBy: [{ tran_id: "asc" }, { id: "asc" }],
  });
  if (!lines.length) return [];

  const soNos = [...new Set(lines.map((l) => l.transactionsMaster.so_no))];
  const dispatchNos = [...new Set(lines.map((l) => l.transactionsMaster.dispatch_no).filter((n) => n != null))];
  const [soLines, orders, returns] = await Promise.all([
    prisma.orderDetail.findMany({
      where: { order_no: { in: soNos }, orderMaster: { order_catagory: SO_CATEGORY } },
      select: { order_no: true, itcd: true, line_type: true, rate: true, unit: true },
    }),
    prisma.orderMaster.findMany({ where: { order_no: { in: soNos } }, select: { order_no: true, status: true } }),
    // what the client already sent back against these dispatches (Sale Returns)
    dispatchNos.length
      ? prisma.transactions.findMany({
          where: {
            sub_tran_id: 1,
            transactionsMaster: { tran_code: 10, so_no: { in: soNos }, dispatch_no: { in: dispatchNos } },
          },
          select: { itcd: true, qty: true, transactionsMaster: { select: { dispatch_no: true, so_no: true } } },
        })
      : [],
  ]);
  const soLine = new Map(soLines.map((d) => [`${d.order_no}|${d.itcd}`, d]));
  // a Sale Order still waiting for approval (its edit included) is not billed yet
  const held = new Set(orders.filter((o) => SO_HELD_STATUSES.includes(o.status)).map((o) => o.order_no));

  const groups = new Map();
  for (const l of lines) {
    const m = l.transactionsMaster;
    const key = `${l.tran_id}|${l.itcd}`;
    if (!groups.has(key)) {
      groups.set(key, {
        tran_id: l.tran_id,
        dispatch: dispatchLabel(m),
        dispatch_no: m.dispatch_no,
        dated: m.dated,
        so_no: m.so_no,
        invoiced: String(m.invoice_no ?? "").trim() !== "",
        customer: m.acno?.acname || String(m.pycd ?? ""),
        pycd: m.pycd,
        itcd: l.itcd,
        code: l.itemDetails?.code || "",
        item: l.itemDetails?.item || `Item ${l.itcd}`,
        line_type: l.line_type,
        unit: l.unit,
        dispatched_kg: 0,
        dispatched_ltr: 0,
      });
    }
    const g = groups.get(key);
    g.dispatched_kg += Number(l.qty) || 0;
    g.dispatched_ltr += Number(l.qty_ltr) || 0;
  }

  const out = [];
  for (const g of groups.values()) {
    const so = soLine.get(`${g.so_no}|${g.itcd}`);
    const back = returns
      .filter((r) => r.itcd === g.itcd && r.transactionsMaster.so_no === g.so_no && r.transactionsMaster.dispatch_no === g.dispatch_no)
      .reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const left = round3(g.dispatched_kg - back);
    if (!(left > 0)) continue;
    const approved = !!so && so.line_type === LINE_TYPE.NORMAL && Number(so.rate) > 0 && !held.has(g.so_no);
    out.push({
      ...g,
      so_held: held.has(g.so_no),
      dispatched_kg: round3(g.dispatched_kg),
      dispatched_ltr: round3(g.dispatched_ltr),
      left_kg: left,
      so_rate: Number(so?.rate) || 0,
      approved,
    });
  }
  return out;
}

/**
 * Bill the approved trial items of one trial dispatch (all of them, or the
 * items listed): move them into its next part (1234-2), same date — or, when
 * the whole uninvoiced dispatch is approved, un-mark it. → { status, body }
 */
export async function billApprovedTrialItems({ tranId, itcds = null, scope = [] }) {
  const ready = (await approvedTrialItems({ tranId, scope })).filter((r) => r.approved && (!itcds?.length || itcds.map(Number).includes(r.itcd)));
  if (!ready.length) {
    return { status: 409, body: { message: "Nothing approved and unbilled on this dispatch — change the Sale Order line to Normal with its rate first." } };
  }

  const master = await prisma.transactionsMaster.findUnique({
    where: { tran_id: Number(tranId) },
    include: { transactions: { where: { sub_tran_id: 1, itcd: { not: null } }, orderBy: { id: "asc" } } },
  });
  if (!master || master.tran_code !== 6) return { status: 404, body: { message: "Dispatch not found" } };

  // The sale is in the dispatch's own month — it must be open
  const lockError = await checkPeriodLock(master.dated, 6, { action: "update" });
  if (lockError) return { status: 422, body: { message: lockError } };

  // What moves: per approved item, its qty left on trial, over its lines in order
  const leftOf = new Map(ready.map((r) => [r.itcd, r.left_kg]));
  const plan = []; // { line, kg, whole }
  for (const l of master.transactions) {
    if (!isTrialLine(l)) continue;
    const left = leftOf.get(l.itcd) || 0;
    const kg = Math.min(left, Number(l.qty) || 0);
    if (!(kg > 0)) continue;
    leftOf.set(l.itcd, round3(left - kg));
    plan.push({ line: l, kg: round3(kg), whole: kg >= (Number(l.qty) || 0) - 0.0005 });
  }
  if (!plan.length) return { status: 409, body: { message: "Nothing left to bill on this dispatch." } };

  const label = dispatchLabel(master);
  const itemsText = ready.map((r) => `${r.code || r.item}`).join(", ");
  // Every item line of an uninvoiced dispatch approved in full: no part —
  // the dispatch itself is un-marked and invoiced as it is
  const inPlace =
    !String(master.invoice_no ?? "").trim() &&
    master.transactions.every((l) => isTrialLine(l)) &&
    master.transactions.every((l) => plan.some((p) => p.line.id === l.id && p.whole));

  const done = await prisma.$transaction(async (tx) => {
    // one billing per dispatch at a time — the part number and qty stay right
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${7_200_000_000 + master.tran_id}::bigint)`;
    // a billing that ran while this one waited for the lock has moved the lines
    const still = await tx.transactions.findMany({
      where: { id: { in: plan.map((p) => p.line.id) }, tran_id: master.tran_id, line_type: { in: TRIAL_LINE_TYPES } },
      select: { id: true, qty: true },
    });
    const now = new Map(still.map((l) => [l.id, Number(l.qty) || 0]));
    if (plan.some((p) => !now.has(p.line.id) || p.kg > now.get(p.line.id) + 0.0005)) {
      throw Object.assign(new Error("These items were billed a moment ago — reload."), { userError: true });
    }

    if (inPlace) {
      await tx.transactions.updateMany({ where: { id: { in: plan.map((p) => p.line.id) } }, data: { line_type: null } });
      return { part: null, billTranId: master.tran_id };
    }

    const last = await tx.transactionsMaster.aggregate({
      _max: { dispatch_part: true },
      where: { tran_code: 6, dispatch_no: master.dispatch_no },
    });
    const part = Math.max(1, Number(last._max.dispatch_part) || 1) + 1;
    const bill = await tx.transactionsMaster.create({
      data: {
        tran_code: 6,
        dated: master.dated,
        time: master.time ?? master.dated,
        check_date: master.check_date ?? master.dated,
        pycd: master.pycd,
        godown: master.godown,
        so_no: master.so_no,
        company_id: master.company_id,
        user_id: master.user_id, // entered by whoever keyed the dispatch
        dispatch_no: master.dispatch_no,
        dispatch_part: part,
        manual_no: master.manual_no,
        rmk4: master.rmk4, // vehicle no
        city: master.city,
        route: master.route,
        rmk: `Approved trial items of dispatch ${label}: ${itemsText}`.slice(0, 250),
      },
    });
    // The number trigger keeps a part's number (prisma/sql/2026-11-19_sales_dispatch_features.sql);
    // should it not be installed, put the dispatch's number back (an UPDATE is not renumbered).
    if (bill.dispatch_no !== master.dispatch_no) {
      await tx.transactionsMaster.update({ where: { tran_id: bill.tran_id }, data: { dispatch_no: master.dispatch_no } });
    }
    for (const { line, kg, whole } of plan) {
      if (whole) {
        // the whole line moves, as it is (batch, packs, account) — now normal
        await tx.transactions.update({ where: { id: line.id }, data: { tran_id: bill.tran_id, line_type: null } });
        continue;
      }
      // part of the line: it keeps the rest on trial, the part gets the approved qty
      const share = kg / (Number(line.qty) || kg);
      const { id, tran_id, ...fields } = line;
      await tx.transactions.update({
        where: { id: line.id },
        data: {
          qty: round3(Number(line.qty) - kg),
          qty_ltr: line.qty_ltr != null ? r3(Number(line.qty_ltr) * (1 - share)) : null,
          no_of_pack: line.no_of_pack != null ? r3(Number(line.no_of_pack) * (1 - share)) : null,
        },
      });
      await tx.transactions.create({
        data: {
          ...fields,
          tran_id: bill.tran_id,
          line_type: null,
          ack_qty: null,
          qty: kg,
          qty_ltr: line.qty_ltr != null ? r3(Number(line.qty_ltr) * share) : null,
          no_of_pack: line.no_of_pack != null ? r3(Number(line.no_of_pack) * share) : null,
        },
      });
    }
    return { part, billTranId: bill.tran_id };
  }, { timeout: 60_000, maxWait: 20_000 }).catch((e) => {
    if (e.userError) return { error: e.message };
    throw e;
  });
  if (done.error) return { status: 409, body: { message: done.error } };

  const shown = done.part ? `${master.dispatch_no}-${done.part}` : label;
  return {
    status: 201,
    body: {
      message: done.part
        ? `${itemsText} moved to dispatch ${shown} (same date as ${label}) — invoice it in the list like any dispatch.`
        : `Every item of dispatch ${label} is approved — invoice it in the list like any dispatch.`,
      billingTranId: done.billTranId,
      dispatch: shown,
    },
  };
}
