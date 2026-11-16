// lib/orders/soPlan.js — Sale Order line → dispatch Production Plan line.
// Features → Sale Order → "Plan production from the Sale Order line"
// (saleOrder.planFromOrder). SERVER ONLY; every caller checks the switch.
//
//   addSoPlanLines     the line's Create button (POST /api/orders/saleOrder/plan):
//                      the line goes to the DISPATCH plan of its Plan Date — that
//                      day's latest plan, or a new plan dated that day. Plan Date /
//                      Plan Qty are kept on the Sale Order line too
//                      (OrderDetail.plan_date / plan_qty).
//   planApprovedOrder  a saved order that is not (or no longer) waiting for
//                      approval: its marked lines (plan_date / plan_qty stored by
//                      the orders route) are planned; lines already in a plan
//                      are skipped. Called by the orders route and the Sale Order
//                      approval route.
//   soPlanLinesError   the order's own Plan Qty / Plan Date checks, run by the
//                      orders route before saving.
//
// The plan's godowns are Settings → Production setup (production godown =
// Required By, "Production plan: required from" = Required From) — never a
// fixed id. Days are plain calendar dates (date-only, stored at UTC midnight,
// the way the Production Plan form saves them).
import prisma from "@/lib/prisma";
import { checkPeriodLock } from "@/lib/periodLock";
import { closedGodownError } from "@/lib/godowns";
import { emit } from "@/lib/notifications/emit";
import { NOTIFICATION_TYPES } from "@/lib/notifications/config";
import { getProductionSetup } from "@/lib/production/setup";
import { planDuplicateError, planQtyError } from "@/lib/production/planDuplicates";

const PLAN_CATEGORY = "DISPATCH";
const PLAN_TRAN_CODE = 1000; // period-lock code of requisitions / plans

const valOf = (v) => (v && typeof v === "object" ? v.value : v);
const isSet = (v) => v !== undefined && v !== null && v !== "";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD on the server's calendar. */
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const dayStart = (day) => new Date(`${day}T00:00:00.000Z`);
const dayEnd = (day) => new Date(`${day}T23:59:59.999Z`);
const fmtDay = (day) =>
  dayStart(day).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** A line the user marked for planning (Create on a new order, or a Plan Date / Qty of its own). */
export const isPlanMarked = (l) => Boolean(valOf(l?.itcd)) && Boolean(l?.plan_pending || isSet(l?.plan_date) || isSet(l?.plan_qty));

/**
 * The orders route stores a marked line's plan values on OrderDetail:
 * { plan_date, plan_qty } (an unreadable date → today, no qty → the line qty),
 * or {} for an unmarked line.
 */
export function planFieldsOf(detail) {
  if (!isPlanMarked(detail)) return {};
  const d = String(detail.plan_date ?? "").slice(0, 10);
  return {
    plan_date: dayStart(DAY_RE.test(d) ? d : todayKey()),
    plan_qty: Number(detail.plan_qty) > 0 ? Number(detail.plan_qty) : Number(detail.qty) || null,
  };
}

/**
 * Plan Qty above the line's ordered qty on the order being saved, or null. (A
 * Plan Date already passed is moved to today when the line is planned.)
 */
export function soPlanLinesError(lines) {
  const errors = [];
  for (const l of lines || []) {
    if (!isPlanMarked(l)) continue;
    if (isSet(l.plan_qty) && Number(l.plan_qty) > (Number(l.qty) || 0) + 0.0001) {
      errors.push(`Item ${valOf(l.itcd)}: Plan Qty (${l.plan_qty}) cannot be more than the order qty (${Number(l.qty) || 0})`);
    }
  }
  return errors.length ? errors.join("; ") : null;
}

