// lib/hr/access.js — who may do what in HR, and which employees they see.
//
//   rights      the hr.* permission codes (Admin → Permissions, module "HR")
//   employees   WHICH employees a person works with, on every HR screen,
//               report and approval — the intersection of three data scopes
//               (Admin → Permissions → Person / Department, lib/auth/scopeDimensions.js):
//                 Departments (HR)     e.g. Production, Accounts
//                 Work locations (HR)  e.g. FACTORY (plant), HEAD OFFICE
//                 Employees (HR)       chosen people, or "Theirs" = their team
//               With none of the three recorded, a person holding
//               hr.scope.all (HR managers) sees everyone; anyone else sees
//               only their own team (lib/hr/team.js) — never "everyone by
//               accident". ADMIN / ACCOUNTANT always see everyone.
//   rules       HR settings kept in the Settings table (HR → Shifts → Rules)
import prisma from "@/lib/prisma";
import { can, ForbiddenError, hasFullAccess } from "@/lib/auth/permissions";
import { hasScopeRule, isUnrestricted, scopeFor } from "@/lib/auth/scope";
import { sessionEmployeeId, sessionTeamIds } from "@/lib/hr/team";
import { feature } from "@/lib/features/server";

export { sessionEmployeeId };

export const HR_PERMS = {
  view: "hr.attendance.view",
  mark: "hr.attendance.mark",
  approve: "hr.attendance.approve",
  import: "hr.attendance.import",
  attendanceOwn: "hr.attendance.own",
  devices: "hr.devices.manage",
  shifts: "hr.shifts.manage",
  holidays: "hr.holidays.manage",
  leaveApply: "hr.leave.apply",
  leaveView: "hr.leave.view",
  leaveManage: "hr.leave.manage",
  leaveApprove: "hr.leave.approve",
  salaryView: "hr.salary.view",
  salaryManage: "hr.salary.manage",
  salaryApprove: "hr.salary.approve",
  loanApply: "hr.loan.apply",
  loanView: "hr.loan.view",
  loanManage: "hr.loan.manage",
  loanApprove: "hr.loan.approve",
  payrollView: "hr.payroll.view",
  payrollManage: "hr.payroll.manage",
  payrollApprove: "hr.payroll.approve",
  payrollPost: "hr.payroll.post",
  payslipOwn: "hr.payslip.own",
  team: "hr.team.manage",
  scopeAll: "hr.scope.all",
  loanDisburse: "hr.loan.disburse",
  payrollPay: "hr.payroll.pay",
  // prisma/sql/2026-11-21_hr_payroll_additions.sql (each flow behind its feature)
  bankFile: "hr.payroll.bankfile",
  leavingApply: "hr.leaving.apply",
  leavingManage: "hr.leaving.manage",
  leavingApprove: "hr.leaving.approve",
  settlementManage: "hr.settlement.manage",
  settlementApprove: "hr.settlement.approve",
  settlementPost: "hr.settlement.post",
  // prisma/sql/2026-11-21_hr_pf_loans.sql (feature hr.pfLoans)
  pfLoanApprove: "hr.pfloan.approve",
  // HR letters (lib/hr/letters/*, prisma/sql/2026-11-27_hr_letters.sql)
  lettersIssue: "hr.letters.issue",
  lettersTemplates: "hr.letters.templates",
};

/** Rights that show other people's HR data (dashboard, reports, profiles) — not the "own" ones. */
export const HR_TEAM_PERMS = [
  HR_PERMS.view, HR_PERMS.mark, HR_PERMS.approve,
  HR_PERMS.leaveView, HR_PERMS.leaveManage, HR_PERMS.leaveApprove,
  HR_PERMS.salaryView, HR_PERMS.salaryManage, HR_PERMS.salaryApprove,
  HR_PERMS.loanView, HR_PERMS.loanManage, HR_PERMS.loanApprove,
  HR_PERMS.payrollView, HR_PERMS.payrollManage, HR_PERMS.payrollApprove, HR_PERMS.payrollPost,
  HR_PERMS.loanDisburse, HR_PERMS.payrollPay, HR_PERMS.team,
  HR_PERMS.bankFile, HR_PERMS.leavingManage, HR_PERMS.leavingApprove,
  HR_PERMS.settlementManage, HR_PERMS.settlementApprove, HR_PERMS.settlementPost,
  HR_PERMS.pfLoanApprove, HR_PERMS.lettersIssue,
];

