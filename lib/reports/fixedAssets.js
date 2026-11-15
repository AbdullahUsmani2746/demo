// lib/reports/fixedAssets.js — the fixed-asset reports (report engine, rule 6;
// layout + drill in components/Reports/config.js, rule 15).
//
//   fixedAssetRegister   every asset as of a day: cost, accumulated, NBV, holder,
//                        status — rows drill to the GRN (14), disposed ones also
//                        to the disposal voucher (15)
//   fixedAssetMovement   additions, relocations, holder changes, disposals and
//                        depreciation per asset in a period — each to its voucher
//   fixedAssetSchedule   per asset, month by month: opening NBV, depreciation,
//                        accumulated, closing NBV — posted months (drill to the
//                        journal) and the projection to the end of life
//   fixedAssetDisposals  each disposal: cost, accumulated, NBV, proceeds, gain / loss
import prisma from "@/lib/prisma";
import { loadAssets } from "@/lib/fixedAssets/register";
import { formatAssetNo, methodLabel } from "@/lib/fixedAssets/settingsDefs";
import { getFaSettings } from "@/lib/fixedAssets/settings";
import { r2, dayKey, ymOf, monthEnd, addMonths, buildSchedule, periodLabel } from "@/lib/fixedAssets/calc";

const pad = (n) => String(n).padStart(2, "0");
/** The engine hands dates over as local-midnight Dates → "YYYY-MM-DD". */
const dayOf = (v) => {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const filterVal = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);
const intOf = (v) => {
  const n = parseInt(filterVal(v) ?? "", 10);
  return Number.isFinite(n) ? n : null;
};
const sum = (rows, f) => r2(rows.reduce((t, r) => t + (Number(r[f]) || 0), 0));

function assetWhere(filters) {
  const where = {};
  if (intOf(filters.category) != null) where.ic_id = intOf(filters.category);
  if (intOf(filters.department) != null) where.department_id = intOf(filters.department);
  if (intOf(filters.asset) != null) where.asset_no = intOf(filters.asset);
  return where;
}

const STATUS_LABEL = { IN_USE: "In use", DISPOSED: "Disposed", NOT_YET: "Not yet in service" };

export async function getFixedAssetRegister(filters) {
  const asOf = dayOf(filters.dateTo) || dayKey(new Date());
  const { assets } = await loadAssets({ where: assetWhere(filters), asOf });
  const status = filterVal(filters.status) || "IN_USE";
  const rows = assets
    .filter((a) => a.status_as_of !== "NOT_YET")
    .filter((a) => status === "all" || a.status_as_of === status)
    .map((a) => ({
      asset_no: a.asset_label,
      asset_number: a.asset_no,
      itcd: a.itcd,
      item: a.item,
      category: a.category,
      in_service: a.in_service,
      method: methodLabel(a.rules.method),
      life_months: a.rules.method === "SL" || a.rules.lifeMonths ? a.rules.lifeMonths : null,
      rb_rate: a.rules.method === "RB" ? a.rules.rbRate : null,
      salvage: a.rules.salvage,
      cost: a.cost,
      accumulated: a.accumulated,
      nbv: a.nbv,
      department: a.department,
      employee: a.employee,
      location: a.location,
      status: STATUS_LABEL[a.status_as_of] ?? a.status_as_of,
      disposed_on: a.disposal && a.status_as_of === "DISPOSED" ? dayKey(a.disposal.dated) : null,
      disposal_tran_id: a.disposal && a.status_as_of === "DISPOSED" ? a.disposal.tran_id : null,
      tran_id: a.grn_tran_id,
      tran_code: a.grn_tran_id ? 14 : null,
    }));
  return {
    data: rows,
    summary: { assets: rows.length, totalCost: sum(rows, "cost"), totalAccumulated: sum(rows, "accumulated"), totalNbv: sum(rows, "nbv"), asOf },
  };
}

const KIND_LABEL = {
  ADDITION: "Addition", RELOCATION: "Relocation", HOLDER_CHANGE: "Holder change", DISPOSAL: "Disposal",
  DISPOSAL_REVERSAL: "Disposal reversed", DEPRECIATION: "Depreciation", DEPRECIATION_REVERSAL: "Depreciation reversed",
};
const KIND_TRAN = { ADDITION: 14, RELOCATION: 16, DISPOSAL: 15, DISPOSAL_REVERSAL: 15 };

