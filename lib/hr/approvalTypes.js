// lib/hr/approvalTypes.js — HR documents that go through Approvals.
//
// They are kept in the same ApprovalRequest table as held vouchers (kind "hr")
// and show in the same inbox (/dashboard/approvals), but who decides them is a
// permission, not an approval rule: anyone holding `permission` (Admin →
// Permissions) approves, and is notified. The work an approval does lives in
// lib/hr/approvals.js.
//
// Pure data — no imports — so lib/approvals/rules.js and the browser read it.

export const HR_KIND = "hr";

export const HR_APPROVAL_TYPES = {
  hrAttendance: {
    label: "Attendance correction",
    permission: "hr.attendance.approve",
    page: "/accounting/hr/attendance",
  },
  hrOffSwap: {
    label: "Off-day swap",
    permission: "hr.attendance.approve",
    page: "/accounting/hr/attendance?tab=swaps",
  },
  hrLeave: {
    label: "Leave request",
    permission: "hr.leave.approve",
    page: "/accounting/hr/leave",
  },
  hrSalary: {
    label: "Salary revision",
    permission: "hr.salary.approve",
    page: "/accounting/hr/salary",
  },
  hrLoan: {
    label: "Advance / loan",
    permission: "hr.loan.approve",
    page: "/accounting/hr/loans",
  },
  // Feature hr.pfLoans (lib/hr/loans/pf.js) — HrLoan of kind PF_LOAN / PF_WDL
  hrPfLoan: {
    label: "Provident fund loan / withdrawal",
    permission: "hr.pfloan.approve",
    page: "/accounting/hr/loans",
  },
  hrPayroll: {
    label: "Payroll",
    permission: "hr.payroll.approve",
    page: "/accounting/hr/payroll",
  },
  // Feature hr.leavingProcess (lib/hr/leaving/*)
  hrSeparation: {
    label: "Resignation / termination",
    permission: "hr.leaving.approve",
    page: "/accounting/hr/leaving",
  },
  hrSettlement: {
    label: "Final settlement",
    permission: "hr.settlement.approve",
    page: "/accounting/hr/leaving",
  },
};

export const isHrType = (docType) => Object.prototype.hasOwnProperty.call(HR_APPROVAL_TYPES, docType);
