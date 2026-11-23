// lib/manufacturing/processOrder.js
// ============================================================
// Process Order (productionPlanMaster) — production items, issuances, posting.
//
// One process order produces ONE OR MORE production (finished) items; every
// production item has its own issuances (raw / packing materials).
//
//   productionPlanMaster   header. finished_id / qty / batch_no / bom_id /
//                          actual_yield mirror production item (line) 1, so
//                          every single-item consumer (QC, stickers, costing,
//                          lists, notifications) keeps working unchanged.
//   productionPlanOutput   one row per production item (line_no 1..n)
//   productionPlanDetail   the issuance lines (materials + instructions) of
//                          the whole order, as before
//   productionPlanIssue    per detail row: output_line (the production item it
//                          is issued for), issue godown, unit
//
// The two new tables come from prisma/sql/2026-10-27_process_order_lines.sql.
// Until it is applied (linesReady() === false) an order reads as ONE
// production item = the master, materials issued from PRODUCTION, unit KG —
// the behaviour before this file existed — and saving more than that is
// refused with a clear message instead of silently dropping data.
//
// Posting (tran_code 7 issue + tran_code 8 production), shared by the create
// route (reprocessing / sf post immediately) and Send to Production:
//   • stock reads TRANSACTIONS_MASTER.godown, so one voucher is made PER
//     GODOWN: one tran_code 7 per issue godown, one tran_code 8 per output
//     godown. With the defaults that is one 7 + one 8, exactly as before.
//   • TM.rmk carries the old text ("... order no: <id>") and TM.rmk5 the
//     process order id — Process Order Reconciliation keys on those.
//   • every line carries Transactions.source_line_no = its production item
//     line, so issuance ↔ production item stays traceable after posting.
//   • damt / camt stay 0 (quantity vouchers; valuation is done by costing),
//     acno = the item's stock account (resolveItemAccounts), sub_tran_id 1.
// ============================================================
import prisma from "@/lib/prisma";
import { resolveProductionGodown } from "@/lib/productionGodown";
import { getProductionSetup, godownForCategory } from "@/lib/production/setup";
import { getGodownStock } from '@/lib/stock/godownStock';
import { getStockPolicy, modeOf, isExemptGodown } from '@/lib/stock/policy';
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { feature } from "@/lib/features/server";
import { yieldEditOpen, yieldEditClosedMessage } from "@/lib/production/rules";

export const DEFAULT_UNIT = "KG";

const num = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v?.value ?? v);
  return Number.isInteger(n) ? n : null;
};
const str = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const httpError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

// ── are the line tables there? ──────────────────────────────────────────
let readyCache = { value: null, at: 0 };
export async function linesReady(db = prisma) {
  if (readyCache.value === true) return true;
  if (readyCache.value === false && Date.now() - readyCache.at < 60_000) return false;
  try {
    const [row] = await db.$queryRaw`
      SELECT (to_regclass('"productionPlanOutput"') IS NOT NULL
          AND to_regclass('"productionPlanIssue"') IS NOT NULL) AS ok
    `;
    readyCache = { value: !!row?.ok, at: Date.now() };
  } catch {
    readyCache = { value: false, at: Date.now() };
  }
  return readyCache.value;
}

const NOT_READY_MESSAGE =
  "Multiple production items / custom godowns need the database update " +
  "prisma/sql/2026-10-27_process_order_lines.sql — ask the administrator to apply it.";

// ── request body → normalised order ─────────────────────────────────────
/**
 * Accepts the new body ({ outputs: [...], productionPlanDetail: [... with
 * output_line / godown / unit] }) and the old one (master finished_id / qty /
 * batch_no + productionPlanDetail [+ reprocessing_materials]).
 */
