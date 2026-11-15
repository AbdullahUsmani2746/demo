// lib/fixedAssets/disposal.js — Fixed Asset Disposal (tran_code 15) and
// Fixed Asset Relocation (tran_code 16), ported from Accounting.
//
// Disposal voucher: header date, rmk1 = SALE | SCRAP, pycd = the customer or
// cash / bank account that receives the proceeds; one line per asset
// (party_name = asset number, rate = proceeds). Saving it (route: app/api/
// voucher/[type]) runs planDisposal → applyDisposal in one transaction:
//   - each asset worked out: cost, accumulated depreciation, the disposal
//     month's charge (Settings → Fixed assets "Last month"; only while
//     "fixedAssets.depreciation" is on; may be negative when that month was
//     already posted in full), NBV, gain / loss
//   - the asset becomes DISPOSED, a DISPOSAL movement is kept
//   - feature "fixedAssets.disposalPosting" on → ONE system journal
//     (rmk4 FA_DISPOSAL, rmk5 the voucher): Dr depreciation expense / Cr
//     accumulated (month charge), Dr accumulated depreciation, Dr proceeds,
//     Cr asset cost, Cr gain / Dr loss
// A disposal is never edited or deleted; reverseDisposal posts the mirror
// journal (FA_DISPOSAL_REVERSAL) and puts the assets back in use.
//
// Relocation voucher: header date + remarks; per line the asset, its new
// department (narration4), employee (narration5) and work location
// (narration3). Moves the holder and keeps a RELOCATION movement.
import prisma from "@/lib/prisma";
import { checkPeriodLock } from "@/lib/periodLock";
import { getFaSettings } from "@/lib/fixedAssets/settings";
import { loadAssets } from "@/lib/fixedAssets/register";
import { categoryAccounts, needAccount } from "@/lib/fixedAssets/accounts";
import { postJournal, postMirror, FA_LOCK_KEY } from "@/lib/fixedAssets/journal";
import { FaError } from "@/lib/fixedAssets/errors";
import { r2, dayKey, ymOf, chargeFor } from "@/lib/fixedAssets/calc";

const toInt = (v) => {
  const n = parseInt(v?.value ?? v, 10);
  return Number.isFinite(n) ? n : null;
};
const toNum = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isFinite(n) ? n : 0;
};
export const DISPOSAL_KINDS = ["SALE", "SCRAP"];

function headerOf(master) {
  const date = dayKey(master?.dated);
  if (!date) throw new FaError("Date is required.");
  if (date > dayKey(new Date())) throw new FaError("Date: today or earlier.");
  return date;
}

/** Assets named on the lines, each once, as register rows. */
async function assetsOnLines(lines) {
  const nos = lines.map((l) => toInt(l.party_name ?? l.asset_no));
  if (!nos.length || nos.some((n) => n == null)) throw new FaError("Choose the asset on every line.");
  if (new Set(nos).size !== nos.length) throw new FaError("An asset is listed twice.");
  const { assets, settings } = await loadAssets({ where: { asset_no: { in: nos } } });
  const by = new Map(assets.map((a) => [a.asset_no, a]));
  for (const n of nos) if (!by.has(n)) throw new FaError(`Asset ${n} is not in the Fixed Asset Register.`, 422);
  return { nos, by, settings };
}

/**
 * Work the disposal out (no writes). Returns the plan applyDisposal posts.
 * features: { depreciation, posting } (Settings → Features)
 */