// "SO 10489 added to Production Plan #120" → whoever Admin → Notifications
// routes event soPlanLineAdded to. Never throws.
async function notifyPlanLines({ soNo, customer, planNo, day, dayLines, session }) {
  try {
    const items = await prisma.item.findMany({
      where: { itcd: { in: dayLines.map((v) => v.itcd) } },
      select: { itcd: true, code: true, item: true },
    });
    const itemBy = new Map(items.map((i) => [i.itcd, i]));
    const list = dayLines
      .map((v) => {
        const it = itemBy.get(v.itcd);
        return `${it ? [it.code, it.item].filter(Boolean).join(" - ") : v.itcd} (${v.planQty})`;
      })
      .join(", ");
    await emit(prisma, "soPlanLineAdded", {
      title: `SO ${soNo} added to Production Plan #${planNo}`,
      message:
        `Sale Order ${soNo}${customer ? ` — ${customer}` : ""}: ${dayLines.length} item(s) added to ` +
        `Production Plan #${planNo} (${fmtDay(day)}): ${list}.`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "requisition",
      entityId: planNo,
      actorUserId: session?.user?.id ?? null,
      vars: { so_no: soNo, plan_no: planNo, items: list },
    });
  } catch (err) {
    console.error("Plan line notification error:", err);
  }
}

/** Adds the lines to their Plan Date's plan. Never throws: { ok, status, message, tran_id? }. */
export async function addSoPlanLines({ soNo, lines, session }) {
  try {
    soNo = Number(valOf(soNo)) || null;
    if (!soNo) return { ok: false, status: 400, message: "Sale Order no is required" };
    if (!lines?.length) return { ok: false, status: 400, message: "Nothing to plan" };

    const order = await prisma.orderMaster.findUnique({
      where: { order_no: soNo },
      include: { orderDetails: { select: { itcd: true, qty: true } }, acno: { select: { acname: true } } },
    });
    if (!order) return { ok: false, status: 404, message: `Sale Order ${soNo} not found` };
    if (order.dispatchWithoutGodown === true) {
      return { ok: false, status: 422, message: `Sale Order ${soNo} is dispatched without godown — it is not planned.` };
    }

    const orderedQty = new Map();
    for (const d of order.orderDetails) {
      orderedQty.set(Number(d.itcd), (orderedQty.get(Number(d.itcd)) || 0) + (Number(d.qty) || 0));
    }

    const today = todayKey();
    const errors = [];
    const valid = [];
    for (const l of lines) {
      const itcd = Number(valOf(l.itcd));
      const planDate = String(l.plan_date || "").slice(0, 10);
      const planQty = Number(l.plan_qty);
      if (!itcd || !orderedQty.has(itcd)) errors.push(`Item ${itcd || "?"} is not on Sale Order ${soNo}`);
      else if (!DAY_RE.test(planDate)) errors.push(`Item ${itcd}: Plan Date is required`);
      else if (planDate < today) errors.push(`Item ${itcd}: Plan Date cannot be before today`);
      else if (!(planQty > 0)) errors.push(`Item ${itcd}: Plan Qty is required`);
      else valid.push({ itcd, planDate, planQty });
    }
    if (errors.length) return { ok: false, status: 422, message: errors.join("; ") };

    const pairs = valid.map((v) => ({ so_no: soNo, itcd: v.itcd, qty: v.planQty }));
    // One Sale Order item is planned once from its order (any plan, not twice here)
    const dupError = await planDuplicateError({ lines: pairs });
    if (dupError) return { ok: false, status: 409, message: dupError };
    // Plan qty over every plan ≤ ordered qty; nothing already dispatched
    const qtyError = await planQtyError({ lines: pairs });
    if (qtyError) return { ok: false, status: 409, message: qtyError };

    const byDate = new Map();
    for (const v of valid) {
      if (!byDate.has(v.planDate)) byDate.set(v.planDate, []);
      byDate.get(v.planDate).push(v);
    }

    const targets = [];
    let needsNewPlan = false;
    for (const [day, dayLines] of byDate) {
      const plan = await prisma.reqMaster.findFirst({
        where: { req_catagory: PLAN_CATEGORY, dated: { gte: dayStart(day), lte: dayEnd(day) } },
        orderBy: { tran_id: "desc" },
      });
      const lockError = plan
        ? await checkPeriodLock([plan.dated], PLAN_TRAN_CODE, { action: "update" })
        : await checkPeriodLock(dayStart(day), PLAN_TRAN_CODE, { action: "create" });
      if (lockError) return { ok: false, status: 422, message: lockError };
      if (!plan) needsNewPlan = true;
      targets.push({ day, plan, dayLines });
    }

    const setup = await getProductionSetup();
    const requiredBy = setup.productionGodown;
    const requiredFrom = setup.planFromGodown;
    if (needsNewPlan) {
      const godownError = await closedGodownError([requiredFrom, requiredBy]);
      if (godownError) return { ok: false, status: 422, message: godownError };
    }

    // Entered by = the signed-in user's id (ReqMaster.userid, same as the requisition route).
    const userid = String(session?.user?.id || "system").slice(0, 25);

    const planNos = await prisma.$transaction(async (tx) => {
      const nos = [];
      for (const { day, plan, dayLines } of targets) {
        const m =
          plan ||
          (await tx.reqMaster.create({
            data: {
              userid,
              dated: dayStart(day),
              issued_for: requiredFrom,
              issued_by: requiredBy,
              req_catagory: PLAN_CATEGORY,
              so_no: soNo,
            },
          }));
        for (const v of dayLines) {
          await tx.reqDetail.create({
            data: {
              tran_id: m.tran_id,
              itcd: v.itcd,
              qty: v.planQty,
              so_no: soNo,
              ordered_qty: orderedQty.get(v.itcd),
              dated: dayStart(v.planDate),
            },
          });
          await tx.orderDetail.updateMany({
            where: { order_no: soNo, itcd: v.itcd },
            data: { plan_date: dayStart(v.planDate), plan_qty: v.planQty },
          });
        }
        nos.push(m.tran_id);
      }
      return nos;
    });

    for (const [i, { day, dayLines }] of targets.entries()) {
      notifyPlanLines({ soNo, customer: order.acno?.acname, planNo: planNos[i], day, dayLines, session });
    }

    return { ok: true, status: 200, tran_id: planNos[planNos.length - 1], message: `Added to Plan #${planNos.join(", #")}` };
  } catch (error) {
    console.error("Error adding Sale Order lines to plan:", error);
    return { ok: false, status: 500, message: `Plan not created: ${error.message}` };
  }
}