export function normalizeOrder(data = {}) {
  const raw =
    Array.isArray(data.outputs) && data.outputs.length > 0
      ? data.outputs
      : [
          {
            line_no: 1,
            finished_id: data.finished_id,
            qty: data.qty,
            actual_yield: data.actual_yield,
            batch_no: data.batch_no,
            bom_id: data.bom_id,
          },
        ];

  const outputs = raw.map((o, i) => ({
    clientLine: int(o.line_no) ?? i + 1,
    line_no: i + 1,
    finished_id: int(o.finished_id),
    bom_id: int(o.bom_id),
    qty: num(o.qty),
    actual_yield: num(o.actual_yield),
    unit: str(o.unit) || DEFAULT_UNIT,
    godown: int(o.godown),
    batch_no: str(o.batch_no),
  }));
  const lineOf = new Map(outputs.map((o) => [o.clientLine, o.line_no]));

  // Old reprocessing bodies sent their materials in reprocessing_materials
  const src = [
    ...(Array.isArray(data.productionPlanDetail) ? data.productionPlanDetail : []),
    ...(data.type === "reprocessing" && Array.isArray(data.reprocessing_materials)
      ? data.reprocessing_materials
      : []),
  ];

  const details = src.map((d, i) => {
    const material_id = int(d.material_id);
    return {
      sno: int(d.sno) ?? i + 1,
      material_id,
      material_qty: num(d.material_qty) || 0,
      material_percentage: num(d.material_percentage) || 0,
      material_desc: (str(d.material_desc) || "").slice(0, 200),
      output_line: lineOf.get(int(d.output_line) ?? 1) ?? 0,
      godown: material_id ? int(d.godown) : null,
      unit: material_id ? str(d.unit) || DEFAULT_UNIT : null,
    };
  });

  const first = outputs[0];
  return {
    outputs,
    details,
    master: {
      finished_id: first.finished_id,
      qty: first.qty,
      batch_no: first.batch_no,
      bom_id: first.bom_id,
      actual_yield: first.actual_yield,
    },
  };
}

/** Validation shared by create / update (messages shown to the user as-is). */
export function validateOrder(order, { requireIssuances = true } = {}) {
  const errors = [];
  const clientLines = order.outputs.map((output) => output.clientLine);
  if (new Set(clientLines).size !== clientLines.length) errors.push("Production item line numbers must be unique");
  order.outputs.forEach((o) => {
    const tag = order.outputs.length > 1 ? `Production item ${o.line_no}: ` : "";
    if (!o.finished_id) errors.push(`${tag}finished product is required`);
    if (!o.qty || o.qty <= 0) errors.push(`${tag}valid production quantity is required`);
    if (requireIssuances) {
      const lines = order.details.filter((d) => d.output_line === o.line_no && d.material_id);
      if (lines.length === 0) errors.push(`${tag}add at least one issuance line`);
    }
  });
  order.details.forEach((d) => {
    if (!order.outputs.some((output) => output.line_no === d.output_line)) errors.push(`Issue ${d.material_desc || d.sno}: select a valid production item`);
    if (d.material_id && !(d.material_qty > 0)) {
      errors.push(`Issuance ${d.material_desc || d.material_id}: quantity must be greater than 0`);
    }
  });
  return errors;
}

/** Every godown the order writes to (for scope / closed-godown checks). */
export async function orderGodowns(order, db = prisma) {
  const setup = await getProductionSetup();
  const ids = new Set();
  for (const o of order.outputs) {
    ids.add(o.godown ?? (await resolveProductionGodown(db, o.finished_id, setup)));
  }
  for (const d of order.details) {
    if (d.material_id) ids.add(d.godown ?? setup.productionGodown);
  }
  return [...ids].filter((id) => id !== null && id !== undefined);
}
/** Validate item / BOM references and ensure every selected godown is active. */
export async function validateOrderReferences(order, db = prisma) {
  const itemIds = [...new Set([
    ...order.outputs.map((output) => output.finished_id),
    ...order.details.map((detail) => detail.material_id),
  ].filter(Boolean))];
  const items = await db.item.findMany({ where: { itcd: { in: itemIds } }, select: { itcd: true } });
  const existingItems = new Set(items.map((item) => item.itcd));
  const missingItems = itemIds.filter((id) => !existingItems.has(id));
  if (missingItems.length) return { error: `Unknown item(s): ${missingItems.join(', ')}` };

  // A BOM is optional (it only pre-fills issuances); one that is given must
  // belong to its production item.
  const bomIds = [...new Set(order.outputs.map((output) => output.bom_id).filter(Boolean))];
  const boms = bomIds.length
    ? await db.bomMaster.findMany({ where: { id: { in: bomIds } }, select: { id: true, finished_id: true } })
    : [];
  const bomById = new Map(boms.map((bom) => [bom.id, bom]));
  for (const output of order.outputs) {
    if (!output.bom_id) continue;
    const bom = bomById.get(output.bom_id);
    if (!bom || bom.finished_id !== output.finished_id) {
      return { error: `BOM ${output.bom_id} does not belong to production item ${output.line_no}.` };
    }
  }

  const godowns = await orderGodowns(order, db);
  const activeGodowns = await db.godown.findMany({
    where: { id: { in: godowns }, is_active: true },
    select: { id: true },
  });
  const activeIds = new Set(activeGodowns.map((godown) => godown.id));
  const inactive = godowns.filter((id) => !activeIds.has(id));
  if (inactive.length) return { error: `Unknown or inactive godown(s): ${inactive.join(', ')}` };
  return { error: null, godowns };
}