export async function planDisposal({ master, lines }, features) {
  const date = headerOf(master);
  const kind = String(master?.rmk1?.value ?? master?.rmk1 ?? "").toUpperCase();
  if (!DISPOSAL_KINDS.includes(kind)) throw new FaError("Choose Sale or Scrap.");
  const party = toInt(master?.pycd);
  if (!Array.isArray(lines) || !lines.length) throw new FaError("Add the assets disposed of.");
  const { nos, by, settings } = await assetsOnLines(lines);
  const period = date.slice(0, 7);
  const items = [];
  for (let i = 0; i < nos.length; i++) {
    const a = by.get(nos[i]);
    const label = a.asset_label;
    if (a.status !== "IN_USE" || a.disposal) throw new FaError(`Asset ${label} is already disposed of.`, 422);
    if (a.in_service > date) throw new FaError(`Asset ${label} was put in service on ${a.in_service}, after the disposal date.`, 422);
    const laterLine = a.lines.find((l) => l.period > period);
    if (laterLine) throw new FaError(`Asset ${label} is depreciated for ${laterLine.period}, after the disposal date — reverse that run first or date the disposal later.`, 409);
    const proceeds = r2(toNum(lines[i].rate ?? lines[i].proceeds));
    if (proceeds < 0) throw new FaError("Proceeds cannot be negative.");
    const postedThisMonth = r2(a.lines.filter((l) => l.period === period).reduce((t, l) => t + l.amount, 0));
    const accPosted = r2((a.opening_accumulated || 0) + a.posted_total);
    let monthCharge = 0;
    if (features.depreciation) {
      const due = chargeFor({ asset: a, rules: a.rules, settings, period, accumulated: r2(accPosted - postedThisMonth), disposedOn: date }).amount;
      monthCharge = r2(due - postedThisMonth);
    }
    const accumulated = r2(accPosted + monthCharge);
    const nbv = r2(a.cost - accumulated);
    items.push({ asset: a, proceeds, month_charge: monthCharge, accumulated, nbv, gain_loss: r2(proceeds - nbv) });
  }
  const totalProceeds = r2(items.reduce((t, x) => t + x.proceeds, 0));
  if ((kind === "SALE" || totalProceeds > 0) && !party) {
    throw new FaError(kind === "SALE" ? "Choose the customer the asset is sold to." : "Choose the account that receives the scrap proceeds.");
  }
  let journal = [];
  if (features.posting) {
    const accounts = await categoryAccounts(items.map((x) => x.asset.ic_id));
    for (const x of items) {
      const ic = x.asset.ic_id;
      const tag = `${x.asset.asset_label} ${x.asset.item ?? ""}`.trim();
      if (x.month_charge) {
        const d = needAccount(accounts, ic, "depexp");
        const c = needAccount(accounts, ic, "accdep");
        const amt = Math.abs(x.month_charge);
        journal.push(x.month_charge > 0
          ? { acno: d, damt: amt, camt: 0, narration: `Depreciation to disposal — ${tag}` }
          : { acno: d, damt: 0, camt: amt, narration: `Depreciation to disposal — ${tag}` });
        journal.push(x.month_charge > 0
          ? { acno: c, damt: 0, camt: amt, narration: `Depreciation to disposal — ${tag}` }
          : { acno: c, damt: amt, camt: 0, narration: `Depreciation to disposal — ${tag}` });
      }
      if (x.accumulated) journal.push({ acno: needAccount(accounts, ic, "accdep"), damt: x.accumulated, camt: 0, narration: `Accumulated depreciation written off — ${tag}` });
      journal.push({ acno: needAccount(accounts, ic, "cost"), damt: 0, camt: x.asset.cost, narration: `Cost of asset disposed — ${tag}` });
      if (x.proceeds) journal.push({ acno: party, damt: x.proceeds, camt: 0, narration: `${kind === "SALE" ? "Sale" : "Scrap"} proceeds — ${tag}` });
      if (x.gain_loss > 0) journal.push({ acno: needAccount(accounts, ic, "gainloss"), damt: 0, camt: x.gain_loss, narration: `Gain on disposal — ${tag}` });
      if (x.gain_loss < 0) journal.push({ acno: needAccount(accounts, ic, "gainloss"), damt: -x.gain_loss, camt: 0, narration: `Loss on disposal — ${tag}` });
    }
    const lock = await checkPeriodLock(date, 3, { action: "create" });
    if (lock) throw new FaError(lock, 422);
  }
  return { date, kind, party, items, journal, settings };
}

/** Write the disposal (inside the voucher's save transaction). */
export async function applyDisposal(tx, voucher, plan, { actor = null } = {}) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FA_LOCK_KEY})`;
  const day = new Date(`${plan.date}T00:00:00.000Z`);
  const rows = [];
  for (const x of plan.items) {
    const claimed = await tx.fixedAsset.updateMany({ where: { id: x.asset.id, status: "IN_USE" }, data: { status: "DISPOSED", disposed_on: day } });
    if (claimed.count !== 1) throw new FaError(`Asset ${x.asset.asset_label} was disposed of a moment ago — refresh.`, 409);
    rows.push(await tx.fixedAssetDisposal.create({
      data: {
        asset_id: x.asset.id, tran_id: voucher.tran_id, dated: day, kind: plan.kind, party_acno: plan.party, proceeds: x.proceeds,
        cost: x.asset.cost, accumulated: x.accumulated, month_charge: x.month_charge, nbv: x.nbv, gain_loss: x.gain_loss,
      },
    }));
    await tx.fixedAssetMovement.create({
      data: {
        asset_id: x.asset.id, kind: "DISPOSAL", dated: day, tran_id: voucher.tran_id,
        from_department_id: x.asset.department_id, from_employee_id: x.asset.employee_id, from_location_id: x.asset.location_id,
        remarks: `${plan.kind === "SALE" ? "Sold" : "Scrapped"} — proceeds ${x.proceeds}`, created_by: actor,
      },
    });
  }
  let jv = null;
  if (plan.journal.length) {
    jv = await postJournal(tx, {
      date: plan.date, marker: "FA_DISPOSAL", ref: voucher.tran_id, actor, lines: plan.journal,
      remarks: `Disposal of ${plan.items.length} fixed asset(s) — voucher #${voucher.tran_id} (${plan.kind === "SALE" ? "sale" : "scrap"})`,
    });
    if (jv) await tx.fixedAssetDisposal.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { jv_tran_id: jv.tran_id } });
  }
  return { disposals: rows, journal: jv };
}