/** Every HR right of this session as booleans — for the screens to show / hide actions. */
export async function hrRights(session) {
  const entries = await Promise.all(Object.entries(HR_PERMS).map(async ([k, code]) => [k, await can(session, code)]));
  const r = Object.fromEntries(entries);
  // Marking or approving implies seeing.
  r.view = r.view || r.mark || r.approve;
  r.leaveView = r.leaveView || r.leaveManage || r.leaveApprove;
  r.salaryView = r.salaryView || r.salaryManage || r.salaryApprove;
  r.loanView = r.loanView || r.loanManage || r.loanApprove || r.loanDisburse || r.pfLoanApprove;
  r.payrollView = r.payrollView || r.payrollManage || r.payrollApprove || r.payrollPost || r.payrollPay;
  r.leavingView = r.leavingManage || r.leavingApprove || r.settlementManage || r.settlementApprove || r.settlementPost;
  r.settlementView = r.settlementManage || r.settlementApprove || r.settlementPost;
  return r;
}

/** Throws 403 unless the session holds at least one of the codes. */
export async function requireAnyHr(session, codes) {
  for (const code of codes) if (await can(session, code)) return;
  throw new ForbiddenError("You do not have access to this HR screen.", codes[0]);
}

export const HR_SCOPE_DIMENSIONS = ["department", "workLocation", "hrTeam"];
const SCOPE_FIELD = { department: "departmentId", workLocation: "workLocationId", hrTeam: "id" };
const ints = (values) => values.map(Number).filter(Number.isFinite);

/**
 * Employees of these departments: the main one (departmentId) OR an "also
 * works in" one (EmployeeDepartment, Employee → Job). Used by the HR scope
 * and the HR screens' department filter; payroll, salary cost and reports
 * stay on the main department. The "also works in" ones count only while
 * Settings → Features hr.extraDepartments is on; off = the main one only.
 */
export async function inDepartments(ids) {
  const list = ints(ids);
  if (!(await feature("hr.extraDepartments"))) return { departmentId: { in: list } };
  return { OR: [{ departmentId: { in: list } }, { extraDepartments: { some: { department_id: { in: list } } } }] };
}
const scopeWhere = async (dim, values) => (dim === "department" ? inDepartments(values) : { [SCOPE_FIELD[dim]]: { in: ints(values) } });

/** Prisma `where` on Employee: the employees this session works with ({} = all). */
export async function employeeScopeWhere(session) {
  if (!session?.user?.id) return { id: { in: [] } };
  if (hasFullAccess(session)) return {};
  const scopes = await Promise.all(HR_SCOPE_DIMENSIONS.map((d) => scopeFor(session, d)));
  const and = await Promise.all(
    HR_SCOPE_DIMENSIONS.flatMap((d, i) => (isUnrestricted(scopes[i]) ? [] : [scopeWhere(d, scopes[i].values)])),
  );
  if (and.length) return { AND: and };
  // All three unrestricted: is that a recorded "All", or nothing recorded?
  const recorded = (await Promise.all(HR_SCOPE_DIMENSIONS.map((d) => hasScopeRule(session, d)))).some(Boolean);
  if (recorded || (await can(session, HR_PERMS.scopeAll))) return {};
  return { id: { in: await sessionTeamIds(session) } };
}

/**
 * Employee `where` for a screen's filters (?department=, ?location=, ?q= name
 * or id), always inside the employees the session works with.
 */
export async function employeeFilter(session, searchParams) {
  const and = [await employeeScopeWhere(session)];
  const dept = Number(searchParams.get("department"));
  if (Number.isInteger(dept) && dept > 0) and.push(await inDepartments([dept]));
  const location = Number(searchParams.get("location"));
  if (Number.isInteger(location) && location > 0) and.push({ workLocationId: location });
  const q = String(searchParams.get("q") ?? "").trim();
  if (q) {
    const or = q.split(/\s+/).map((w) => ({
      OR: [
        { firstName: { contains: w, mode: "insensitive" } },
        { middleName: { contains: w, mode: "insensitive" } },
        { surname: { contains: w, mode: "insensitive" } },
      ],
    }));
    and.push(/^\d+$/.test(q) ? { OR: [{ id: Number(q) }, { attendanceId: q }] } : { AND: or });
  }
  return { AND: and };
}