/**
 * Without the line tables only the old shape can be stored: one production
 * item into its category godown, materials out of PRODUCTION in KG.
 */
async function assertStorable(order, ready, db) {
  if (ready) return;
  if (order.outputs.length > 1) throw httpError(NOT_READY_MESSAGE, 409);
  const setup = await getProductionSetup();
  const o = order.outputs[0];
  if (o.godown && o.godown !== (await resolveProductionGodown(db, o.finished_id, setup))) {
    throw httpError(NOT_READY_MESSAGE, 409);
  }
  if (order.details.some((d) => d.material_id && d.godown && d.godown !== setup.productionGodown)) {
    throw httpError(NOT_READY_MESSAGE, 409);
  }
}

// ── write ───────────────────────────────────────────────────────────────
/** Creates the detail rows (+ issue / output rows) of a plan. */
export async function saveLines(db, planId, order) {
  const ready = await linesReady();
  await assertStorable(order, ready, db);

  const created = [];
  for (const d of order.details) {
    created.push(
      await db.productionPlanDetail.create({
        data: {
          plan_id: planId,
          material_id: d.material_id,
          material_qty: d.material_qty,
          material_percentage: d.material_percentage,
          material_desc: d.material_desc,
          sno: d.sno,
        },
        select: { id: true },
      }),
    );
  }
  if (!ready) return;

  if (created.length > 0) {
    await db.productionPlanIssue.createMany({
      data: created.map((row, i) => ({
        plan_id: planId,
        detail_id: row.id,
        output_line: order.details[i].output_line,
        godown: order.details[i].godown,
        unit: order.details[i].unit,
      })),
    });
  }
  await db.productionPlanOutput.createMany({
    data: order.outputs.map((o) => ({
      plan_id: planId,
      line_no: o.line_no,
      finished_id: o.finished_id,
      bom_id: o.bom_id,
      qty: o.qty,
      actual_yield: o.actual_yield,
      unit: o.unit,
      godown: o.godown,
      batch_no: o.batch_no,
    })),
  });
}

/** Replaces every detail / issue / output row of a plan. */
export async function replaceLines(db, planId, order) {
  const ready = await linesReady();
  await assertStorable(order, ready, db);
  if (ready) {
    await db.productionPlanIssue.deleteMany({ where: { plan_id: planId } });
    await db.productionPlanOutput.deleteMany({ where: { plan_id: planId } });
  }
  await db.productionPlanDetail.deleteMany({ where: { plan_id: planId } });
  await saveLines(db, planId, order);
}

/** Stores per-line actual yields (posted plans: the only editable values). */
export async function saveOutputYields(db, planId, yields) {
  if (!(await linesReady())) return;
  for (const [line, value] of Object.entries(yields)) {
    await db.productionPlanOutput.updateMany({
      where: { plan_id: planId, line_no: Number(line) },
      data: { actual_yield: value },
    });
  }
}

// ── read ────────────────────────────────────────────────────────────────
/**
 * Output rows (by plan id) and issue rows (by detail id) of the given plans,
 * with the finished items' code / name / unit / category.
 */
