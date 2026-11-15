// lib/dispatch/bomProduction.js
// ============================================================
// PRODUCE-ON-DISPATCH
//
// A dispatch line of a finished good carries the materials it was made from
// (`line.materials = [{ itcd, qty, godown }]` — the item's BOM scaled to the
// line qty, edited per dispatch on the form; the master BOM is never changed).
// Saving the dispatch keeps automatic vouchers in step with it:
//
//   Material Issue  tran_code 7   rmk1 = "AUTO_DISPATCH_BOM"
//                   ONE PER ISSUE GODOWN: each material row may come from its
//                   own godown (e.g. the main material from DESPATCH, a scrap
//                   item from PLANT); a row without one uses the issue godown
//                   chosen in the dispatch header ("Issue Materials From").
//                   Kept only here, never on the dispatch master.
//                   one line per material per dispatch line, valued at the
//                   material's weighted-average cost (lib/stock/averageRate.js)
//   Production      tran_code 8   rmk1 = "AUTO_DISPATCH_PROD"
//                   godown  = the dispatch godown (master.godown)
//                   one line per finished good, qty = the dispatched qty,
//                   rate = its materials' cost ÷ qty
//
//   both: rmk4 = dispatch tran_id (the link), rmk5 = dispatch_no,
//         Transactions.source_line_no = the dispatch line (1-based) a row
//         belongs to, so the form can rebuild each line's materials on edit.
//   Values sit in rate / gross_amount only (damt = camt = 0): like every other
//   quantity movement, the ledger value is posted by the costing journals.
//
// Stock follows the stock check policy (Settings → Stock checking,
// lib/stock/policy.js); both default to Block (decided 2026-10-24):
//   · "dispatchBom": each material must be in stock in its issue godown;
//   · "dispatch":    a line WITHOUT materials (no BOM, or all removed) must
//     already be in stock in the dispatch godown — nothing produces it.
// off = not checked, warn = the shortage goes into `warnings` and it saves.
// The dispatch's own previous documents are left out of the check on edit; the
// check is re-run inside the save transaction under per-(godown, item) locks,
// so two dispatches saved at once cannot both take the last stock.
//
// Created on dispatch create, rebuilt on edit, deleted with the dispatch.
// ============================================================
import prisma from "@/lib/prisma";
import { getGodownStock } from "@/lib/stock/godownStock";
import { averageRates } from "@/lib/stock/averageRate";
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { getStockPolicy, modeOf, isExemptGodown, stricterMode } from "@/lib/stock/policy";

export const BOM_ISSUE_MARKER = "AUTO_DISPATCH_BOM";
export const BOM_PROD_MARKER = "AUTO_DISPATCH_PROD";