export async function getFixedAssetMovement(filters) {
  const from = dayOf(filters.dateFrom) || "1900-01-01";
  const to = dayOf(filters.dateTo) || dayKey(new Date());
  const kind = filterVal(filters.kind) || "all";
  const { assets, settings } = await loadAssets({ where: assetWhere(filters), asOf: to });
  const byId = new Map(assets.map((a) => [a.id, a]));
  const ids = assets.map((a) => a.id);
  if (!ids.length) return { data: [], summary: {} };
  const range = { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) };
  const [moves, runs, disposals, depts, locs] = await Promise.all([
    prisma.fixedAssetMovement.findMany({ where: { asset_id: { in: ids }, dated: range }, orderBy: [{ dated: "asc" }, { id: "asc" }] }),
    prisma.fixedAssetDepreciationRun.findMany({ where: { posting_date: range } }),
    prisma.fixedAssetDisposal.findMany({ where: { asset_id: { in: ids } } }),
    prisma.department.findMany({ select: { id: true, dept_name: true } }),
    prisma.workLocation.findMany({ select: { id: true, location_name: true } }),
  ]);
  const empIds = [...new Set(moves.flatMap((m) => [m.from_employee_id, m.to_employee_id]).filter(Boolean))];
  const emps = empIds.length ? await prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, firstName: true, surname: true } }) : [];
  const dn = new Map(depts.map((d) => [d.id, d.dept_name]));
  const ln = new Map(locs.map((l) => [l.id, l.location_name]));
  const en = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.surname ?? ""}`.trim()]));
  const holder = (d, e, l) => [dn.get(d), en.get(e), ln.get(l)].filter(Boolean).join(" / ") || null;
  const dispKey = new Map(disposals.map((d) => [`${d.asset_id}|${d.tran_id}`, d]));

  const rows = [];
  const base = (a) => ({ asset_no: a.asset_label, asset_number: a.asset_no, itcd: a.itcd, item: a.item, category: a.category });
  for (const m of moves) {
    const a = byId.get(m.asset_id);
    const d = dispKey.get(`${m.asset_id}|${m.tran_id}`);
    rows.push({
      dated: dayKey(m.dated), kind: KIND_LABEL[m.kind] ?? m.kind, kind_code: m.kind, ...base(a),
      from_holder: holder(m.from_department_id, m.from_employee_id, m.from_location_id),
      to_holder: holder(m.to_department_id, m.to_employee_id, m.to_location_id),
      cost: m.kind === "ADDITION" ? a.cost : m.kind === "DISPOSAL" ? -(d?.cost ?? a.cost) : m.kind === "DISPOSAL_REVERSAL" ? (d?.cost ?? a.cost) : 0,
      depreciation: 0,
      proceeds: m.kind === "DISPOSAL" ? d?.proceeds ?? 0 : 0,
      gain_loss: m.kind === "DISPOSAL" ? d?.gain_loss ?? 0 : m.kind === "DISPOSAL_REVERSAL" ? -(d?.gain_loss ?? 0) : 0,
      remarks: m.remarks,
      tran_id: m.kind === "HOLDER_CHANGE" ? null : m.tran_id,
      tran_code: m.kind === "HOLDER_CHANGE" ? null : KIND_TRAN[m.kind] ?? null,
    });
  }
  if (runs.length) {
    const runBy = new Map(runs.map((r) => [r.id, r]));
    const lines = await prisma.fixedAssetDepreciationLine.findMany({ where: { run_id: { in: runs.map((r) => r.id) }, asset_id: { in: ids } } });
    for (const l of lines) {
      const run = runBy.get(l.run_id);
      const a = byId.get(l.asset_id);
      rows.push({
        dated: dayKey(run.posting_date), kind: KIND_LABEL.DEPRECIATION, kind_code: "DEPRECIATION", ...base(a),
        from_holder: null, to_holder: null, cost: 0, depreciation: l.amount, proceeds: 0, gain_loss: 0,
        remarks: `${periodLabel(l.period)} (run #${run.id}${run.status === "REVERSED" ? ", reversed" : ""})`,
        tran_id: run.jv_tran_id, tran_code: 3,
      });
      if (run.status === "REVERSED" && run.reversal_tran_id && run.reversed_at && dayKey(run.posting_date) <= to) {
        rows.push({
          dated: dayKey(run.posting_date), kind: KIND_LABEL.DEPRECIATION_REVERSAL, kind_code: "DEPRECIATION_REVERSAL", ...base(a),
          from_holder: null, to_holder: null, cost: 0, depreciation: -l.amount, proceeds: 0, gain_loss: 0,
          remarks: `${periodLabel(l.period)} (run #${run.id}) — ${run.reverse_reason ?? ""}`, tran_id: run.reversal_tran_id, tran_code: 3,
        });
      }
    }
  }
  for (const d of disposals) {
    if (!d.month_charge) continue;
    const day = dayKey(d.dated);
    if (day < from || day > to) continue;
    const a = byId.get(d.asset_id);
    rows.push({
      dated: day, kind: KIND_LABEL.DEPRECIATION, kind_code: "DEPRECIATION", ...base(a), from_holder: null, to_holder: null,
      cost: 0, depreciation: d.month_charge, proceeds: 0, gain_loss: 0, remarks: "Month of disposal (in the disposal journal)",
      tran_id: d.jv_tran_id, tran_code: d.jv_tran_id ? 3 : null,
    });
  }
  const filtered = rows
    .filter((r) => kind === "all" || r.kind_code === kind || (kind === "DEPRECIATION" && r.kind_code === "DEPRECIATION_REVERSAL"))
    .sort((x, y) => (x.dated < y.dated ? -1 : x.dated > y.dated ? 1 : x.asset_number - y.asset_number));
  void settings;
  return {
    data: filtered,
    summary: {
      additions: sum(filtered.filter((r) => r.kind_code === "ADDITION"), "cost"),
      disposalsCost: -sum(filtered.filter((r) => r.kind_code === "DISPOSAL"), "cost"),
      depreciation: sum(filtered, "depreciation"),
      relocations: filtered.filter((r) => r.kind_code === "RELOCATION").length,
      gainLoss: sum(filtered, "gain_loss"),
    },
  };
}