export async function loadLines(planIds, db = prisma) {
  const outputsByPlan = new Map();
  const issueByDetail = new Map();
  const ids = [...new Set(planIds.filter(Boolean))];
  if (ids.length === 0 || !(await linesReady())) return { outputsByPlan, issueByDetail };

  const [outputs, issues] = await Promise.all([
    db.productionPlanOutput.findMany({
      where: { plan_id: { in: ids } },
      orderBy: [{ plan_id: "asc" }, { line_no: "asc" }],
    }),
    db.productionPlanIssue.findMany({ where: { plan_id: { in: ids } } }),
  ]);
  const itcds = [...new Set(outputs.map((o) => o.finished_id).filter(Boolean))];
  const items = itcds.length
    ? await db.item.findMany({
        where: { itcd: { in: itcds } },
        select: { itcd: true, item: true, code: true, unit: true, ic_id: true },
      })
    : [];
  const itemOf = new Map(items.map((i) => [i.itcd, i]));

  for (const o of outputs) {
    if (!outputsByPlan.has(o.plan_id)) outputsByPlan.set(o.plan_id, []);
    outputsByPlan.get(o.plan_id).push({ ...o, item: itemOf.get(o.finished_id) || null });
  }
  for (const r of issues) issueByDetail.set(r.detail_id, r);
  return { outputsByPlan, issueByDetail };
}

/**
 * The production items of a plan for the API / posting. A plan without output
 * rows (saved before the line tables, or while they are missing) is ONE
 * production item = the master, into its item-category godown.
 * `plan.item` (the master's Item row) is used for the legacy godown default.
 * `setup` = await getProductionSetup() (Settings → Production setup).
 */
export function effectiveOutputs(plan, outputRows, setup) {
  if (!setup) throw new Error("effectiveOutputs needs the production setup (getProductionSetup())");
  if (outputRows && outputRows.length > 0) {
    return outputRows.map((o) => ({
      line_no: o.line_no,
      finished_id: o.finished_id,
      item_code: o.item?.code || "",
      item_name: o.item?.item || "",
      ic_id: o.item?.ic_id ?? null,
      bom_id: o.bom_id,
      qty: o.qty,
      actual_yield: o.actual_yield,
      unit: o.unit || DEFAULT_UNIT,
      godown: o.godown ?? godownForCategory(setup, o.item?.ic_id),
      batch_no: o.batch_no || "",
    }));
  }
  return [
    {
      line_no: 1,
      finished_id: plan.finished_id,
      item_code: plan.item?.code || "",
      item_name: plan.item?.item || "",
      ic_id: plan.item?.ic_id ?? null,
      bom_id: plan.bom_id,
      qty: plan.qty,
      actual_yield: plan.actual_yield,
      unit: DEFAULT_UNIT,
      godown: plan.item ? godownForCategory(setup, plan.item.ic_id) : null,
      batch_no: plan.batch_no || "",
    },
  ];
}

/** output_line / godown / unit of one detail row (no issue row: production godown, KG). */
export function detailLine(detail, issueByDetail, setup) {
  if (!setup) throw new Error("detailLine needs the production setup (getProductionSetup())");
  const r = issueByDetail?.get(detail.id);
  return {
    output_line: r?.output_line ?? 1,
    godown: detail.material_id ? r?.godown ?? setup.productionGodown : null,
    unit: detail.material_id ? r?.unit || DEFAULT_UNIT : null,
  };
}

// ── posting ─────────────────────────────────────────────────────────────
const TEXT = {
  new: {
    issue: (id) => `Material issued for production order no: ${id}`,
    produced: (id) => `Material produced from order no: ${id}`,
    n1Issue: (id) => `Material issued for production ${id}`,
    n2Produced: (id) => `Process Order: ${id}`,
  },
  sf: {
    issue: (id) => `Material issued for SF to FG production order no: ${id}`,
    produced: (id) => `Material produced from SF to FG order no: ${id}`,
    n1Issue: (id) => `Material issued for SF to FG production ${id}`,
    n2Produced: (id) => `SF to FG Process Order: ${id}`,
  },
  reprocessing: {
    issue: (id) => `Material issued for Reprocessing order no: ${id}`,
    produced: (id) => `Material produced from Reprocessing order no: ${id}`,
    n1Issue: (id) => `Material issued for Reprocessing ${id}`,
    n2Produced: (id) => `Reprocessing Order: ${id}`,
  },
};

async function nextVrNo(tx, tranCode, day) {
  const last = await tx.transactionsMaster.findFirst({
    where: {
      dated: {
        gte: new Date(day.getFullYear(), day.getMonth(), day.getDate()),
        lt: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1),
      },
      tran_code: tranCode,
      vr_no: { not: null }, // unnumbered vouchers would sort first (NULL first in DESC)
    },
    orderBy: { vr_no: "desc" },
    select: { vr_no: true },
  });
  return (last?.vr_no || 0) + 1;
}

