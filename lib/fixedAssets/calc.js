// lib/fixedAssets/calc.js — depreciation arithmetic. Pure (no Prisma), so the
// run screen, the reports, the server and the tests share one set of rules.
//
// THE RULES (the company's choices are Settings → Fixed assets,
// lib/fixedAssets/settingsDefs.js; an asset's own values override its
// category's, which override the company's):
//   Straight line (SL)     monthly = (cost − salvage) ÷ useful life (months)
//   Reducing balance (RB)  monthly = opening NBV × rate % ÷ 12
//                          rbEndOfLife WRITE_DOWN → the last month of useful
//                          life charges everything left above salvage
//   Every month            × the month's factor, never below salvage:
//                          charge = min(charge, opening NBV − salvage)
//   First month            firstMonthRule: PRORATA = days in service ÷ days in
//                          the month (in service on the 16th of a 30-day
//                          month → 15/30), FULL = 1, NEXT = 0 (starts next month)
//   Month of disposal      lastMonthRule: PRORATA = days held (up to and
//                          including the disposal date) ÷ days in the month,
//                          FULL = 1, NONE = 0 — charged in the disposal journal
//   After disposal         nothing.
//   A month never run is not caught up later: each run charges its own month
//   on the asset's actual net book value. Assets taken on with history carry
//   their brought-forward accumulated depreciation (opening_accumulated).
// Amounts are rounded to 2 decimals per asset per month.

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of a Date (DB @db.Date values are UTC midnight) or a date string. */
export function dayKey(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
export const ymOf = (value) => dayKey(value)?.slice(0, 7) ?? null;
export const isPeriod = (p) => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

export function addMonths(period, n) {
  const [y, m] = period.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function diffMonths(a, b) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (ya * 12 + ma) - (yb * 12 + mb);
}
export function daysInMonth(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const monthStart = (period) => `${period}-01`;
export const monthEnd = (period) => `${period}-${pad(daysInMonth(period))}`;
export function periodLabel(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The rules one asset is depreciated by, with where each came from.
 * asset: { cost, method, useful_life_months, rb_rate, salvage_value }
 * cat:   fa_category_defaults row or null; settings: resolved company settings.
 */
export function resolveAssetRules(asset, cat, settings) {
  const pick = (own, fromCat, fromCo) =>
    own != null ? [own, "asset"] : fromCat != null ? [fromCat, "category"] : [fromCo, "company"];
  const [method, methodFrom] = pick(asset.method || null, cat?.method || null, settings.defaultMethod);
  const [lifeMonths, lifeFrom] = pick(asset.useful_life_months, cat?.useful_life_months, settings.defaultLifeMonths);
  const [rbRate, rateFrom] = pick(asset.rb_rate, cat?.rb_rate, settings.defaultRbRate);
  let salvage;
  let salvageFrom;
  if (asset.salvage_value != null) {
    salvage = r2(asset.salvage_value);
    salvageFrom = "asset";
  } else {
    const pct = cat?.salvage_pct ?? settings.defaultSalvagePct ?? 0;
    salvage = r2((Number(asset.cost) || 0) * pct / 100);
    salvageFrom = cat?.salvage_pct != null ? "category" : "company";
  }
  return {
    method: method === "RB" ? "RB" : "SL",
    lifeMonths: Number(lifeMonths) || null,
    rbRate: Number(rbRate) || 0,
    salvage,
    from: { method: methodFrom, lifeMonths: lifeFrom, rbRate: rateFrom, salvage: salvageFrom },
  };
}

/** The first month a charge can fall in. */
export function firstChargePeriod(inServiceDate, settings) {
  const start = ymOf(inServiceDate);
  return settings.firstMonthRule === "NEXT" ? addMonths(start, 1) : start;
}

/**
 * Share of `period` the asset is depreciated for (0 … 1).
 * disposedOn: the disposal date when the asset is (being) disposed of.
 */
export function monthFactor(inServiceDate, period, settings, disposedOn = null) {
  const sDay = dayKey(inServiceDate);
  const sYm = sDay.slice(0, 7);
  if (period < sYm) return 0;
  const dim = daysInMonth(period);
  let startF = 1;
  if (period === sYm) {
    if (settings.firstMonthRule === "NEXT") return 0;
    startF = settings.firstMonthRule === "FULL" ? 1 : (dim - Number(sDay.slice(8, 10)) + 1) / dim;
  }
  if (disposedOn) {
    const dDay = dayKey(disposedOn);
    const dYm = dDay.slice(0, 7);
    if (period > dYm) return 0;
    if (period === dYm) {
      if (settings.lastMonthRule === "NONE") return 0;
      if (settings.lastMonthRule === "FULL") return startF > 0 ? 1 : 0;
      const held = Number(dDay.slice(8, 10)) - (period === sYm && settings.firstMonthRule === "PRORATA" ? Number(sDay.slice(8, 10)) - 1 : 0);
      return Math.max(0, Math.min(startF, held / dim));
    }
  }
  return startF;
}

/**
 * One month's charge.
 * { rules, cost, openingNbv, factor, monthIndex (0 = first charge month), settings }
 */
export function monthCharge({ rules, cost, openingNbv, factor, monthIndex, settings }) {
  const room = r2(openingNbv - rules.salvage);
  if (room <= 0 || !(factor > 0)) return 0;
  let amount;
  if (rules.method === "RB") {
    amount = openingNbv * (rules.rbRate / 100) / 12 * factor;
    if (settings.rbEndOfLife !== "CONTINUE" && rules.lifeMonths && monthIndex >= rules.lifeMonths - 1) amount = room;
  } else {
    if (!rules.lifeMonths) return 0;
    amount = ((Number(cost) || 0) - rules.salvage) / rules.lifeMonths * factor;
  }
  return r2(Math.max(0, Math.min(amount, room)));
}

/**
 * The charge of `period` for an asset whose posted accumulated depreciation
 * (opening_accumulated included) is `accumulated`.
 */
export function chargeFor({ asset, rules, settings, period, accumulated, disposedOn = null }) {
  const factor = monthFactor(asset.in_service_date, period, settings, disposedOn);
  const openingNbv = r2((Number(asset.cost) || 0) - accumulated);
  const monthIndex = diffMonths(period, firstChargePeriod(asset.in_service_date, settings));
  const amount = monthCharge({ rules, cost: asset.cost, openingNbv, factor, monthIndex, settings });
  return { factor: Math.round(factor * 10000) / 10000, openingNbv, amount, closingNbv: r2(openingNbv - amount) };
}

/**
 * Month-by-month schedule: posted months as they were posted, months before
 * `projectFrom` that were never run as 0, then the projection to the end of
 * life (NBV down to salvage) or the disposal.
 *   posted: Map period → { amount, tran_id, kind }   (runs + disposal month)
 */
export function buildSchedule({ asset, rules, settings, posted, projectFrom, disposedOn = null, maxMonths = 1200 }) {
  const rows = [];
  let accumulated = r2(asset.opening_accumulated || 0);
  const start = ymOf(asset.in_service_date);
  const end = disposedOn ? ymOf(disposedOn) : null;
  for (let i = 0, period = start; i < maxMonths; i++, period = addMonths(period, 1)) {
    if (end && period > end) break;
    const openingNbv = r2((Number(asset.cost) || 0) - accumulated);
    const hit = posted.get(period);
    let amount = 0;
    let status;
    let tran_id = null;
    if (hit) {
      amount = r2(hit.amount);
      status = hit.kind || "POSTED";
      tran_id = hit.tran_id ?? null;
    } else if (period < projectFrom || disposedOn) {
      status = "NOT_RUN";
    } else {
      amount = chargeFor({ asset, rules, settings, period, accumulated }).amount;
      status = "PROJECTED";
    }
    if (amount === 0 && period >= projectFrom && !hit && openingNbv - rules.salvage <= 0.005) break;
    accumulated = r2(accumulated + amount);
    if (amount !== 0 || hit) {
      rows.push({ period, status, opening_nbv: openingNbv, amount, accumulated, closing_nbv: r2((Number(asset.cost) || 0) - accumulated), tran_id });
    }
  }
  return rows;
}
