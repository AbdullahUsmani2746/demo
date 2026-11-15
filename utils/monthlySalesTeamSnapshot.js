// utils/monthlySalesTeamSnapshot.js
//
// Computes and LOCKS two month-end figures per customer into
// CustomerMonthlyTarget:
//
//   lockedTargetRecovery — cash collected in the month (Receipt credits)
//   lockedOverdue        — balance still owed past credit terms on the last
//                          day of the month
//
// They measure different things — money in versus debt out — and are locked
// together so the month-end MIS stays reproducible after later receipts land. Run via cron (see instrumentation.js)
// on the 1st of the month for the month that just ended, or manually via the
// "Run Month-End Calculation" button on the Sales Targets page (any month).
//
// Target Qty is user-entered and never touched here. Target Recovery is set by
// the system (lib/salesTargets/autoTarget.js) and re-set for every customer
// just before locking, so the locked month carries its final targets.
// Running again for a month already locked re-locks it with fresh figures
// (only holders of salesTarget.monthEnd may do it by hand — run-snapshot route).
import prisma from "@/lib/prisma";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { getCustomerOverdueTotals } from "@/lib/reports/customerAging";
import { syncTargetRecovery } from "@/lib/salesTargets/autoTarget";

export async function calculateAndStoreMonthlySalesTeamActuals(month, year) {
  const dated = new Date(year, month - 1, 1);
  const start = dated;
  const end = new Date(year, month, 0, 23, 59, 59, 999); // last day of `month`
  // Final Target Recovery for every customer, locked rows included
  await syncTargetRecovery({ year, month, includeLocked: true });

  // Receipt (tran_code=1): the customer is Transactions.acno on the
  // sub_tran_id=1 row (that row credits the party), per CLAUDE.md's Receipt
  // rule - confirmed against real data.
  const receiptRows = await prisma.$queryRaw`
    SELECT
      t.acno,
      COALESCE(SUM(COALESCE(t.camt, 0)), 0)::float8 AS locked_target_recovery
    FROM "TRANSACTIONS_MASTER" tm
    INNER JOIN "Transactions" t ON t.tran_id = tm.tran_id
    WHERE tm.tran_code = 1
      AND t.sub_tran_id = 1
      AND t.acno IS NOT NULL
      AND tm.dated >= ${start}
      AND tm.dated <= ${end}
    GROUP BY t.acno
  `;

  // Every customer, not only those with receipts: the overdue balance is a
  // position, so a customer who paid nothing this month still has one — and
  // is exactly the customer worth locking a figure against.
  const allCustomers = await prisma.aCNO.findMany({
    where: { macno: { in: await getCustomerMacnos() } },
    select: { acno: true },
  });
  const customerAcnoSet = new Set(allCustomers.map((c) => c.acno));
  const allAcnos = allCustomers.map((c) => c.acno);

  // Overdue BALANCE as at the last day of the month, from the same helper the
  // Sales Team MIS and the Customer Aging Report use, so the locked figure
  // and the live one are the same calculation — one just stops moving.
  const overdueRows = await getCustomerOverdueTotals({
    acnos: allAcnos,
    asOfDate: end,
  });
  const overdueByAcno = new Map(
    overdueRows.map((r) => [Number(r.acno), Number(r.overdueAmount) || 0]),
  );

  const recoveryByAcno = new Map();
  for (const row of receiptRows) {
    const acno = Number(row.acno);
    if (customerAcnoSet.has(acno)) {
      recoveryByAcno.set(acno, Number(row.locked_target_recovery) || 0);
    }
  }

  // A row is worth locking when there is either cash in or debt outstanding.
  const acnosToLock = [
    ...new Set([
      ...recoveryByAcno.keys(),
      ...[...overdueByAcno.entries()].filter(([, v]) => v !== 0).map(([k]) => k),
    ]),
  ];

  const results = [];
  const lockedAt = new Date();

  for (const acno of acnosToLock) {
    const data = {
      lockedTargetRecovery: recoveryByAcno.get(acno) || 0,
      lockedOverdue: overdueByAcno.get(acno) || 0,
      lockedAt,
    };

    const saved = await prisma.customerMonthlyTarget.upsert({
      where: { acno_dated: { acno, dated } },
      update: data,
      create: { acno, dated, ...data },
    });
    results.push(saved);
  }

  return results;
}
