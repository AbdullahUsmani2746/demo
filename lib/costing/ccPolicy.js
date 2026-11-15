// lib/costing/ccPolicy.js
// ============================================================
// Which item categories RECEIVE conversion cost (CC) when a month is costed
// (ported from Accounting lib/costing/ccPolicy.js — fixed category ids
// replaced by Settings → Production setup).
//
//   Finished goods   (productionSetup.finishedCategoryIds)     — always.
//   Semi-finished    (productionSetup.semiFinishedCategoryIds) — only while
//                    Settings → Features "costing.semiFinishedCC" is on AND
//                    the month is on/after the start month saved in Settings
//                    key SEMI_CC_FROM_KEY ("YYYY-MM", set on Costing →
//                    Production costing). No start month = finished only.
//
// The CC pool is divided over the produced qty of these categories only, so
// switching semi-finished on spreads the same pool over more qty — the
// month's total CC does not change. With the feature off (the default) this
// returns the finished-goods categories: today's SMS behaviour.
// ============================================================
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { getProductionSetup } from "@/lib/production/setup";

export const SEMI_CC_FEATURE = "costing.semiFinishedCC";
export const SEMI_CC_FROM_KEY = "costingSemiCcFrom";

const CACHE_MS = 10_000;
let cache = null; // { at, from }

const ym = (month, year) => Number(year) * 12 + (Number(month) - 1);

export function parseFrom(value) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { month, year } : null;
}

export const formatFrom = ({ month, year }) => `${year}-${String(month).padStart(2, "0")}`;
export const monthLabel = ({ month, year }) => `${String(month).padStart(2, "0")}/${year}`;

/** The saved start month { month, year } (whether or not the feature is on), or null. */
export async function getSemiCcFrom({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.from;
  const row = await prisma.settings.findUnique({ where: { key: SEMI_CC_FROM_KEY }, select: { value: true } });
  const from = parseFrom(row?.value);
  cache = { at: Date.now(), from };
  return from;
}

export const semiCcAppliesTo = (from, month, year) => !!from && ym(month, year) >= ym(from.month, from.year);

/** Whether semi-finished items receive CC in month/year (feature on + start month reached). */
export async function semiCcOnFor(month, year) {
  if (!(await feature(SEMI_CC_FEATURE))) return false;
  return semiCcAppliesTo(await getSemiCcFrom(), month, year);
}

/** Item categories that receive / carry CC in month/year. */
export async function ccCategoryIdsFor(month, year) {
  const setup = await getProductionSetup();
  const fg = (setup.finishedCategoryIds || []).map(Number);
  if (!(await semiCcOnFor(month, year))) return fg;
  return [...new Set([...fg, ...(setup.semiFinishedCategoryIds || []).map(Number)])];
}

/** Saves the start month (null clears it). Audited through lib/prisma.js. */
export async function setSemiCcFrom(from) {
  if (from) {
    await prisma.settings.upsert({
      where: { key: SEMI_CC_FROM_KEY },
      update: { value: formatFrom(from) },
      create: {
        key: SEMI_CC_FROM_KEY,
        value: formatFrom(from),
        description: "First month (YYYY-MM) semi-finished items receive conversion cost (feature costing.semiFinishedCC)",
      },
    });
  } else {
    await prisma.settings.deleteMany({ where: { key: SEMI_CC_FROM_KEY } });
  }
  cache = null;
}

/** First locked costing month at or after { month, year } — the start can't move across it. */
export async function firstLockedFrom({ month, year }) {
  return prisma.costingPeriod.findFirst({
    where: {
      is_locked: true,
      OR: [{ year: { gt: Number(year) } }, { year: Number(year), month: { gte: Number(month) } }],
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: { month: true, year: true },
  });
}
