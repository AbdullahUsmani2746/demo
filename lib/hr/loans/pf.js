// lib/hr/loans/pf.js — provident fund loans and withdrawals (feature hr.pfLoans,
// needs hr.providentFund). They are HrLoan rows of kind PF_LOAN / PF_WDL and run
// through the same machinery as advances and loans (lib/hr/loans/service.js):
//   PF_LOAN  refundable — paid out Dr PF Payable / Cr cash-bank, recovered by
//            payroll back to PF Payable (lib/hr/payroll/post.js)
//   PF_WDL   not refundable — paid out the same way, settled at once; it
//            reduces the member's fund for good
//
// A member's fund (what the PF ledger report shows as closing):
//   contributions (posted payslips, employee + employer)
//   − withdrawals paid out − paid / forfeited in a posted final settlement
// A PF loan still owed is part of the fund (the fund lent it), so it does not
// reduce the balance — it uses up the limit:
//   limit     = hr.pf.loan_limit_percent % × fund
//   available = limit − PF loans still owed − PF applications approved / waiting
//               but not yet paid out
import prisma from "@/lib/prisma";
import { getHrSettings } from "@/lib/hr/access";
import { feature } from "@/lib/features/server";
import { isPfKind, outstandingOf } from "@/lib/hr/loans/schedule";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const PF_KINDS = ["PF_LOAN", "PF_WDL"];

/** Both switches must be on for a new PF loan / withdrawal (and its approval / pay-out). */
export async function pfLoansOn() {
  const [pf, loans] = await Promise.all([feature("hr.providentFund"), feature("hr.pfLoans")]);
  return pf && loans;
}

export async function assertPfLoansOn(kind) {
  if (!isPfKind(kind)) return;
  if (!(await pfLoansOn())) {
    throw Object.assign(new Error("Provident fund loans and withdrawals are switched off (Settings → Features: Provident fund, Provident fund loans & withdrawals)."), { status: 403 });
  }
}

/** Withdrawals paid out per member (for the PF ledger and the final settlement). */
export async function pfWithdrawnBy(employeeIds, { from = null, to = null } = {}) {
  const rows = await prisma.hrLoan.findMany({
    where: {
      kind: "PF_WDL",
      disbursed_on: { not: null, ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
      ...(employeeIds ? { employee_id: { in: employeeIds } } : {}),
    },
    select: { employee_id: true, amount: true },
  });
  const out = new Map();
  for (const r of rows) out.set(r.employee_id, r2((out.get(r.employee_id) || 0) + r.amount));
  return out;
}

/**
 * The member's fund and how much more may be lent / withdrawn.
 * @returns {{ contributions, withdrawn, settled, fund, owed, committed, percent, limit, available }}
 */
export async function pfPosition(employeeId, { excludeLoanId = null } = {}) {
  const [settings, agg, settlements, pfRows] = await Promise.all([
    getHrSettings(),
    prisma.hrPayslip.aggregate({ where: { employee_id: employeeId, run: { status: "POSTED" } }, _sum: { pf_employee: true, pf_employer: true } }),
    prisma.hrSettlement.findMany({ where: { employee_id: employeeId, status: "POSTED" }, select: { data: true } }),
    prisma.hrLoan.findMany({
      where: { employee_id: employeeId, kind: { in: PF_KINDS }, status: { in: ["pending", "active", "settled"] }, ...(excludeLoanId ? { NOT: { id: excludeLoanId } } : {}) },
      include: { recoveries: { select: { amount: true } } },
    }),
  ]);
  const contributions = r2((agg._sum.pf_employee || 0) + (agg._sum.pf_employer || 0));
  const settled = r2(settlements.reduce((s, x) => s + (Number(x.data?.pf?.paid) || 0) + (Number(x.data?.pf?.forfeited) || 0), 0));
  let withdrawn = 0;
  let owed = 0;
  let committed = 0;
  for (const l of pfRows) {
    if (!l.disbursed_on) {
      if (l.status === "pending" || l.status === "active") committed += l.amount;
    } else if (l.kind === "PF_WDL") withdrawn += l.amount;
    else owed += outstandingOf(l, l.recoveries);
  }
  const fund = r2(Math.max(0, contributions - r2(withdrawn) - settled));
  const percent = settings.pfLoanLimitPercent;
  const limit = r2((fund * percent) / 100);
  return {
    contributions,
    withdrawn: r2(withdrawn),
    settled,
    fund,
    owed: r2(owed),
    committed: r2(committed),
    percent,
    limit,
    available: r2(Math.max(0, limit - owed - committed)),
    maxInstallments: settings.pfLoanMaxInstallments,
  };
}

/** Throws unless `amount` fits what is still available from the member's fund. */
export async function assertPfLimit(employeeId, amount, { excludeLoanId = null } = {}) {
  const p = await pfPosition(employeeId, { excludeLoanId });
  if (amount > p.available + 0.004) {
    const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
    throw Object.assign(
      new Error(
        `Above the provident fund limit: at most ${fmt(p.available)} is available — ${p.percent}% of the PF balance ${fmt(p.fund)}` +
          `${p.owed ? `, less ${fmt(p.owed)} PF loan still owed` : ""}${p.committed ? `, less ${fmt(p.committed)} approved / waiting` : ""}.`,
      ),
      { status: 400 },
    );
  }
  return p;
}