const SCHEDULE_STATUS = { POSTED: "Posted", PROJECTED: "Projected", DISPOSAL: "Disposal month", NOT_RUN: "Not run" };

export async function getFixedAssetSchedule(filters) {
  const where = assetWhere(filters);
  const status = filterVal(filters.status) || "IN_USE";
  if (status !== "all") where.status = status;
  const { assets, settings } = await loadAssets({ where });
  const lastRun = await prisma.fixedAssetDepreciationRun.findFirst({ where: { status: "POSTED" }, orderBy: { period: "desc" } });
  const projectFrom = lastRun ? addMonths(lastRun.period, 1) : ymOf(new Date());
  const fromP = filters.dateFrom ? dayOf(filters.dateFrom).slice(0, 7) : null;
  const toP = filters.dateTo ? dayOf(filters.dateTo).slice(0, 7) : null;
  const rows = [];
  for (const a of assets) {
    const posted = new Map(a.lines.map((l) => [l.period, { amount: l.amount, tran_id: l.jv_tran_id, kind: "POSTED" }]));
    if (a.disposal?.month_charge) {
      const p = ymOf(a.disposal.dated);
      posted.set(p, { amount: r2((posted.get(p)?.amount ?? 0) + a.disposal.month_charge), tran_id: a.disposal.jv_tran_id, kind: "DISPOSAL" });
    }
    const sched = buildSchedule({ asset: a, rules: a.rules, settings, posted, projectFrom, disposedOn: a.disposal ? a.disposal.dated : null });
    for (const s of sched) {
      if ((fromP && s.period < fromP) || (toP && s.period > toP)) continue;
      rows.push({
        asset_no: a.asset_label, asset_number: a.asset_no, itcd: a.itcd, item: a.item, category: a.category,
        method: methodLabel(a.rules.method), period: s.period, month: periodLabel(s.period), month_end: monthEnd(s.period),
        status: SCHEDULE_STATUS[s.status] ?? s.status, opening_nbv: s.opening_nbv, depreciation: s.amount,
        accumulated: s.accumulated, closing_nbv: s.closing_nbv,
        tran_id: s.status === "POSTED" || s.status === "DISPOSAL" ? s.tran_id : null,
        tran_code: (s.status === "POSTED" || s.status === "DISPOSAL") && s.tran_id ? 3 : null,
      });
    }
  }
  return {
    data: rows,
    summary: {
      assets: new Set(rows.map((r) => r.asset_number)).size,
      posted: sum(rows.filter((r) => r.status !== "Projected"), "depreciation"),
      projected: sum(rows.filter((r) => r.status === "Projected"), "depreciation"),
    },
  };
}

