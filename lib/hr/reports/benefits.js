// lib/hr/reports/benefits.js — rows of the pay history, provident fund and
// gratuity reports (catalog keys payHistory, pfLedger, gratuityProvision).
// Merged into RUNNERS by lib/hr/reports/run.js; each report is refused while
// its feature is off (lib/reports/hr.js). Posted payroll and posted final
// settlements only — what is in the books.
import prisma from "@/lib/prisma";
import { employeeName } from "@/lib/hr/access";
import { gratuityFor } from "@/lib/hr/benefits";
import { salaryOn, totalsOf } from "@/lib/hr/salary/service";
import { monthLabel } from "@/lib/hr/payroll/post";
import { dayKeyOfDb, monthRange } from "@/lib/hr/time";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const SELECT = { id: true, firstName: true, middleName: true, surname: true, hireDate: true, dor: true, status: true, department: { select: { dept_name: true } } };
const who = (e) => ({ emp_id: e.id, name: employeeName(e), department: e.department?.dept_name ?? "" });
const monthStart = (m) => new Date(`${m}-01T00:00:00.000Z`);
const monthEnd = (m) => new Date(`${monthRange(m).to}T00:00:00.000Z`);

export const BENEFIT_RUNNERS = {
  async payHistory({ employeeWhere, p }) {
    const slips = await prisma.hrPayslip.findMany({
      where: { month: { gte: p.fromMonth, lte: p.toMonth }, run: { status: "POSTED" }, employee: employeeWhere },
      include: { employee: { select: SELECT } },
      orderBy: [{ employee_id: "asc" }, { month: "asc" }],
    });
    return {
      rows: slips.map((s) => ({
        ...who(s.employee),
        month: monthLabel(s.month),
        run: `P-${s.run_id}`,
        paid_days: s.paid_days,
        gross: r2(s.data?.salary?.gross),
        earnings: r2(s.total_earnings),
        tax: r2(s.income_tax),
        eobi: r2(s.eobi_employee),
        pf: r2(s.pf_employee),
        loans: r2((s.data?.loans ?? []).reduce((t, l) => t + (Number(l.amount) || 0), 0)),
        deductions: r2(s.total_deductions),
        net: r2(s.net),
      })),
      subtitle: `${monthLabel(p.fromMonth)} → ${monthLabel(p.toMonth)} · posted payroll`,
    };
  },

  async pfLedger({ employeeWhere, p }) {
    const [before, inRange, settled, pfLoans] = await Promise.all([
      prisma.hrPayslip.groupBy({
        by: ["employee_id"],
        where: { month: { lt: p.fromMonth }, run: { status: "POSTED" }, employee: employeeWhere },
        _sum: { pf_employee: true, pf_employer: true },
      }),
      prisma.hrPayslip.groupBy({
        by: ["employee_id"],
        where: { month: { gte: p.fromMonth, lte: p.toMonth }, run: { status: "POSTED" }, employee: employeeWhere },
        _sum: { pf_employee: true, pf_employer: true },
      }),
      prisma.hrSettlement.findMany({
        where: { status: "POSTED", dor: { lte: monthEnd(p.toMonth) }, employee: employeeWhere },
        select: { employee_id: true, dor: true, data: true },
      }),
      // PF loans / withdrawals paid out (feature hr.pfLoans, lib/hr/loans/pf.js)
      prisma.hrLoan.findMany({
        where: { kind: { in: ["PF_LOAN", "PF_WDL"] }, disbursed_on: { not: null, lte: monthEnd(p.toMonth) }, employee: employeeWhere },
        select: { employee_id: true, kind: true, amount: true, disbursed_on: true, recoveries: { select: { amount: true, date: true } } },
      }),
    ]);
    const ids = [...new Set([...before, ...inRange, ...settled, ...pfLoans].map((x) => x.employee_id))];
    const emps = await prisma.employee.findMany({ where: { id: { in: ids } }, select: SELECT });
    const byId = new Map(emps.map((e) => [e.id, e]));
    const rows = new Map();
    const rowOf = (id) => {
      if (!rows.has(id)) rows.set(id, { ...who(byId.get(id) ?? { id }), opening: 0, employee: 0, employer: 0, withdrawn: 0, paid: 0, forfeited: 0, closing: 0, loan_paid: 0, loan_recovered: 0, loan_owed: 0 });
      return rows.get(id);
    };
    for (const b of before) rowOf(b.employee_id).opening = r2((b._sum.pf_employee || 0) + (b._sum.pf_employer || 0));
    for (const b of inRange) {
      const r = rowOf(b.employee_id);
      r.employee = r2(b._sum.pf_employee || 0);
      r.employer = r2(b._sum.pf_employer || 0);
    }
    const start = monthStart(p.fromMonth);
    for (const s of settled) {
      const r = rowOf(s.employee_id);
      const paid = r2(s.data?.pf?.paid);
      const forfeited = r2(s.data?.pf?.forfeited);
      if (s.dor < start) r.opening = r2(r.opening - paid - forfeited);
      else {
        r.paid = r2(r.paid + paid);
        r.forfeited = r2(r.forfeited + forfeited);
      }
    }
    // A withdrawal leaves the fund; a PF loan stays part of it (the fund lent it) —
    // shown as paid out / recovered / still owed beside the balance.
    const end = monthEnd(p.toMonth);
    for (const l of pfLoans) {
      const r = rowOf(l.employee_id);
      const inside = l.disbursed_on >= start;
      if (l.kind === "PF_WDL") {
        if (inside) r.withdrawn = r2(r.withdrawn + l.amount);
        else r.opening = r2(r.opening - l.amount);
        continue;
      }
      if (inside) r.loan_paid = r2(r.loan_paid + l.amount);
      let back = 0;
      for (const x of l.recoveries) {
        if (x.date > end) continue;
        back += x.amount;
        if (x.date >= start) r.loan_recovered = r2(r.loan_recovered + x.amount);
      }
      r.loan_owed = r2(r.loan_owed + Math.max(0, l.amount - back));
    }
    for (const r of rows.values()) r.closing = r2(r.opening + r.employee + r.employer - r.withdrawn - r.paid - r.forfeited);
    return {
      rows: [...rows.values()].filter((r) => r.opening || r.employee || r.employer || r.withdrawn || r.paid || r.closing || r.loan_paid || r.loan_recovered || r.loan_owed).sort((a, b) => a.emp_id - b.emp_id),
      subtitle: `${monthLabel(p.fromMonth)} → ${monthLabel(p.toMonth)} · posted payroll and settlements`,
    };
  },

  async gratuityProvision({ employeeWhere, p, settings }) {
    const end = monthRange(p.month).to;
    const endDate = new Date(`${end}T00:00:00.000Z`);
    const emps = await prisma.employee.findMany({
      where: { AND: [employeeWhere, { hireDate: { lte: endDate } }, { OR: [{ dor: null }, { dor: { gt: endDate } }] }] },
      select: SELECT,
      orderBy: { id: "asc" },
    });
    const ids = emps.map((e) => e.id);
    const [structures, provided] = await Promise.all([
      salaryOn(ids, end),
      prisma.hrPayslip.groupBy({ by: ["employee_id"], where: { employee_id: { in: ids }, month: { lte: p.month }, run: { status: "POSTED" } }, _sum: { gratuity: true } }),
    ]);
    const providedOf = new Map(provided.map((g) => [g.employee_id, r2(g._sum.gratuity || 0)]));
    const rows = emps.map((e) => {
      const t = totalsOf(structures.get(e.id));
      const g = gratuityFor({ hireDate: dayKeyOfDb(e.hireDate), asOf: end, basic: t?.basic ?? 0, gross: t?.gross ?? 0, settings });
      const prov = providedOf.get(e.id) ?? 0;
      return { ...who(e), hired: dayKeyOfDb(e.hireDate), years: g.years, base: g.base, liability: g.amount, payable: g.payable, provided: prov, difference: r2(g.amount - prov) };
    });
    return {
      rows,
      subtitle: `As at ${end} · ${settings.gratuityDaysPerYear} days of ${settings.gratuityBaseGross ? "gross" : "basic"} per year, payable after ${settings.gratuityMinServiceMonths} months · ${settings.gratuityProvisionMonthly ? "provided monthly" : "paid at exit only"}`,
    };
  },
};