// Packing material (Settings → Production setup "Packing material") is never
// stock-checked when issuing for production (same rule as
// components/Material/Production/useStockValidation.js).
const fmt = (n) => (Number(n) || 0).toFixed(2);

/**
 * Lock all issue (godown, item) pairs and check the posting against stock, as
 * the stock check policy says for "processOrder" (Settings → Stock checking;
 * default Block): block → throws 422, warn → returns the shortages as warning
 * lines (the posting goes ahead), off → nothing is checked.
 * @returns {Promise<string[]>} warnings
 */
export async function assertIssueStock(tx, posting) {
  const policy = await getStockPolicy();
  const mode = modeOf(policy, 'processOrder');
  if (mode === 'off') return [];
  const itcds = [...new Set(posting.issued.map((line) => line.itcd))];
  const { packingCategoryIds } = await getProductionSetup();
  const packing = new Set(
    (itcds.length && packingCategoryIds.length
      ? await tx.item.findMany({
          where: { itcd: { in: itcds }, ic_id: { in: packingCategoryIds } },
          select: { itcd: true },
        })
      : []
    ).map((item) => item.itcd),
  );
  const needs = new Map();
  for (const line of posting.issued) {
    if (packing.has(line.itcd)) continue;
    if (isExemptGodown(policy, line.godown)) continue;
    const key = `${line.godown}:${line.itcd}`;
    needs.set(key, (needs.get(key) || 0) + line.qty);
  }
  const keys = [...needs.keys()].sort();
  for (const key of keys) {
    const [godown, itcd] = key.split(':').map(Number);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${godown}::int, ${itcd}::int)`;
  }

  const byGodown = new Map();
  for (const [key, qty] of needs) {
    const [godown, itcd] = key.split(':').map(Number);
    if (!byGodown.has(godown)) byGodown.set(godown, []);
    byGodown.get(godown).push({ itcd, qty });
  }
  const shortages = [];
  for (const [godown, lines] of byGodown) {
    const stock = await getGodownStock(lines.map((line) => line.itcd), godown, { db: tx });
    for (const line of lines) {
      const available = stock.get(line.itcd) || 0;
      if (available + 1e-6 < line.qty) {
        shortages.push(`Item ${line.itcd} in godown ${godown}: available ${fmt(available)}, required ${fmt(line.qty)}, short ${fmt(line.qty - available)}`);
      }
    }
  }
  if (!shortages.length) return [];
  if (mode === 'block') throw httpError(`Insufficient stock to issue materials:\n${shortages.join('\n')}`, 422);
  return [`Insufficient stock to issue materials (posted anyway — Settings → Stock checking is on Warn): ${shortages.join('; ')}`];
}
const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

/**
 * Builds what a plan would post — used for the scope / closed-godown checks
 * before the transaction and by postPlan inside it.
 * @param {object} plan  productionPlanMaster with productionPlanDetail + item
 * @param {{ actualYield?, actualYields?, adjustedItems? }} opts
 */
export async function buildPosting(db, plan, { actualYield, actualYields = {}, adjustedItems = {} } = {}) {
  const { outputsByPlan, issueByDetail } = await loadLines([plan.id], db);
  const setup = await getProductionSetup();
  const outputs = effectiveOutputs(plan, outputsByPlan.get(plan.id), setup);

  if (!outputs.length) throw httpError("This process order has no production items", 422);
  const produced = [];
  for (const o of outputs) {
    const godown = o.godown ?? (await resolveProductionGodown(db, o.finished_id, setup));
    const rawGiven = actualYields?.[o.line_no] ?? (o.line_no === 1 ? actualYield : undefined);
    const given = num(rawGiven);
    if (rawGiven !== undefined && rawGiven !== null && rawGiven !== "" && (given === null || given <= 0)) {
      throw httpError(`Actual yield for production item ${o.line_no} must be greater than zero`, 422);
    }
    const qty = given ?? num(o.actual_yield) ?? num(o.qty) ?? 0;
    if (!(qty > 0)) throw httpError(`Production item ${o.line_no} must have a positive quantity`, 422);
    produced.push({ ...o, godown, qty: round2(qty) });
  }

  const issued = (plan.productionPlanDetail || [])
    .filter((d) => d.material_id !== null && (plan.type !== "sf" || (d.material_percentage || 0) > 0))
    .map((d) => {
      const line = detailLine(d, issueByDetail, setup);
      const original = round2(Number(d.material_qty) || 0);
      const rawAdjusted = adjustedItems?.[d.id];
      const adjusted = rawAdjusted === undefined ? null : num(rawAdjusted);
      if (rawAdjusted !== undefined && (adjusted === null || adjusted <= 0)) {
        throw httpError(`Issue quantity for ${d.material_desc || `line ${d.id}`} must be greater than zero`, 422);
      }
      const qty = round2(adjusted ?? original);
      if (!(qty > 0)) throw httpError(`Issue quantity for ${d.material_desc || `line ${d.id}`} must be greater than zero`, 422);
      return {
        detail_id: d.id,
        itcd: int(d.material_id),
        desc: d.material_desc,
        qty,
        wastage: adjusted !== null && qty !== original ? round2(qty - original) : 0,
        godown: line.godown,
        unit: line.unit,
        output_line: line.output_line,
      };
    });
  if (!issued.length) throw httpError("This process order has no material issue lines", 422);

  const godowns = [...new Set([...produced.map((p) => p.godown), ...issued.map((i) => i.godown)])];
  return { outputs: produced, issued, godowns };
}

/**
 * Posts tran_code 7 + 8 for a plan inside a transaction and marks it Posted.
 * @param {object} tx       prisma transaction client
 * @param {object} plan     productionPlanMaster with productionPlanDetail (+ item)
 * @param {object} posting  result of buildPosting
 * @param {{ userId, m2m?: boolean, when?: Date, dated?: Date }} opts
 *   when   the moment it is sent (sent_to_production_date, voucher time)
 *   dated  the vouchers' date — postingDate() (Settings → Features
 *          "production.postingDate"); defaults to `when`
 */
export async function postPlan(tx, plan, posting, { userId, m2m = false, when = new Date(), dated } = {}) {
  const day = dated || when;
  const type = TEXT[plan.type] ? plan.type : "new";
  const text = TEXT[type];
  const { outputs, issued } = posting;

  const { lineAcno: issueAcno } = await resolveItemAccounts(
    issued.map((i) => ({ itcd: i.itcd })),
    7,
    { db: tx },
  );
  const { lineAcno: producedAcno } = await resolveItemAccounts(
    outputs.map((o) => ({ itcd: o.finished_id })),
    8,
    { db: tx },
  );

  // Prevent two concurrent process orders from allocating the same daily
  // voucher numbers. The unique index remains the final database safeguard.
  const dayKey = Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() / 86400000);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${7}::int, ${dayKey}::int)::text AS locked`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${8}::int, ${dayKey}::int)::text AS locked`;
  let vr7 = await nextVrNo(tx, 7, day);
  let vr8 = await nextVrNo(tx, 8, day);
  const header = (tranCode, vrNo, godown, rmk) => ({
    company_id: 1,
    dated: day,
    time: when,
    tran_code: tranCode,
    vr_no: vrNo,
    godown,
    rmk,
    rmk4: m2m ? "M2M" : null,
    rmk5: String(plan.id),
    user_id: userId,
  });

  // 7 — one voucher per issue godown
  const issueMasters = [];
  for (const [godown, rows] of groupBy(issued, (i) => i.godown)) {
    const tm = await tx.transactionsMaster.create({
      data: header(7, vr7++, godown, text.issue(plan.id)),
    });
    issueMasters.push(tm);
    await tx.transactions.createMany({
      data: rows.map((i) => ({
        tran_id: tm.tran_id,
        acno: issueAcno[i.itcd] ?? null,
        itcd: i.itcd,
        qty: i.qty,
        damt: 0,
        camt: 0,
        narration1: text.n1Issue(plan.id),
        narration2: i.wastage
          ? `${i.desc || ""} (with wastage: +${i.wastage.toFixed(2)} ${i.unit})`.slice(0, 250)
          : i.desc,
        unit: i.unit,
        godown,
        source_line_no: i.output_line,
      })),
    });
  }

  // 8 — one voucher per output godown
  const producedMasters = [];
  for (const [godown, rows] of groupBy(outputs, (o) => o.godown)) {
    const tm = await tx.transactionsMaster.create({
      data: header(8, vr8++, godown, text.produced(plan.id)),
    });
    producedMasters.push(tm);
    await tx.transactions.createMany({
      data: rows.map((o) => ({
        tran_id: tm.tran_id,
        acno: producedAcno[o.finished_id] ?? null,
        itcd: o.finished_id,
        qty: o.qty,
        batch_no: o.batch_no || "",
        damt: 0,
        camt: 0,
        narration1: `Production of finished goods - ${o.finished_id}`,
        narration2: text.n2Produced(plan.id),
        unit: o.unit,
        godown,
        source_line_no: o.line_no,
      })),
    });
  }

  await saveOutputYields(
    tx,
    plan.id,
    Object.fromEntries(outputs.map((o) => [o.line_no, o.qty])),
  );

  const updated = await tx.productionPlanMaster.update({
    where: { id: plan.id },
    data: {
      status: "Posted",
      sent_to_production_date: when,
      actual_yield: outputs[0]?.qty ?? null,
      transaction_id: producedMasters[0]?.tran_id ?? null,
    },
  });

  return { updated, issueMasters, producedMasters };
}

/**
 * A posted plan's actual yield changed (24h window): move the tran_code 8
 * line(s) of that production item to the new quantity.
 * @param {Array<{ line_no, finished_id, qty }>} changes
 */
export async function updatePostedYields(db, planId, changes) {
  if (!changes.length) return;
  const tms = await db.transactionsMaster.findMany({
    where: { tran_code: 8, rmk5: String(planId) },
    select: { tran_id: true },
  });
  const tranIds = tms.map((t) => t.tran_id);
  if (!tranIds.length) return;
  for (const c of changes) {
    const or = [{ source_line_no: c.line_no }];
    // vouchers posted before source_line_no was written: the finished item
    if (c.line_no === 1 && c.finished_id) or.push({ source_line_no: null, itcd: c.finished_id });
    await db.transactions.updateMany({
      where: { tran_id: { in: tranIds }, OR: or },
      data: { qty: c.qty },
    });
  }
}

// ── Settings → Features (lib/features/catalog.js, group "production") ────
/**
 * The date the issue / production vouchers carry ("production.postingDate"):
 * "sent" → now (SMS), "plan" → the process order's plan date.
 */
export async function postingDate(planDated, now = new Date()) {
  if ((await feature("production.postingDate")) === "plan" && planDated) {
    const d = new Date(planDated);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return now;
}

/** "production.yieldEditWindow": may a posted order's actual yield still change? → null or the refusal. */
export async function yieldEditError(sentAt) {
  const window = await feature("production.yieldEditWindow");
  return yieldEditOpen(window, sentAt) ? null : yieldEditClosedMessage(window);
}

/**
 * New-work rules of a process order body (BOM mode, type "new"):
 *   production.multiOutput  off → no more production items than `allowedOutputs`
 *                           (1 for a new order; an edited order keeps what it had)
 *   production.bomRequired  on  → every production item names its BOM, except one
 *                           that is unchanged from the stored order (`storedOutputs`)
 * @returns {Promise<string|null>} the refusal, or null
 */
export async function orderFeatureError(order, { type, recipeMode = false, storedOutputs = [] } = {}) {
  if (!(await feature("production.multiOutput"))) {
    const allowed = Math.max(1, storedOutputs.length);
    if (order.outputs.length > allowed) {
      return "One production item per process order (Settings → Features: several production items is off).";
    }
  }
  if (type === "new" && !recipeMode && (await feature("production.bomRequired"))) {
    const missing = order.outputs.filter((o) => {
      if (o.bom_id) return false;
      const stored = storedOutputs.find((s) => s.line_no === o.line_no);
      return !(stored && !stored.bom_id && stored.finished_id === o.finished_id);
    });
    if (missing.length) {
      const tag = order.outputs.length > 1 ? ` (production item ${missing.map((o) => o.line_no).join(", ")})` : "";
      return `Choose the BOM${tag} — process orders must name a BOM (Settings → Features).`;
    }
  }
  return null;
}