const EPS = 1e-6;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const fmt = (n) => round4(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const refused = (message) => Object.assign(new Error(message), { statusCode: 422 });

const intOf = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The dispatch lines that carry materials, as
 * [{ lineNo, fgItcd, fgQty, materials: [{ itcd, qty, godown }] }].
 * `lines` must be the final, unit-resolved lines in save order (qty in KG).
 * A material row without its own godown takes `defaultGodown` (the header's
 * issue godown; null when none was chosen). Same material from the same
 * godown twice on one line is merged; zero-qty rows are dropped.
 */
export function bomInputs(lines, defaultGodown = null) {
  const out = [];
  (lines || []).forEach((line, index) => {
    if (!Array.isArray(line?.materials)) return;
    const fgItcd = intOf(line.itcd);
    const fgQty = Number(line.qty) || 0;
    const merged = new Map(); // "itcd:godown" → { itcd, qty, godown }
    for (const m of line.materials) {
      const itcd = intOf(m?.itcd);
      const qty = Number(m?.qty);
      if (m?.itcd == null && !m?.qty) continue; // empty row left on the form
      if (!itcd) throw badRequest(`Line ${index + 1}: a material row has no item.`);
      if (!Number.isFinite(qty) || qty < 0) throw badRequest(`Line ${index + 1}: material quantity must be a positive number.`);
      if (qty === 0) continue;
      if (itcd === fgItcd) throw badRequest(`Line ${index + 1}: an item cannot be a material of itself.`);
      const godown = intOf(m?.godown) ?? intOf(defaultGodown);
      const key = `${itcd}:${godown ?? ""}`;
      const cur = merged.get(key) || { itcd, qty: 0, godown };
      cur.qty += qty;
      merged.set(key, cur);
    }
    if (!merged.size) return;
    if (!fgItcd || fgQty <= 0) throw badRequest(`Line ${index + 1}: materials need a finished item with a quantity.`);
    out.push({ lineNo: index + 1, fgItcd, fgQty, materials: [...merged.values()] });
  });
  return out;
}

/**
 * The dispatch's automatic Material Issue(s) / Production (+ packing).
 * `issueRows` = [{ tran_id, godown }] of the Material Issues (one per godown).
 */
export async function findDispatchBomVouchers(db, dispatchTranId) {
  if (!dispatchTranId) return { issue: [], issueRows: [], prod: [], packing: [] };
  const rows = await db.transactionsMaster.findMany({
    where: {
      rmk4: String(dispatchTranId),
      OR: [
        { tran_code: 7, rmk1: BOM_ISSUE_MARKER },
        { tran_code: 8, rmk1: BOM_PROD_MARKER },
        { tran_code: 7, rmk1: "AUTO_PACKING" },
      ],
    },
    select: { tran_id: true, tran_code: true, rmk1: true, godown: true },
    orderBy: { tran_id: "asc" },
  });
  const issueRows = rows
    .filter((r) => r.rmk1 === BOM_ISSUE_MARKER)
    .map((r) => ({ tran_id: r.tran_id, godown: r.godown }));
  return {
    issue: issueRows.map((r) => r.tran_id),
    issueRows,
    prod: rows.filter((r) => r.rmk1 === BOM_PROD_MARKER).map((r) => r.tran_id),
    packing: rows.filter((r) => r.rmk1 === "AUTO_PACKING").map((r) => r.tran_id),
  };
}

// Serialise concurrent dispatches on the same stock: one transaction-scoped
// advisory lock per (godown, item), taken in a fixed order (no deadlocks).
// Released automatically at commit / rollback.
async function lockStock(tx, keys) {
  const sorted = [...new Set(keys)].sort();
  for (const key of sorted) {
    const [godown, itcd] = key.split(":").map(Number);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${godown}::int, ${itcd}::int)`;
  }
}

/**
 * Validate, stock-check and value a dispatch's materials. Throws 400 / 422
 * with a message naming every short item. Read-only, except that with
 * `lock: true` (pass the save transaction as `db`) it first takes the stock
 * locks, so the check and the write cannot interleave with another dispatch.
 * `issueGodown` is the header's default; each material may name its own.
 * @returns {Promise<{ inputs, issueLines, prodLines, warnings, issueGodown, issueGodowns, dispatchGodown }>}
 *   issueGodowns = every godown a material is issued from (sorted)
 */
export async function planDispatchBom({
  db = prisma, lines, master, issueGodown: issueGodownIn = null, dispatchTranId = null, lock = false,
}) {
  const issueGodown = intOf(issueGodownIn);
  const inputs = bomInputs(lines, issueGodown);
  const dispatchGodown = intOf(master?.godown);
  const noGodown = inputs.find((i) => i.materials.some((m) => !m.godown));
  if (noGodown) {
    throw badRequest(`Line ${noGodown.lineNo}: choose the godown the materials are issued from.`);
  }
  const issueGodowns = [...new Set(inputs.flatMap((i) => i.materials.map((m) => m.godown)))].sort((a, b) => a - b);

  const existing = await findDispatchBomVouchers(db, dispatchTranId);
  // Everything this dispatch posted before (the dispatch, its auto Material
  // Issue / Production and its packing consumption) is left out of the check.
  const ownIds = [dispatchTranId, ...existing.issue, ...existing.prod, ...existing.packing].filter(Boolean);

  // Lines nothing produces must already be in the dispatch godown.
  const producedLineNos = new Set(inputs.map((i) => i.lineNo));
  const fgNeeds = new Map();
  (lines || []).forEach((line, index) => {
    if (producedLineNos.has(index + 1)) return;
    const itcd = intOf(line?.itcd);
    const qty = Number(line?.qty) || 0;
    if (itcd && qty > 0) fgNeeds.set(itcd, (fgNeeds.get(itcd) || 0) + qty);
  });

  const materialNeeds = new Map(); // "godown:itcd" → { godown, itcd, qty }
  for (const i of inputs) for (const m of i.materials) {
    const key = `${m.godown}:${m.itcd}`;
    const cur = materialNeeds.get(key) || { godown: m.godown, itcd: m.itcd, qty: 0 };
    cur.qty += m.qty;
    materialNeeds.set(key, cur);
  }
  const materialItcds = [...new Set([...materialNeeds.values()].map((n) => n.itcd))];

  const allItcds = [...new Set([...fgNeeds.keys(), ...materialItcds, ...inputs.map((i) => i.fgItcd)])];
  const items = allItcds.length
    ? await db.item.findMany({ where: { itcd: { in: allItcds } }, select: { itcd: true, item: true, unit: true } })
    : [];
  const nameOf = new Map(items.map((i) => [i.itcd, i.item || `Item #${i.itcd}`]));
  const unitOf = new Map(items.map((i) => [i.itcd, i.unit || "KG"]));
  const unknown = allItcds.filter((id) => !nameOf.has(id));
  if (unknown.length) throw badRequest(`Unknown item code(s): ${unknown.join(", ")}`);

  // Needs per (godown, item). When a material is issued from the dispatch
  // godown itself, an item that is both a material and an unproduced line is
  // checked against its COMBINED need, not twice against the same stock.
  // Policy: a type set to "off" adds no need; an exempt godown is not checked.
  const policy = await getStockPolicy();
  const fgMode = modeOf(policy, "dispatch");
  const bomMode = modeOf(policy, "dispatchBom");
  const needs = new Map(); // "godown:itcd" → { godown, itcd, qty, fg, mode }
  const addNeed = (godown, itcd, qty, fg) => {
    const mode = fg ? fgMode : bomMode;
    if (mode === "off" || isExemptGodown(policy, godown)) return;
    const key = `${godown}:${itcd}`;
    const cur = needs.get(key) || { godown, itcd, qty: 0, fg: false, mode };
    cur.qty += qty;
    cur.fg = cur.fg || fg;
    cur.mode = stricterMode(cur.mode, mode);
    needs.set(key, cur);
  };
  for (const n of materialNeeds.values()) addNeed(n.godown, n.itcd, n.qty, false);
  if (dispatchGodown) for (const [itcd, qty] of fgNeeds) addNeed(dispatchGodown, itcd, qty, true);

  if (lock) await lockStock(db, [...needs.keys()]);

  const byGodown = new Map();
  for (const n of needs.values()) {
    if (!byGodown.has(n.godown)) byGodown.set(n.godown, []);
    byGodown.get(n.godown).push(n.itcd);
  }
  const stock = new Map();
  for (const [godown, itcds] of byGodown) {
    const got = await getGodownStock(itcds, godown, { db, excludeTranIds: ownIds });
    for (const [itcd, qty] of got) stock.set(`${godown}:${itcd}`, qty);
  }

  const godownNames = byGodown.size
    ? new Map((await db.godown.findMany({
      where: { id: { in: [...byGodown.keys()] } },
      select: { id: true, godown: true },
    })).map((g) => [g.id, g.godown]))
    : new Map();
  const short = [];
  const shortWarn = [];
  for (const [key, n] of needs) {
    const have = stock.get(key) || 0;
    if (n.qty > have + EPS) {
      const name = godownNames.get(n.godown) || `godown ${n.godown}`;
      const where = n.godown === dispatchGodown ? `${name} (the dispatch godown)` : name;
      const note = n.fg ? " (a line without materials, so nothing is produced for it)" : "";
      (n.mode === "block" ? short : shortWarn)
        .push(`${nameOf.get(n.itcd)}: need ${fmt(n.qty)}, available ${fmt(have)} in ${where}${note}`);
    }
  }
  if (short.length) throw refused(`Not enough stock — ${short.join("; ")}.`);
  const stockWarnings = shortWarn.length
    ? [`Not enough stock (saved anyway — Settings → Stock checking is on Warn) — ${shortWarn.join("; ")}.`]
    : [];

  if (!inputs.length) {
    return { inputs, issueLines: [], prodLines: [], warnings: stockWarnings, issueGodown, issueGodowns, dispatchGodown };
  }

  const dated = master?.dated ? new Date(master.dated) : new Date();
  const rates = await averageRates(materialItcds, dated, { db });
  const [{ lineAcno: issueAcno }, { lineAcno: prodAcno }] = await Promise.all([
    resolveItemAccounts(materialItcds.map((itcd) => ({ itcd })), 7, { db }),
    resolveItemAccounts(inputs.map((i) => ({ itcd: i.fgItcd })), 8, { db }),
  ]);

  const warnings = [...stockWarnings];
  const unpriced = materialItcds.filter((itcd) => !(rates.get(itcd) > 0));
  if (unpriced.length) {
    warnings.push(`No cost found for ${unpriced.map((i) => nameOf.get(i)).join(", ")} — issued at 0, so the finished goods are under-valued.`);
  }

  const issueLines = [];
  const prodLines = [];
  for (const i of inputs) {
    let cost = 0;
    for (const m of i.materials) {
      const rate = rates.get(m.itcd) || 0;
      const value = round2(m.qty * rate);
      cost += value;
      issueLines.push({
        itcd: m.itcd, qty: m.qty, rate, gross_amount: value, godown: m.godown,
        acno: issueAcno[m.itcd] ?? null, source_line_no: i.lineNo,
        narration2: nameOf.get(m.itcd), unit: unitOf.get(m.itcd),
      });
    }
    prodLines.push({
      itcd: i.fgItcd, qty: i.fgQty, rate: round4(cost / i.fgQty), gross_amount: round2(cost),
      acno: prodAcno[i.fgItcd] ?? null, source_line_no: i.lineNo,
      narration2: nameOf.get(i.fgItcd), unit: unitOf.get(i.fgItcd),
    });
  }
  return { inputs, issueLines, prodLines, warnings, issueGodown, issueGodowns, dispatchGodown };
}

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

async function nextDailyVrNo(tx, tran_code, dated) {
  const dayStart = new Date(dated.getFullYear(), dated.getMonth(), dated.getDate());
  const dayEnd = new Date(dated.getFullYear(), dated.getMonth(), dated.getDate() + 1);
  const last = await tx.transactionsMaster.findFirst({
    where: { tran_code, dated: { gte: dayStart, lt: dayEnd } },
    orderBy: { vr_no: "desc" },
    select: { vr_no: true },
  });
  return (last?.vr_no ?? 0) + 1;
}

async function upsertAuto(tx, existingIds, header, lines) {
  const [keep, ...extra] = existingIds;
  for (const id of extra) {
    await tx.transactions.deleteMany({ where: { tran_id: id } });
    await tx.transactionsMaster.delete({ where: { tran_id: id } });
  }
  if (!lines.length) {
    if (keep) {
      await tx.transactions.deleteMany({ where: { tran_id: keep } });
      await tx.transactionsMaster.delete({ where: { tran_id: keep } });
    }
    return null;
  }
  let tranId = keep;
  if (keep) {
    // Numbers are per day ((dated, tran_code, vr_no) is unique): moved to
    // another day (the dispatch's date was edited) → the next number there.
    const stored = await tx.transactionsMaster.findUnique({ where: { tran_id: keep }, select: { dated: true } });
    const moved = !stored?.dated || !sameDay(stored.dated, header.dated);
    await tx.transactionsMaster.update({
      where: { tran_id: keep },
      data: { ...header, ...(moved && { vr_no: await nextDailyVrNo(tx, header.tran_code, header.dated) }) },
    });
    await tx.transactions.deleteMany({ where: { tran_id: keep } });
  } else {
    const created = await tx.transactionsMaster.create({
      data: { ...header, vr_no: await nextDailyVrNo(tx, header.tran_code, header.dated) },
      select: { tran_id: true },
    });
    tranId = created.tran_id;
  }
  await tx.transactions.createMany({
    data: lines.map((l) => ({
      tran_id: tranId,
      sub_tran_id: 1,
      itcd: l.itcd,
      qty: l.qty,
      rate: l.rate,
      gross_amount: l.gross_amount,
      godown: header.godown,
      acno: l.acno,
      damt: 0,
      camt: 0,
      unit: l.unit || "KG",
      source_line_no: l.source_line_no,
      narration1: header.rmk,
      narration2: l.narration2 ?? null,
    })),
  });
  return tranId;
}

/**
 * Write (create / rebuild / remove) the dispatch's auto Material Issue(s) and
 * Production from a planDispatchBom() result. Call inside the dispatch's
 * transaction, after the dispatch master exists. One Material Issue per issue
 * godown: an existing one for the same godown is rebuilt in place (keeps its
 * tran_id / vr_no), spare ones are reused, any left over are removed.
 */
export async function syncDispatchBom(tx, dispatch, plan) {
  const existing = await findDispatchBomVouchers(tx, dispatch.tran_id);
  const dated = dispatch.dated ? new Date(dispatch.dated) : new Date();
  const ref = dispatch.dispatch_no ?? dispatch.tran_id;
  const common = {
    company_id: dispatch.company_id ?? 1,
    dated,
    time: dated,
    rmk4: String(dispatch.tran_id),
    rmk5: dispatch.dispatch_no != null ? String(dispatch.dispatch_no) : null,
    user_id: dispatch.user_id ?? null,
  };

  const byGodown = new Map();
  for (const l of plan.issueLines) {
    const g = intOf(l.godown) ?? intOf(plan.issueGodown);
    if (!byGodown.has(g)) byGodown.set(g, []);
    byGodown.get(g).push(l);
  }
  const pool = [...existing.issueRows];
  const issueIds = [];
  for (const godown of [...byGodown.keys()].sort((a, b) => a - b)) {
    let at = pool.findIndex((r) => r.godown === godown);
    if (at < 0 && pool.length && !byGodown.has(pool[0].godown)) at = 0;
    const keep = at >= 0 ? pool.splice(at, 1)[0].tran_id : null;
    issueIds.push(await upsertAuto(tx, keep ? [keep] : [], {
      ...common,
      tran_code: 7,
      godown,
      rmk: `Materials issued for dispatch no: ${ref}`,
      rmk1: BOM_ISSUE_MARKER,
    }, byGodown.get(godown)));
  }
  for (const r of pool) await upsertAuto(tx, [r.tran_id], {}, []);

  const prodId = await upsertAuto(tx, existing.prod, {
    ...common,
    tran_code: 8,
    godown: intOf(dispatch.godown),
    rmk: `Produced for dispatch no: ${ref}`,
    rmk1: BOM_PROD_MARKER,
  }, plan.prodLines);
  return { issueId: issueIds[0] ?? null, issueIds, prodId };
}

/** Remove a dispatch's auto Material Issue / Production (dispatch deleted). */
export async function deleteDispatchBom(tx, dispatchTranId) {
  const existing = await findDispatchBomVouchers(tx, dispatchTranId);
  for (const id of [...existing.issue, ...existing.prod]) {
    await tx.transactions.deleteMany({ where: { tran_id: id } });
    await tx.transactionsMaster.delete({ where: { tran_id: id } });
  }
}

/**
 * For the edit form: the header's issue godown (the one most materials come
 * from) and each dispatch line's materials with the godown each is issued from.
 * @returns {Promise<{ issueGodown: number|null, byLine: Record<number, Array<{itcd, item, qty, rate, godown, godownName}>> }>}
 */
export async function loadDispatchBom(dispatchTranId, { db = prisma } = {}) {
  const existing = await findDispatchBomVouchers(db, dispatchTranId);
  const byLine = {};
  if (!existing.issueRows.length) return { issueGodown: null, byLine };
  const masterGodown = new Map(existing.issueRows.map((r) => [r.tran_id, r.godown]));
  const rows = await db.transactions.findMany({
    where: { tran_id: { in: existing.issue }, sub_tran_id: 1 },
    select: {
      tran_id: true, itcd: true, qty: true, rate: true, godown: true, source_line_no: true,
      itemDetails: { select: { item: true } },
    },
    orderBy: { id: "asc" },
  });
  const godownIds = [...new Set(rows.map((r) => r.godown ?? masterGodown.get(r.tran_id)).filter(Boolean))];
  const names = new Map((await db.godown.findMany({
    where: { id: { in: godownIds } },
    select: { id: true, godown: true },
  })).map((g) => [g.id, g.godown]));

  const rowsPerGodown = new Map();
  for (const r of rows) {
    const godown = r.godown ?? masterGodown.get(r.tran_id) ?? null;
    rowsPerGodown.set(godown, (rowsPerGodown.get(godown) || 0) + 1);
    const key = r.source_line_no ?? 0;
    (byLine[key] ||= []).push({
      itcd: r.itcd, item: r.itemDetails?.item ?? null, qty: r.qty, rate: r.rate,
      godown, godownName: names.get(godown) ?? null,
    });
  }
  const issueGodown = [...rowsPerGodown].sort((a, b) => b[1] - a[1])[0]?.[0] ?? existing.issueRows[0].godown ?? null;
  return { issueGodown, byLine };
}
