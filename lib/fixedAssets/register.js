// lib/fixedAssets/register.js — the Fixed Asset Register.
//
//   registerFromGrn(tx, grnTranId)  every asset unit of a Fixed Assets GRN
//                                   (Transactions rows with asset_no) becomes a
//                                   fixed_assets row + an ADDITION movement, and
//                                   (Settings → Fixed assets "JV") one system
//                                   journal FA_CAPITALISATION: Dr each category's
//                                   asset cost (or depreciation expense for units
//                                   under the minimum capitalisation value),
//                                   Cr the GRN's vendor. Runs inside the GRN's
//                                   own save transaction.
//   backfillFromGrns(actor)         the same for GRNs saved before (register only,
//                                   no journal — their cost was booked already)
//   loadAssets({ where, asOf })     assets with their rules, accumulated
//                                   depreciation, NBV, holder and status as of a day
//
// Asset numbers stay the GRN's (app/api/assets/generate-asset-no). Every write
// goes through `prisma` / the caller's tx (audited, rule 10).
import prisma from "@/lib/prisma";
import { getFaSettings, formatAssetNo } from "@/lib/fixedAssets/settings";
import { categoryAccounts, needAccount } from "@/lib/fixedAssets/accounts";
import { postJournal } from "@/lib/fixedAssets/journal";
import { FaError } from "@/lib/fixedAssets/errors";
import { r2, dayKey, ymOf, monthEnd, resolveAssetRules } from "@/lib/fixedAssets/calc";

const FIXED_ASSET_PREFIX = "FIXED ASSET";
const toInt = (v) => {
  const n = parseInt(v?.value ?? v, 10);
  return Number.isFinite(n) ? n : null;
};

/** GRN "Life Pattern" + "Life Span" → months (YEARS / MONTHS; production-based patterns have no months). */
function lifeMonthsOf(row) {
  const span = Number(row.wht_rate);
  if (!(span > 0)) return null;
  const pattern = String(row.narration4 || "YEARS").trim().toUpperCase();
  if (pattern.startsWith("YEAR")) return Math.round(span * 12);
  if (pattern.startsWith("MONTH")) return Math.round(span);
  return null;
}

/** Fixed-asset category ids (main category starts "FIXED ASSET"). */
export async function fixedAssetCategoryIds(db = prisma) {
  const cats = await db.itemCategory.findMany({
    where: { mainCategory: { mc_name: { startsWith: FIXED_ASSET_PREFIX, mode: "insensitive" } } },
    select: { id: true },
  });
  return cats.map((c) => c.id);
}

/**
 * Register the asset units of one GRN. `capitalise` false = register only.
 * @returns {{ registered: number, expensed: number, journal: {tran_id, vr_no} | null }}
 */