/**
 * A saved Sale Order that is not waiting for approval: plan its marked lines
 * (OrderDetail.plan_date / plan_qty) that are not in a dispatch plan yet. A
 * Plan Date already passed moves to today. Never throws; null when nothing to plan.
 */
export async function planApprovedOrder({ soNo, session }) {
  try {
    soNo = Number(soNo) || null;
    if (!soNo) return null;
    const order = await prisma.orderMaster.findUnique({
      where: { order_no: soNo },
      select: { dispatchWithoutGodown: true },
    });
    if (!order || order.dispatchWithoutGodown === true) return null;
    const lines = await prisma.orderDetail.findMany({
      where: { order_no: soNo, OR: [{ plan_date: { not: null } }, { plan_qty: { not: null } }] },
      select: { itcd: true, qty: true, plan_date: true, plan_qty: true },
    });
    if (!lines.length) return null;

    const planned = await prisma.reqDetail.findMany({
      where: { so_no: soNo, master: { req_catagory: PLAN_CATEGORY } },
      select: { itcd: true },
    });
    const plannedItems = new Set(planned.map((p) => Number(p.itcd)));

    const today = todayKey();
    const seen = new Set();
    const toPlan = [];
    for (const l of lines) {
      const itcd = Number(l.itcd);
      if (!itcd || plannedItems.has(itcd) || seen.has(itcd)) continue;
      seen.add(itcd);
      const day = l.plan_date ? new Date(l.plan_date).toISOString().slice(0, 10) : today;
      toPlan.push({ itcd, plan_date: day < today ? today : day, plan_qty: l.plan_qty ?? l.qty });
    }
    if (!toPlan.length) return null;
    return await addSoPlanLines({ soNo, lines: toPlan, session });
  } catch (error) {
    console.error("Error planning approved Sale Order:", error);
    return { ok: false, status: 500, message: `Plan not created: ${error.message}` };
  }
}
