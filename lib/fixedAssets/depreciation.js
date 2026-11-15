// lib/fixedAssets/depreciation.js — the monthly depreciation run.
//
//   previewRun(period)          per asset: opening NBV, the month's factor, charge,
//                               closing NBV — and the journal it would post
//   postRun(period, actor)      ONE system journal (rmk4 FA_DEPRECIATION, rmk5 the
//                               run id): Dr depreciation expense / Cr accumulated
//                               depreciation, one pair per category
//   reverseRun(id, reason)      the mirror journal (FA_DEPRECIATION_REVERSAL);
//                               the run is kept as REVERSED, the month may be run again
//
// Guards: feature "fixedAssets.depreciation" on (checked by the route); the
// month has ended; it has no POSTED run (also a partial unique index); no later
// month is posted (runs go in order, reversals newest first); the period lock
// for journals (tran_code 3) on the posting date (the month's last day).
// Disposed assets are never charged (their disposal journal closed them).
// The arithmetic is lib/fixedAssets/calc.js.
import prisma from "@/lib/prisma";
import { checkPeriodLock } from "@/lib/periodLock";
import { loadAssets } from "@/lib/fixedAssets/register";
import { categoryAccounts, needAccount } from "@/lib/fixedAssets/accounts";
import { postJournal, postMirror, FA_LOCK_KEY } from "@/lib/fixedAssets/journal";
import { FaError } from "@/lib/fixedAssets/errors";
import { r2, isPeriod, monthEnd, monthStart, periodLabel, chargeFor, dayKey } from "@/lib/fixedAssets/calc";

const RULE_KEYS = ["firstMonthRule", "lastMonthRule", "rbEndOfLife", "defaultMethod", "defaultLifeMonths", "defaultRbRate", "defaultSalvagePct"];

export async function listRuns() {
  return prisma.fixedAssetDepreciationRun.findMany({ orderBy: [{ period: "desc" }, { id: "desc" }] });
}

/** Why `period` cannot be posted now, or null. */
async function postBlocker(period, db = prisma) {
  if (!isPeriod(period)) return "Choose a month (YYYY-MM).";
  if (monthEnd(period) > dayKey(new Date())) return `${periodLabel(period)} has not ended yet — depreciation is posted on the month's last day.`;
  const posted = await db.fixedAssetDepreciationRun.findFirst({ where: { period, status: "POSTED" } });
  if (posted) return `${periodLabel(period)} is already depreciated (run #${posted.id}, JV #${posted.jv_tran_id}). Reverse that run first to run it again.`;
  const later = await db.fixedAssetDepreciationRun.findFirst({ where: { period: { gt: period }, status: "POSTED" }, orderBy: { period: "asc" } });
  if (later) return `${periodLabel(later.period)} is already depreciated — runs go month by month; reverse the later run(s) first.`;
  return null;
}

/** The run for `period` worked out, without writing anything. */
export async function previewRun(period) {
  if (!isPeriod(period)) throw new FaError("Choose a month (YYYY-MM).");
  const end = monthEnd(period);
  const { assets, settings } = await loadAssets({
    where: { status: "IN_USE", in_service_date: { lte: new Date(`${end}T00:00:00.000Z`) } },
    asOf: end,
  });
  const rows = [];
  for (const a of assets) {
    if (a.disposal) continue;
    const accumulated = r2((a.opening_accumulated || 0) + a.posted_total);
    const c = chargeFor({ asset: a, rules: a.rules, settings, period, accumulated });
    rows.push({
      asset_id: a.id, asset_no: a.asset_no, asset_label: a.asset_label, item: a.item, category: a.category, ic_id: a.ic_id,
      in_service: a.in_service, cost: a.cost, method: a.rules.method, life_months: a.rules.lifeMonths, rb_rate: a.rules.rbRate,
      salvage: a.rules.salvage, accumulated_before: accumulated, factor: c.factor, opening_nbv: c.openingNbv,
      amount: c.amount, closing_nbv: c.closingNbv, department: a.department,
    });
  }
  const charged = rows.filter((r) => r.amount > 0);
  const byCat = new Map();
  for (const r of charged) {
    const k = r.ic_id ?? null;
    byCat.set(k, r2((byCat.get(k) ?? 0) + r.amount));
  }
  const accounts = await categoryAccounts([...byCat.keys()]);
  const journal = [];
  const missing = [];
  for (const [ic, amount] of byCat) {
    try {
      const name = accounts.get(ic)?.name;
      journal.push({ acno: needAccount(accounts, ic, "depexp"), damt: amount, camt: 0, narration: `Depreciation ${periodLabel(period)} — ${name}` });
      journal.push({ acno: needAccount(accounts, ic, "accdep"), damt: 0, camt: amount, narration: `Accumulated depreciation ${periodLabel(period)} — ${name}` });
    } catch (e) {
      if (e instanceof FaError) missing.push(e.message);
      else throw e;
    }
  }
  return {
    period,
    label: periodLabel(period),
    posting_date: end,
    rules: Object.fromEntries(RULE_KEYS.map((k) => [k, settings[k]])),
    rows,
    total: r2(charged.reduce((t, r) => t + r.amount, 0)),
    asset_count: charged.length,
    journal,
    missing_accounts: missing,
    blocked: await postBlocker(period),
  };
}

