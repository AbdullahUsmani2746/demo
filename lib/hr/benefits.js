// lib/hr/benefits.js — provident fund and gratuity arithmetic. Pure (no DB):
// payroll (lib/hr/payroll/run.js), the final settlement
// (lib/hr/leaving/settlement.js) and the reports call it, the tests check it.
// Every number comes from the HR rules (lib/hr/access.js HR_SETTINGS).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MS_DAY = 86_400_000;
const day = (k) => new Date(`${k}T00:00:00.000Z`);

/** Whole calendar months from `from` to `to` (day keys); 2026-01-15 → 2026-03-14 = 1. */
export function serviceMonths(from, to) {
  if (!from || !to || to < from) return 0;
  const a = day(from);
  const b = day(to);
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/** Days of service, both ends counted. */
export const serviceDays = (from, to) => (!from || !to || to < from ? 0 : Math.round((day(to) - day(from)) / MS_DAY) + 1);

/** Is the employee in the provident fund at the end of this month? */
export const pfEligible = ({ hireDate, asOf, settings }) => serviceMonths(hireDate, asOf) >= (settings.pfEligibleMonths || 0);

/**
 * This month's PF shares.
 * @param base  basic earned or gross earned (setting pfBaseGross), this month
 */
export function pfShares(base, settings) {
  const b = Math.max(0, Number(base) || 0);
  return { base: r2(b), employee: r2((b * (settings.pfEmployeePercent || 0)) / 100), employer: r2((b * (settings.pfEmployerPercent || 0)) / 100) };
}

/** Years of service counted for gratuity, by the part-year rule. */
export function gratuityYears(hireDate, asOf, settings) {
  const days = serviceDays(hireDate, asOf);
  const exact = days / 365;
  const months = serviceMonths(hireDate, asOf);
  if (settings.gratuityPartYear === 2) return Math.floor(months / 12);
  if (settings.gratuityPartYear === 1) return Math.floor(months / 12) + (months % 12 >= 6 ? 1 : 0);
  return Math.round(exact * 10000) / 10000;
}

/**
 * Gratuity earned up to `asOf`.
 *   amount   = salary (last basic | gross) ÷ month days × days per year × years
 *   payable  = amount once service reaches the minimum, else 0
 * @returns {{ years, months, base, day_rate, amount, eligible, payable }}
 */
export function gratuityFor({ hireDate, asOf, basic, gross, settings }) {
  const base = r2(settings.gratuityBaseGross ? gross : basic);
  const months = serviceMonths(hireDate, asOf);
  const years = gratuityYears(hireDate, asOf, settings);
  const dayRate = (settings.gratuityMonthDays || 30) > 0 ? base / (settings.gratuityMonthDays || 30) : 0;
  const amount = r2(dayRate * (settings.gratuityDaysPerYear || 0) * years);
  const eligible = months >= (settings.gratuityMinServiceMonths || 0);
  return { years, months, base, day_rate: r2(dayRate), amount, eligible, payable: eligible ? amount : 0 };
}

/**
 * This month's gratuity provision: the liability at month end less what the
 * books already hold for the person (may be negative after a salary cut).
 */
export function gratuityProvision({ hireDate, asOf, basic, gross, provided, settings }) {
  const g = gratuityFor({ hireDate, asOf, basic, gross, settings });
  return { ...g, provided: r2(provided), provision: r2(g.amount - (Number(provided) || 0)) };
}