/** Throws 403 when any of these employees is outside the session's departments. */
export async function assertEmployeesInScope(session, employeeIds) {
  const ids = [...new Set(employeeIds.map(Number))];
  const where = await employeeScopeWhere(session);
  const found = await prisma.employee.count({ where: { AND: [{ id: { in: ids } }, where] } });
  if (found !== ids.length) {
    throw new ForbiddenError("One or more employees are outside the employees you may work with (your departments, locations or team).");
  }
}

// ── Rules (Settings table) ──────────────────────────────────────────────────
export const HR_SETTINGS = {
  // New employee numbers continue the regular series below this number; numbers
  // given above it (e.g. 10001…) never push the next one up (lib/employees.js).
  // 0 (the default) = no series: the highest number + 1, as before.
  employeeNoSeriesEnd: { key: "hr.employee_no.series_end", default: 0, min: 0, max: 100000000, label: "New employee numbers stay below (0 = no limit)" },
  directEditDays: { key: "hr.attendance.direct_edit_days", default: 2, min: 1, max: 60, label: "Days back attendance may be changed without approval (1 = today only)" },
  leaveYearStartMonth: { key: "hr.leave.year_start_month", default: 1, min: 1, max: 12, label: "Month the leave year starts (1 = January, 7 = July)" },
  loanMaxInstallments: { key: "hr.loan.max_installments", default: 24, min: 1, max: 120, label: "Most monthly instalments a loan may run" },
  advanceLimitPercent: { key: "hr.loan.advance_limit_percent", default: 50, min: 0, max: 1000, label: "An advance above this % of gross salary is flagged" },
  loanLimitMonths: { key: "hr.loan.loan_limit_months", default: 3, min: 0, max: 120, label: "A loan above this many months of gross salary is flagged" },
  payrollDaysDivisor: { key: "hr.payroll.days_divisor", default: 30, min: 0, max: 31, label: "A day's pay = monthly ÷ this (0 = days in the month)" },
  payNoAttendanceFull: { key: "hr.payroll.no_attendance_full", default: 1, min: 0, max: 1, label: "Nothing marked all month: 1 = pay the full month, 0 = absent" },
  otRatePercent: { key: "hr.ot.rate_percent", default: 200, min: 0, max: 500, label: "Overtime rate, % of the ordinary hourly rate (200 = double)" },
  otHoursPerDay: { key: "hr.ot.hours_per_day", default: 8, min: 1, max: 24, label: "Hours in a working day (for the hourly rate)" },
  otBaseGross: { key: "hr.ot.base_gross", default: 1, min: 0, max: 1, label: "Hourly rate from: 1 = gross salary, 0 = basic" },
  eobiMinWage: { key: "hr.eobi.min_wage", default: 40000, min: 0, max: 10000000, label: "Minimum wage EOBI is worked on (Rs a month)" },
  eobiEmployeePercent: { key: "hr.eobi.employee_percent", default: 1, min: 0, max: 100, label: "EOBI employee share, % of minimum wage" },
  eobiEmployerPercent: { key: "hr.eobi.employer_percent", default: 5, min: 0, max: 100, label: "EOBI employer share, % of minimum wage" },
  taxSurchargeThreshold: { key: "hr.tax.surcharge_threshold", default: 10000000, min: 0, max: 1000000000, label: "Income-tax surcharge applies above this yearly taxable income" },
  taxSurchargePercent: { key: "hr.tax.surcharge_percent", default: 9, min: 0, max: 100, label: "Income-tax surcharge, % of the tax" },
  taxYearStartMonth: { key: "hr.tax.year_start_month", default: 7, min: 1, max: 12, label: "Month the tax year starts (7 = July)" },
  // Provident fund (feature hr.providentFund)
  pfEmployeePercent: { key: "hr.pf.employee_percent", default: 8.33, min: 0, max: 100, decimals: 2, label: "Provident fund, employee share (%)" },
  pfEmployerPercent: { key: "hr.pf.employer_percent", default: 8.33, min: 0, max: 100, decimals: 2, label: "Provident fund, employer share (%)" },
  pfBaseGross: { key: "hr.pf.base_gross", default: 0, min: 0, max: 1, label: "Provident fund on: 1 = gross earned, 0 = basic earned" },
  pfEligibleMonths: { key: "hr.pf.eligible_months", default: 0, min: 0, max: 120, label: "Months of service before provident fund starts" },
  pfVestingMonths: { key: "hr.pf.vesting_months", default: 0, min: 0, max: 600, label: "Months of service before the employer share is paid out at exit" },
  // Provident fund loans / withdrawals (feature hr.pfLoans, lib/hr/loans/pf.js)
  pfLoanLimitPercent: { key: "hr.pf.loan_limit_percent", default: 80, min: 0, max: 100, label: "PF loan / withdrawal: at most this % of the employee's PF balance" },
  pfLoanMaxInstallments: { key: "hr.pf.loan_max_installments", default: 24, min: 1, max: 120, label: "Most monthly instalments a PF loan may run" },
  // Gratuity (feature hr.gratuity)
  gratuityBaseGross: { key: "hr.gratuity.base_gross", default: 0, min: 0, max: 1, label: "Gratuity on: 1 = last gross salary, 0 = last basic" },
  gratuityDaysPerYear: { key: "hr.gratuity.days_per_year", default: 30, min: 0, max: 365, label: "Gratuity: days of salary per year of service" },
  gratuityMonthDays: { key: "hr.gratuity.month_days", default: 30, min: 1, max: 31, label: "Gratuity: a day of salary = monthly ÷ this" },
  gratuityMinServiceMonths: { key: "hr.gratuity.min_service_months", default: 12, min: 0, max: 600, label: "Months of service before gratuity is payable" },
  gratuityPartYear: { key: "hr.gratuity.part_year", default: 0, min: 0, max: 2, label: "Part year: 0 = exact fraction, 1 = 6+ months counts as a year, 2 = completed years only" },
  gratuityProvisionMonthly: { key: "hr.gratuity.provision_monthly", default: 0, min: 0, max: 1, label: "Gratuity: 1 = provided every month in the payroll journal, 0 = paid at exit only" },
  // Leaving & final settlement (feature hr.leavingProcess)
  noticeDaysResignation: { key: "hr.leaving.notice_days", default: 30, min: 0, max: 365, label: "Notice days on resignation" },
  noticeDaysTermination: { key: "hr.leaving.notice_days_termination", default: 30, min: 0, max: 365, label: "Notice days on termination" },
  noticeRecovery: { key: "hr.leaving.notice_recovery", default: 1, min: 0, max: 1, label: "Resignation with short notice: 1 = recover the short days, 0 = no" },
  noticePayTermination: { key: "hr.leaving.notice_pay_termination", default: 1, min: 0, max: 1, label: "Termination with short notice: 1 = pay the short days, 0 = no" },
  leaveEncash: { key: "hr.settlement.leave_encash", default: 1, min: 0, max: 2, label: "Leave encashment at exit: 0 = none, 1 = on basic, 2 = on gross" },
  leaveEncashDivisor: { key: "hr.settlement.leave_encash_divisor", default: 30, min: 1, max: 31, label: "A day of leave encashed = monthly ÷ this" },
  leaveEncashMaxDays: { key: "hr.settlement.leave_encash_max_days", default: 0, min: 0, max: 365, label: "Most leave days encashed (0 = no limit)" },
};

