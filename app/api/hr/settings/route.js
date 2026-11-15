// /api/hr/settings — HR rules kept in Settings (lib/hr/access.js HR_SETTINGS).
//   GET  → { settings, defs }
//   PUT  { key: value, … }
//        attendance / leave rules   hr.shifts.manage
//        loan rules                 hr.shifts.manage or hr.loan.manage
//        payroll rules              hr.shifts.manage or hr.payroll.manage
//        leaving / settlement rules hr.shifts.manage, hr.payroll.manage or hr.leaving.manage
import { NextResponse } from "next/server";
import { getHrSettings, hrRights, saveHrSettings, HR_PERMS, HR_SETTINGS } from "@/lib/hr/access";
import { ForbiddenError } from "@/lib/auth/permissions";
import { hrRoute, jsonBody } from "@/lib/hr/route";

const defs = Object.fromEntries(Object.entries(HR_SETTINGS).map(([k, d]) => [k, { label: d.label, min: d.min, max: d.max, default: d.default, decimals: d.decimals ?? 0 }]));
const LOAN_KEYS = ["loanMaxInstallments", "advanceLimitPercent", "loanLimitMonths"];
const PAYROLL_KEYS = [
  "payrollDaysDivisor", "payNoAttendanceFull", "otRatePercent", "otHoursPerDay", "otBaseGross",
  "eobiMinWage", "eobiEmployeePercent", "eobiEmployerPercent", "taxSurchargeThreshold", "taxSurchargePercent", "taxYearStartMonth",
  "pfEmployeePercent", "pfEmployerPercent", "pfBaseGross", "pfEligibleMonths", "pfVestingMonths",
  "gratuityBaseGross", "gratuityDaysPerYear", "gratuityMonthDays", "gratuityMinServiceMonths", "gratuityPartYear", "gratuityProvisionMonthly",
];
const LEAVING_KEYS = [
  "noticeDaysResignation", "noticeDaysTermination", "noticeRecovery", "noticePayTermination",
  "leaveEncash", "leaveEncashDivisor", "leaveEncashMaxDays",
];

export const GET = hrRoute(Object.values(HR_PERMS), async () =>
  NextResponse.json({ settings: await getHrSettings(), defs }),
);

export const PUT = hrRoute([HR_PERMS.shifts, HR_PERMS.loanManage, HR_PERMS.payrollManage, HR_PERMS.leavingManage], async (req, { session }) => {
  const body = await jsonBody(req);
  const rights = await hrRights(session);
  for (const k of Object.keys(body)) {
    const allowed =
      rights.shifts ||
      (LOAN_KEYS.includes(k) && rights.loanManage) ||
      (PAYROLL_KEYS.includes(k) && rights.payrollManage) ||
      (LEAVING_KEYS.includes(k) && (rights.payrollManage || rights.leavingManage));
    if (!allowed) throw new ForbiddenError("You may not change this HR rule.", HR_PERMS.shifts);
  }
  const settings = await saveHrSettings(body);
  return NextResponse.json({ settings, message: "Rules saved." });
});