export async function registerFromGrn(tx, grnTranId, { actor = null, settings = null, capitalise = true } = {}) {
  const s = settings ?? (await getFaSettings({ db: tx }));
  const master = await tx.transactionsMaster.findUnique({ where: { tran_id: grnTranId } });
  if (!master || master.tran_code !== 14) return { registered: 0, expensed: 0, journal: null };
  const rows = await tx.transactions.findMany({
    where: { tran_id: grnTranId, asset_no: { not: null } },
    orderBy: { asset_no: "asc" },
  });
  if (!rows.length) return { registered: 0, expensed: 0, journal: null };
  const done = new Set(
    (await tx.fixedAsset.findMany({ where: { asset_no: { in: rows.map((r) => r.asset_no) } }, select: { asset_no: true } })).map((a) => a.asset_no),
  );
  const todo = rows.filter((r) => !done.has(r.asset_no));
  if (!todo.length) return { registered: 0, expensed: 0, journal: null };

  const items = await tx.item.findMany({ where: { itcd: { in: [...new Set(todo.map((r) => r.itcd).filter(Boolean))] } }, select: { itcd: true, item: true, ic_id: true } });
  const itemBy = new Map(items.map((i) => [i.itcd, i]));
  const department_id = toInt(master.rmk4);
  const employee_id = toInt(master.rmk5);
  const employee = employee_id ? await tx.employee.findUnique({ where: { id: employee_id }, select: { workLocationId: true } }) : null;
  const location_id = employee?.workLocationId ?? null;
  const inService = dayKey(master.dated) ?? dayKey(new Date());
  const min = Number(s.minCapitalisationValue) || 0;
  const postJv = capitalise && s.grnCapitalisation === "JV";

  const plan = todo.map((r) => {
    const item = itemBy.get(r.itcd);
    const cost = r2(r.damt || (Number(r.rate) || 0) * (Number(r.qty) || 1));
    return { row: r, item, ic_id: item?.ic_id ?? null, cost, expense: min > 0 && cost < min };
  });

  let accounts = null;
  if (postJv && plan.some((p) => p.cost > 0)) {
    if (!master.pycd) throw new FaError("The GRN has no vendor — the capitalisation journal credits the vendor.", 422);
    accounts = await categoryAccounts(plan.map((p) => p.ic_id), tx);
    for (const p of plan) if (p.cost > 0) needAccount(accounts, p.ic_id, p.expense ? "depexp" : "cost");
  }

  const created = [];
  for (const p of plan.filter((x) => !x.expense)) {
    const asset = await tx.fixedAsset.create({
      data: {
        asset_no: p.row.asset_no, itcd: p.row.itcd, ic_id: p.ic_id, grn_tran_id: grnTranId, grn_line_id: p.row.id,
        vendor_acno: master.pycd ?? null, description: [p.item?.item, p.row.narration2].filter(Boolean).join(" — ").slice(0, 250) || null,
        cost: p.cost, in_service_date: new Date(`${inService}T00:00:00.000Z`), useful_life_months: lifeMonthsOf(p.row),
        department_id, employee_id, location_id, created_by: actor,
      },
    });
    await tx.fixedAssetMovement.create({
      data: {
        asset_id: asset.id, kind: "ADDITION", dated: asset.in_service_date, tran_id: grnTranId,
        to_department_id: department_id, to_employee_id: employee_id, to_location_id: location_id, created_by: actor,
        remarks: `Fixed Assets GRN #${grnTranId}`,
      },
    });
    created.push(asset);
  }

  let journal = null;
  if (accounts) {
    const lines = [];
    for (const p of plan) {
      if (!(p.cost > 0)) continue;
      const which = p.expense ? "depexp" : "cost";
      lines.push({
        acno: needAccount(accounts, p.ic_id, which), damt: p.cost, camt: 0,
        narration: p.expense ? `Below capitalisation value — ${p.item?.item ?? ""}` : `Fixed assets — ${accounts.get(p.ic_id)?.name ?? ""}`,
      });
    }
    const total = r2(lines.reduce((t, l) => t + l.damt, 0));
    lines.push({ acno: master.pycd, damt: 0, camt: total, narration: `Fixed Assets GRN #${grnTranId}${master.rmk3 ? ` — bill ${master.rmk3}` : ""}` });
    journal = await postJournal(tx, {
      date: inService, marker: "FA_CAPITALISATION", ref: grnTranId, actor, lines,
      remarks: `Capitalisation of Fixed Assets GRN #${grnTranId} — ${created.length} asset(s)`,
    });
    if (journal && created.length) {
      await tx.fixedAsset.updateMany({ where: { id: { in: created.map((a) => a.id) } }, data: { capitalisation_tran_id: journal.tran_id } });
    }
  }
  return { registered: created.length, expensed: plan.length - created.length, journal };
}

/** Register every GRN asset unit not in the register yet (no journals). */
export async function backfillFromGrns({ actor = null } = {}) {
  const pending = await prisma.$queryRaw`
    SELECT DISTINCT t.tran_id
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" m ON m.tran_id = t.tran_id
     WHERE m.tran_code = 14 AND t.asset_no IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.asset_no = t.asset_no)
     ORDER BY t.tran_id`;
  const settings = await getFaSettings({ fresh: true });
  let registered = 0;
  for (const { tran_id } of pending) {
    const res = await prisma.$transaction((tx) => registerFromGrn(tx, Number(tran_id), { actor, settings, capitalise: false }), { timeout: 60_000 });
    registered += res.registered;
  }
  return { grns: pending.length, registered };
}

/** Is any asset of this GRN in the register? (the GRN is then locked) */
export async function grnHasAssets(tranId, db = prisma) {
  return (await db.fixedAsset.count({ where: { grn_tran_id: Number(tranId) } })) > 0;
}

const name = (e) => (e ? [e.firstName, e.surname].filter(Boolean).join(" ") : null);

/**
 * Assets with everything the screens and reports show, as of `asOf`
 * ("YYYY-MM-DD", default today): rules (asset → category → company),
 * accumulated depreciation (brought forward + posted runs whose month ended
 * by then + the disposal month's charge), NBV, holder, status.
 */