/** Post the run for `period`. */
export async function postRun(period, { actor = null } = {}) {
  const blocker = await postBlocker(period);
  if (blocker) throw new FaError(blocker, 409);
  const preview = await previewRun(period);
  if (preview.missing_accounts.length) throw new FaError(preview.missing_accounts[0], 422);
  if (!(preview.total > 0)) throw new FaError(`Nothing to depreciate for ${preview.label}.`, 422);
  const lock = await checkPeriodLock(preview.posting_date, 3, { action: "create" });
  if (lock) throw new FaError(lock, 422);
  const accounts = await categoryAccounts(preview.rows.map((r) => r.ic_id));

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FA_LOCK_KEY})`;
      const again = await postBlocker(period, tx);
      if (again) throw new FaError(again, 409);
      const run = await tx.fixedAssetDepreciationRun.create({
        data: {
          period, status: "POSTED", posting_date: new Date(`${preview.posting_date}T00:00:00.000Z`),
          total: preview.total, asset_count: preview.asset_count, rules: preview.rules, posted_by: actor,
        },
      });
      await tx.fixedAssetDepreciationLine.createMany({
        data: preview.rows.filter((r) => r.amount > 0).map((r) => ({
          run_id: run.id, asset_id: r.asset_id, period, factor: r.factor, opening_nbv: r.opening_nbv, amount: r.amount,
          closing_nbv: r.closing_nbv, ic_id: r.ic_id, depexp_acno: needAccount(accounts, r.ic_id, "depexp"),
          accdep_acno: needAccount(accounts, r.ic_id, "accdep"),
        })),
      });
      const jv = await postJournal(tx, {
        date: preview.posting_date, marker: "FA_DEPRECIATION", ref: run.id, actor, lines: preview.journal,
        remarks: `Depreciation ${preview.label} (run #${run.id}) — ${preview.asset_count} asset(s)`,
      });
      await tx.fixedAssetDepreciationRun.update({ where: { id: run.id }, data: { jv_tran_id: jv.tran_id } });
      return { ...run, jv_tran_id: jv.tran_id, jv_vr_no: jv.vr_no };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

/** Reverse a POSTED run (newest first): mirror journal on its posting date. */
export async function reverseRun(runId, { actor = null, reason } = {}) {
  const why = String(reason || "").trim();
  if (!why) throw new FaError("Say why the run is reversed.");
  const run = await prisma.fixedAssetDepreciationRun.findUnique({ where: { id: Number(runId) } });
  if (!run) throw new FaError("Run not found.", 404);
  if (run.status !== "POSTED") throw new FaError("Only a posted run can be reversed.", 409);
  const later = await prisma.fixedAssetDepreciationRun.findFirst({ where: { status: "POSTED", period: { gt: run.period } } });
  if (later) throw new FaError(`${periodLabel(later.period)} is posted after it — reverse that run first.`, 409);
  const assetIds = (await prisma.fixedAssetDepreciationLine.findMany({ where: { run_id: run.id }, select: { asset_id: true } })).map((l) => l.asset_id);
  const disposed = await prisma.fixedAssetDisposal.findFirst({ where: { asset_id: { in: assetIds }, reversed_at: null } });
  if (disposed) {
    throw new FaError(`An asset of this run has been disposed of since (disposal voucher #${disposed.tran_id}) — its disposal used this depreciation; reverse the disposal first.`, 409);
  }
  const date = dayKey(run.posting_date);
  const lock = await checkPeriodLock(date, 3, { action: "create" });
  if (lock) throw new FaError(lock, 422);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FA_LOCK_KEY})`;
      const claimed = await tx.fixedAssetDepreciationRun.updateMany({ where: { id: run.id, status: "POSTED" }, data: { status: "REVERSED" } });
      if (claimed.count !== 1) throw new FaError("This run changed a moment ago — refresh.", 409);
      const mirror = run.jv_tran_id
        ? await postMirror(tx, { tranId: run.jv_tran_id, date, marker: "FA_DEPRECIATION_REVERSAL", ref: run.id, reason: why, actor })
        : null;
      return tx.fixedAssetDepreciationRun.update({
        where: { id: run.id },
        data: { reversal_tran_id: mirror?.tran_id ?? null, reversed_by: actor, reversed_at: new Date(), reverse_reason: why.slice(0, 500) },
      });
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

export { monthStart };
