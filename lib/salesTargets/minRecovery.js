import prisma from "@/lib/prisma";
import { getCustomerOverdueTotals } from "@/lib/reports/customerAging";
import { deriveCategory } from "@/lib/reports/salesTeamMis";

/* ══════════════════════════════════════════════════════════════════════
   MINIMUM TARGET RECOVERY

   A customer's monthly Target Recovery may not be set below a share of what
   they already owe past their credit terms. The share depends on the
   customer's category — the same category the Sales Team MIS reports:

     BAD-DEBTS     → at least 25% of overdue
     BAD-PAYMENTS  → at least 40% of overdue
     everything else (no status → Official / Unofficial) → 100% of overdue

   "Overdue" is the Opening OverDue of the month: the overdue amount on the
   day before the 1st, from getCustomerOverdueTotals — the figure the Sales
   Team MIS and Customer Aging show. A customer with nothing overdue has no
   minimum.

   To change a percentage, edit MIN_RECOVERY_PCT only.
   ══════════════════════════════════════════════════════════════════════ */
export const MIN_RECOVERY_PCT = {
  "BAD-DEBTS": 25,
  "BAD-PAYMENTS": 40,
};
export const DEFAULT_MIN_RECOVERY_PCT = 100;

export const minRecoveryPct = (category) =>
  MIN_RECOVERY_PCT[category] ?? DEFAULT_MIN_RECOVERY_PCT;

/**
 * Map<acno, { category, minPct, overdue, minRecovery }> for one target month.
 * `customers` may carry customerStatus/isActive already (saves a query);
 * otherwise pass plain acnos.
 */
export async function getMinRecoveryMap({ acnos, customers, year, month }) {
  if (!Number(year) || !Number(month)) return new Map();
  let list = customers;
  if (!list) {
    list = acnos?.length
      ? await prisma.aCNO.findMany({
          where: { acno: { in: acnos.map(Number) } },
          select: { acno: true, customerStatus: true, isActive: true },
        })
      : [];
  }
  if (list.length === 0) return new Map();

  // Opening overdue of the month = overdue at the end of the previous day.
  const asOf = new Date(Number(year), Number(month) - 1, 1);
  asOf.setDate(asOf.getDate() - 1);

  const totals = await getCustomerOverdueTotals({
    acnos: list.map((c) => c.acno),
    asOfDate: asOf,
  });
  const overdueByAcno = new Map(totals.map((t) => [Number(t.acno), Number(t.overdueAmount) || 0]));

  return new Map(
    list.map((c) => {
      const category = deriveCategory(c);
      const minPct = minRecoveryPct(category);
      const overdue = Math.max(0, overdueByAcno.get(c.acno) || 0);
      // Whole rupees, rounded up, so the minimum itself always passes.
      const minRecovery = Math.ceil((overdue * minPct) / 100);
      return [c.acno, { category, minPct, overdue, minRecovery }];
    }),
  );
}