export async function loadAssets({ where = {}, asOf = null, db = prisma } = {}) {
  const day = asOf || dayKey(new Date());
  const [assets, settings] = await Promise.all([
    db.fixedAsset.findMany({ where, orderBy: { asset_no: "asc" } }),
    getFaSettings({ db }),
  ]);
  if (!assets.length) return { assets: [], settings };
  const ids = assets.map((a) => a.id);
  const [runs, disposals, items, cats, catDefaults, depts, emps, locs] = await Promise.all([
    db.fixedAssetDepreciationRun.findMany({ where: { status: "POSTED" }, select: { id: true, period: true, jv_tran_id: true } }),
    db.fixedAssetDisposal.findMany({ where: { asset_id: { in: ids }, reversed_at: null } }),
    db.item.findMany({ where: { itcd: { in: [...new Set(assets.map((a) => a.itcd))] } }, select: { itcd: true, item: true, code: true } }),
    db.itemCategory.findMany({ where: { id: { in: [...new Set(assets.map((a) => a.ic_id).filter(Boolean))] } }, select: { id: true, ic_name: true } }),
    db.faCategoryDefault.findMany(),
    db.department.findMany({ select: { id: true, dept_name: true } }),
    db.employee.findMany({ where: { id: { in: [...new Set(assets.map((a) => a.employee_id).filter(Boolean))] } }, select: { id: true, firstName: true, surname: true } }),
    db.workLocation.findMany({ select: { id: true, location_name: true } }),
  ]);
  const runBy = new Map(runs.map((r) => [r.id, r]));
  const lines = runs.length
    ? await db.fixedAssetDepreciationLine.findMany({ where: { asset_id: { in: ids }, run_id: { in: runs.map((r) => r.id) } } })
    : [];
  const linesBy = new Map();
  for (const l of lines) {
    if (!linesBy.has(l.asset_id)) linesBy.set(l.asset_id, []);
    linesBy.get(l.asset_id).push({ ...l, jv_tran_id: runBy.get(l.run_id)?.jv_tran_id ?? null });
  }
  const dispBy = new Map(disposals.map((d) => [d.asset_id, d]));
  const itemBy = new Map(items.map((i) => [i.itcd, i]));
  const catBy = new Map(cats.map((c) => [c.id, c.ic_name]));
  const catDefBy = new Map(catDefaults.map((c) => [c.ic_id, c]));
  const deptBy = new Map(depts.map((d) => [d.id, d.dept_name]));
  const empBy = new Map(emps.map((e) => [e.id, name(e)]));
  const locBy = new Map(locs.map((l) => [l.id, l.location_name]));

  const out = assets.map((a) => {
    const rules = resolveAssetRules(a, catDefBy.get(a.ic_id) ?? null, settings);
    const own = linesBy.get(a.id) ?? [];
    const postedAll = r2(own.reduce((t, l) => t + l.amount, 0));
    const postedAsOf = r2(own.filter((l) => monthEnd(l.period) <= day).reduce((t, l) => t + l.amount, 0));
    const disposal = dispBy.get(a.id) ?? null;
    const disposedAsOf = disposal && dayKey(disposal.dated) <= day;
    const inService = dayKey(a.in_service_date);
    const accumulated = disposedAsOf
      ? r2(disposal.accumulated)
      : r2((a.opening_accumulated || 0) + postedAsOf);
    return {
      ...a,
      asset_label: formatAssetNo(a.asset_no, settings),
      in_service: inService,
      item: itemBy.get(a.itcd)?.item ?? null,
      item_code: itemBy.get(a.itcd)?.code ?? null,
      category: catBy.get(a.ic_id) ?? null,
      department: deptBy.get(a.department_id) ?? null,
      employee: empBy.get(a.employee_id) ?? null,
      location: locBy.get(a.location_id) ?? null,
      rules,
      posted_total: postedAll,
      accumulated_total: r2((a.opening_accumulated || 0) + postedAll + (disposal ? disposal.month_charge : 0)),
      accumulated,
      nbv: disposedAsOf ? 0 : r2(a.cost - accumulated),
      status_as_of: inService > day ? "NOT_YET" : disposedAsOf ? "DISPOSED" : "IN_USE",
      disposal,
      lines: own,
      has_depreciation: own.length > 0,
      last_period: own.reduce((m, l) => (l.period > m ? l.period : m), ""),
    };
  });
  return { assets: out, settings };
}

export { ymOf };