const settingValue = (d, n) => {
  const f = 10 ** (d.decimals ?? 0);
  return Math.round(n * f) / f;
};

export async function getHrSettings() {
  const defs = Object.entries(HR_SETTINGS);
  const rows = await prisma.settings.findMany({ where: { key: { in: defs.map(([, d]) => d.key) } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    defs.map(([name, d]) => {
      const n = Number(byKey.get(d.key));
      return [name, Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, settingValue(d, n))) : d.default];
    }),
  );
}

export async function saveHrSettings(values) {
  for (const [name, d] of Object.entries(HR_SETTINGS)) {
    if (values?.[name] === undefined) continue;
    const n = settingValue(d, Number(values[name]));
    if (!Number.isFinite(n) || n < d.min || n > d.max) {
      throw Object.assign(new Error(`${d.label}: enter ${d.min}–${d.max}.`), { status: 400 });
    }
    await prisma.settings.upsert({
      where: { key: d.key },
      update: { value: String(n) },
      create: { key: d.key, value: String(n), description: `HR: ${d.label}` },
    });
  }
  return getHrSettings();
}

/** Users who ARE this employee (to stop anyone approving their own leave). */
export async function userIdsOfEmployee(employeeId) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { emailAddress: true } });
  const users = await prisma.user.findMany({
    where: { OR: [{ employeeId }, ...(emp?.emailAddress ? [{ email: emp.emailAddress }] : [])] },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** "Ali Raza Khan" from an employee row. */
export const employeeName = (e) => [e?.firstName, e?.middleName, e?.surname].filter(Boolean).join(" ");