export async function getFixedAssetDisposals(filters) {
  const from = dayOf(filters.dateFrom) || "1900-01-01";
  const to = dayOf(filters.dateTo) || dayKey(new Date());
  const kind = filterVal(filters.kind) || "all";
  const showReversed = filterVal(filters.reversed) === "include";
  const where = { dated: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } };
  if (kind !== "all") where.kind = kind;
  if (!showReversed) where.reversed_at = null;
  const list = await prisma.fixedAssetDisposal.findMany({ where, orderBy: [{ dated: "asc" }, { id: "asc" }] });
  if (!list.length) return { data: [], summary: {} };
  const settings = await getFaSettings();
  const assetIds = [...new Set(list.map((d) => d.asset_id))];
  const assets = await prisma.fixedAsset.findMany({ where: { id: { in: assetIds }, ...assetWhere(filters) } });
  const aBy = new Map(assets.map((a) => [a.id, a]));
  const [items, cats, vouchers, parties] = await Promise.all([
    prisma.item.findMany({ where: { itcd: { in: [...new Set(assets.map((a) => a.itcd))] } }, select: { itcd: true, item: true } }),
    prisma.itemCategory.findMany({ where: { id: { in: [...new Set(assets.map((a) => a.ic_id).filter(Boolean))] } }, select: { id: true, ic_name: true } }),
    prisma.transactionsMaster.findMany({ where: { tran_id: { in: [...new Set(list.map((d) => d.tran_id))] } }, select: { tran_id: true, vr_no: true } }),
    prisma.aCNO.findMany({ where: { acno: { in: [...new Set(list.map((d) => d.party_acno).filter(Boolean))] } }, select: { acno: true, acname: true } }),
  ]);
  const iBy = new Map(items.map((i) => [i.itcd, i.item]));
  const cBy = new Map(cats.map((c) => [c.id, c.ic_name]));
  const vBy = new Map(vouchers.map((v) => [v.tran_id, v.vr_no]));
  const pBy = new Map(parties.map((p) => [p.acno, p.acname]));
  const rows = list.filter((d) => aBy.has(d.asset_id)).map((d) => {
    const a = aBy.get(d.asset_id);
    return {
      dated: dayKey(d.dated), vr_no: vBy.get(d.tran_id) ?? null, asset_no: formatAssetNo(a.asset_no, settings), asset_number: a.asset_no,
      itcd: a.itcd, item: iBy.get(a.itcd) ?? null, category: cBy.get(a.ic_id) ?? null, kind: d.kind === "SALE" ? "Sale" : "Scrap",
      party: d.party_acno ? `${d.party_acno} - ${pBy.get(d.party_acno) ?? ""}` : null, cost: d.cost, accumulated: d.accumulated,
      month_charge: d.month_charge, nbv: d.nbv, proceeds: d.proceeds, gain_loss: d.gain_loss,
      result: d.gain_loss > 0 ? "Gain" : d.gain_loss < 0 ? "Loss" : "—",
      status: d.reversed_at ? "Reversed" : "Posted",
      jv_tran_id: d.jv_tran_id, reversal_tran_id: d.reversal_tran_id,
      tran_id: d.tran_id, tran_code: 15,
    };
  });
  const live = rows.filter((r) => r.status === "Posted");
  return {
    data: rows,
    summary: { disposals: live.length, totalCost: sum(live, "cost"), totalNbv: sum(live, "nbv"), totalProceeds: sum(live, "proceeds"), totalGainLoss: sum(live, "gain_loss") },
  };
}
