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
};

/** Rights that show other people's HR data (dashboard, reports, profiles) — not the "own" ones. */
export const HR_TEAM_PERMS = [
  HR_PERMS.view, HR_PERMS.mark, HR_PERMS.approve,
  HR_PERMS.leaveView, HR_PERMS.leaveManage, HR_PERMS.leaveApprove,
  HR_PERMS.salaryView, HR_PERMS.salaryManage, HR_PERMS.salaryApprove,
  HR_PERMS.loanView, HR_PERMS.loanManage, HR_PERMS.loanApprove,
  HR_PERMS.payrollView, HR_PERMS.payrollManage, HR_PERMS.payrollApprove, HR_PERMS.payrollPost,
  HR_PERMS.loanDisburse, HR_PERMS.payrollPay, HR_PERMS.team,
];

/** Every HR right of this session as booleans — for the screens to show / hide actions. */
export async function hrRights(session) {
  const entries = await Promise.all(Object.entries(HR_PERMS).map(async ([k, code]) => [k, await can(session, code)]));
  const r = Object.fromEntries(entries);
  // Marking or approving implies seeing.
  r.view = r.view || r.mark || r.approve;
  r.leaveView = r.leaveView || r.leaveManage || r.leaveApprove;
  r.salaryView = r.salaryView || r.salaryManage || r.salaryApprove;
  r.loanView = r.loanView || r.loanManage || r.loanApprove || r.loanDisburse;
  r.payrollView = r.payrollView || r.payrollManage || r.payrollApprove || r.payrollPost || r.payrollPay;
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

/** Prisma `where` on Employee: the employees this session works with ({} = all). */
export async function employeeScopeWhere(session) {
  if (!session?.user?.id) return { id: { in: [] } };
  if (hasFullAccess(session)) return {};
  const scopes = await Promise.all(HR_SCOPE_DIMENSIONS.map((d) => scopeFor(session, d)));
  const and = HR_SCOPE_DIMENSIONS.flatMap((d, i) => (isUnrestricted(scopes[i]) ? [] : [{ [SCOPE_FIELD[d]]: { in: ints(scopes[i].values) } }]));
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
  if (Number.isInteger(dept) && dept > 0) and.push({ departmentId: dept });
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
};

export async function getHrSettings() {
  const defs = Object.entries(HR_SETTINGS);
  const rows = await prisma.settings.findMany({ where: { key: { in: defs.map(([, d]) => d.key) } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    defs.map(([name, d]) => {
      const n = Number(byKey.get(d.key));
      return [name, Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, Math.round(n))) : d.default];
    }),
  );
}

export async function saveHrSettings(values) {
  for (const [name, d] of Object.entries(HR_SETTINGS)) {
    if (values?.[name] === undefined) continue;
    const n = Math.round(Number(values[name]));
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