/** Undo a disposal voucher: mirror journal, assets back in use. */
export async function reverseDisposal(voucherTranId, { actor = null, reason } = {}) {
  const why = String(reason || "").trim();
  if (!why) throw new FaError("Say why the disposal is reversed.");
  const rows = await prisma.fixedAssetDisposal.findMany({ where: { tran_id: Number(voucherTranId), reversed_at: null } });
  if (!rows.length) throw new FaError("No live disposal on that voucher.", 404);
  const date = dayKey(rows[0].dated);
  const jvId = rows.find((r) => r.jv_tran_id)?.jv_tran_id ?? null;
  if (jvId) {
    const lock = await checkPeriodLock(date, 3, { action: "create" });
    if (lock) throw new FaError(lock, 422);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FA_LOCK_KEY})`;
    const claimed = await tx.fixedAssetDisposal.updateMany({
      where: { tran_id: Number(voucherTranId), reversed_at: null },
      data: { reversed_at: new Date(), reversed_by: actor, reverse_reason: why.slice(0, 500) },
    });
    if (claimed.count !== rows.length) throw new FaError("This disposal changed a moment ago — refresh.", 409);
    const mirror = jvId
      ? await postMirror(tx, { tranId: jvId, date, marker: "FA_DISPOSAL_REVERSAL", ref: voucherTranId, reason: why, actor })
      : null;
    if (mirror) await tx.fixedAssetDisposal.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { reversal_tran_id: mirror.tran_id } });
    for (const r of rows) {
      await tx.fixedAsset.update({ where: { id: r.asset_id }, data: { status: "IN_USE", disposed_on: null } });
      await tx.fixedAssetMovement.create({
        data: { asset_id: r.asset_id, kind: "DISPOSAL_REVERSAL", dated: r.dated, tran_id: Number(voucherTranId), remarks: why.slice(0, 500), created_by: actor },
      });
    }
    return { reversed: rows.length, journal: mirror };
  });
}

/** Check a relocation (no writes). */
export async function planRelocation({ master, lines }) {
  const date = headerOf(master);
  if (!Array.isArray(lines) || !lines.length) throw new FaError("Add the assets moved.");
  const { nos, by } = await assetsOnLines(lines);
  const empIds = [...new Set(lines.map((l) => toInt(l.narration5)).filter((x) => x != null))];
  const emps = empIds.length
    ? await prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, departmentId: true, workLocationId: true } })
    : [];
  const empBy = new Map(emps.map((e) => [e.id, e]));
  const items = nos.map((n, i) => {
    const a = by.get(n);
    if (a.status !== "IN_USE") throw new FaError(`Asset ${a.asset_label} is disposed of.`, 422);
    if (a.in_service > date) throw new FaError(`Asset ${a.asset_label} was put in service on ${a.in_service}, after the relocation date.`, 422);
    const dept = toInt(lines[i].narration4);
    const empId = toInt(lines[i].narration5);
    const loc = toInt(lines[i].narration3);
    if (dept == null && empId == null && loc == null) throw new FaError(`Choose where asset ${a.asset_label} moves to.`);
    if (empId != null && !empBy.has(empId)) throw new FaError(`Employee ${empId} does not exist.`, 422);
    const emp = empId != null ? empBy.get(empId) : null;
    // Left blank = as it is; a new employee brings their department / work location.
    const to = {
      department_id: dept ?? emp?.departmentId ?? a.department_id,
      employee_id: empId ?? (dept != null && dept !== a.department_id ? null : a.employee_id),
      location_id: loc ?? emp?.workLocationId ?? a.location_id,
    };
    return { asset: a, to };
  });
  return { date, items };
}

export async function applyRelocation(tx, voucher, plan, { actor = null, remarks = null } = {}) {
  const day = new Date(`${plan.date}T00:00:00.000Z`);
  for (const { asset: a, to } of plan.items) {
    await tx.fixedAsset.update({ where: { id: a.id }, data: to });
    await tx.fixedAssetMovement.create({
      data: {
        asset_id: a.id, kind: "RELOCATION", dated: day, tran_id: voucher.tran_id,
        from_department_id: a.department_id, from_employee_id: a.employee_id, from_location_id: a.location_id,
        to_department_id: to.department_id, to_employee_id: to.employee_id, to_location_id: to.location_id,
        remarks: remarks ? String(remarks).slice(0, 500) : null, created_by: actor,
      },
    });
  }
}

export { getFaSettings, ymOf };
