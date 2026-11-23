// lib/hr/reports/catalog.js — the HR reports: what each one shows and who may run it.
// Client-safe (no Prisma): the report engine (components/Reports/config.js)
// builds one REPORT_CONFIG entry per report from this — key hrEngineKey(key),
// e.g. attendanceSummary → hrAttendanceSummary — and lib/hr/reports/run.js
// computes the rows (served through lib/reports/hr.js).
//
//   right    the hrRights() key that unlocks the report (lib/hr/access.js);
//            every report also stays inside the person's departments
//   feature  (optional) Settings → Features toggle the report belongs to —
//            refused by lib/reports/hr.js and hidden from the menu while off
//   filters  month | range (from / to) | monthRange (from / to months) | kind;
//            department, work location and search are always there
//   columns  type: text | int | num | money | minutes (shown as h:mm) | date;
//            total: summed in the last row

export const HR_REPORT_GROUPS = [
  { key: "attendance", label: "Attendance" },
  { key: "leave", label: "Leave" },
  { key: "pay", label: "Salary & payroll" },
  { key: "people", label: "People" },
];

export const HR_REPORTS = {
  attendanceDaily: {
    group: "attendance",
    title: "Daily attendance",
    description: "Every employee on one day: status, check-in / check-out, late, early, overtime and hours worked — the day's head count in the totals.",
    right: "view",
    filters: ["day"],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "shift", label: "Shift" },
      { key: "status", label: "Status" },
      { key: "check_in", label: "Check-in" },
      { key: "check_out", label: "Check-out" },
      { key: "present", label: "Present", type: "num", total: true },
      { key: "late", label: "Late", type: "num", total: true },
      { key: "half", label: "Half day", type: "num", total: true },
      { key: "absent", label: "Absent", type: "num", total: true },
      { key: "leave", label: "Leave", type: "num", total: true },
      { key: "off", label: "Off / holiday", type: "num", total: true },
      { key: "late_minutes", label: "Late time", type: "minutes", total: true },
      { key: "early_minutes", label: "Left early", type: "minutes", total: true },
      { key: "overtime", label: "Overtime", type: "minutes", total: true },
      { key: "worked", label: "Worked", type: "minutes", total: true },
      { key: "note", label: "Note" },
    ],
  },
  attendanceSummary: {
    group: "attendance",
    title: "Monthly attendance summary",
    description: "Every employee’s month: present, late, absent, leave, late cuts, overtime and paid days.",
    right: "view",
    filters: ["month"],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "shift", label: "Shift" },
      { key: "present", label: "Present", type: "num", total: true },
      { key: "late", label: "Late", type: "num", total: true },
      { key: "half", label: "Half day", type: "num", total: true },
      { key: "absent", label: "Absent", type: "num", total: true },
      { key: "leave", label: "Leave", type: "num", total: true },
      { key: "off", label: "Off / holiday", type: "num", total: true },
      { key: "late_minutes", label: "Late time", type: "minutes", total: true },
      { key: "late_cut", label: "Late cut (days)", type: "num", total: true },
      { key: "overtime", label: "Overtime", type: "minutes", total: true },
      { key: "worked", label: "Worked", type: "minutes", total: true },
      { key: "paid_days", label: "Paid days", type: "num", total: true },
    ],
  },
  attendanceExceptions: {
    group: "attendance",
    title: "Lates, absences & missed punches",
    description: "Day by day: who came late, left early, was absent or has only one punch.",
    right: "view",
    filters: ["range", "kind"],
    kinds: [
      { value: "all", label: "All exceptions" },
      { value: "late", label: "Late arrivals" },
      { value: "early", label: "Left early" },
      { value: "absent", label: "Absent" },
      { value: "half", label: "Half days" },
      { value: "review", label: "Missed punch" },
    ],
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "shift", label: "Shift" },
      { key: "status", label: "Status" },
      { key: "check_in", label: "In" },
      { key: "check_out", label: "Out" },
      { key: "late_minutes", label: "Late", type: "minutes", total: true },
      { key: "early_minutes", label: "Early", type: "minutes", total: true },
      { key: "note", label: "Note" },
    ],
  },
  overtime: {
    group: "attendance",
    title: "Overtime",
    description: "Overtime worked per employee over any period.",
    right: "view",
    filters: ["range"],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "days", label: "Days with overtime", type: "int", total: true },
      { key: "overtime", label: "Overtime", type: "minutes", total: true },
      { key: "worked", label: "Worked", type: "minutes", total: true },
    ],
  },
  leaveRegister: {
    group: "leave",
    title: "Leave register",
    description: "Leave applications in a period with their status.",
    right: "leaveView",
    filters: ["range", "kind"],
    kinds: [
      { value: "approved", label: "Approved" },
      { value: "pending", label: "Waiting" },
      { value: "all", label: "Any status" },
    ],
    columns: [
      { key: "id", label: "No", type: "text" },
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "type", label: "Leave" },
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
      { key: "days", label: "Days", type: "num", total: true },
      { key: "status", label: "Status" },
      { key: "reason", label: "Reason" },
    ],
  },
  leaveTaken: {
    group: "leave",
    title: "Leave taken by type",
    description: "Days of each leave type taken per employee in a period (from attendance).",
    right: "leaveView",
    filters: ["range"],
    columns: [], // one column per leave type — built by the runner
  },
  payrollSummary: {
    group: "pay",
    title: "Payroll by month",
    description: "Posted payroll month by month: earnings, tax, EOBI, recoveries and net pay.",
    right: "payrollView",
    filters: ["monthRange"],
    columns: [
      { key: "month", label: "Month" },
      { key: "employees", label: "Employees", type: "int" },
      { key: "earnings", label: "Total earnings", type: "money", total: true },
      { key: "overtime", label: "Overtime", type: "money", total: true },
      { key: "tax", label: "Income tax", type: "money", total: true },
      { key: "eobi", label: "EOBI (employee)", type: "money", total: true },
      { key: "loans", label: "Loans recovered", type: "money", total: true },
      { key: "deductions", label: "Total deductions", type: "money", total: true },
      { key: "net", label: "Net pay", type: "money", total: true },
      { key: "employer", label: "EOBI (employer)", type: "money", total: true },
    ],
  },
  payrollByDepartment: {
    group: "pay",
    title: "Payroll cost by department",
    description: "One posted month split by department.",
    right: "payrollView",
    filters: ["month"],
    columns: [
      { key: "department", label: "Department" },
      { key: "employees", label: "Employees", type: "int", total: true },
      { key: "earnings", label: "Total earnings", type: "money", total: true },
      { key: "overtime", label: "Overtime", type: "money", total: true },
      { key: "tax", label: "Income tax", type: "money", total: true },
      { key: "deductions", label: "Total deductions", type: "money", total: true },
      { key: "net", label: "Net pay", type: "money", total: true },
      { key: "cost", label: "Cost to company", type: "money", total: true },
    ],
  },
  incomeTax: {
    group: "pay",
    title: "Income tax deducted",
    description: "Tax deducted per employee in a fiscal year — for withholding statements.",
    right: "payrollView",
    filters: ["monthRange"],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "cnic", label: "CNIC" },
      { key: "months", label: "Months", type: "int" },
      { key: "taxable", label: "Taxable income", type: "money", total: true },
      { key: "tax", label: "Tax deducted", type: "money", total: true },
    ],
  },
  salaryRegister: {
    group: "pay",
    title: "Salary register",
    description: "Everyone’s current salary: basic, allowances, deductions, gross.",
    right: "salaryView",
    filters: [],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "designation", label: "Designation" },
      { key: "since", label: "Since", type: "date" },
      { key: "basic", label: "Basic", type: "money", total: true },
      { key: "allowances", label: "Allowances", type: "money", total: true },
      { key: "gross", label: "Gross", type: "money", total: true },
      { key: "deductions", label: "Fixed deductions", type: "money", total: true },
      { key: "net", label: "Net (before tax)", type: "money", total: true },
    ],
  },
  loansOutstanding: {
    group: "pay",
    title: "Advances & loans outstanding",
    description: "Every running advance and loan with what is recovered and still owed.",
    right: "loanView",
    filters: ["kind"],
    kinds: [
      { value: "active", label: "Running" },
      { value: "settled", label: "Settled" },
      { value: "all", label: "Running + settled" },
    ],
    columns: [
      { key: "id", label: "No" },
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "kind", label: "Kind" },
      { key: "disbursed", label: "Disbursed", type: "date" },
      { key: "amount", label: "Amount", type: "money", total: true },
      { key: "installment", label: "Instalment", type: "money" },
      { key: "recovered", label: "Recovered", type: "money", total: true },
      { key: "outstanding", label: "Outstanding", type: "money", total: true },
      { key: "status", label: "Status" },
    ],
  },
  payHistory: {
    group: "pay",
    title: "Pay history",
    description: "Every posted payslip of each employee, month by month: gross, earnings, tax, PF, loans, deductions, net.",
    right: "payrollView",
    feature: "hr.payHistory",
    filters: ["monthRange"],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "month", label: "Month" },
      { key: "run", label: "Payroll" },
      { key: "paid_days", label: "Paid days", type: "num" },
      { key: "gross", label: "Gross salary", type: "money" },
      { key: "earnings", label: "Earned", type: "money", total: true },
      { key: "tax", label: "Income tax", type: "money", total: true },
      { key: "eobi", label: "EOBI", type: "money", total: true },
      { key: "pf", label: "Provident fund", type: "money", total: true },
      { key: "loans", label: "Loans / advances", type: "money", total: true },
      { key: "deductions", label: "Total deductions", type: "money", total: true },
      { key: "net", label: "Net pay", type: "money", total: true },
    ],
  },
  pfLedger: {
    group: "pay",
    title: "Provident fund ledger",
    description: "Each member’s provident fund: opening, employee and employer shares, paid out at exit, closing balance.",
    right: "payrollView",
    feature: "hr.providentFund",
    filters: ["monthRange"],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "opening", label: "Opening", type: "money", total: true },
      { key: "employee", label: "Employee share", type: "money", total: true },
      { key: "employer", label: "Employer share", type: "money", total: true },
      // PF withdrawals / loans (feature hr.pfLoans) — columns stay empty while it is off
      { key: "withdrawn", label: "Withdrawn", type: "money", total: true },
      { key: "paid", label: "Paid out", type: "money", total: true },
      { key: "forfeited", label: "Forfeited", type: "money", total: true },
      { key: "closing", label: "Closing", type: "money", total: true },
      { key: "loan_paid", label: "PF loan given", type: "money", total: true },
      { key: "loan_recovered", label: "PF loan recovered", type: "money", total: true },
      { key: "loan_owed", label: "PF loan owed", type: "money", total: true },
    ],
  },
  gratuityProvision: {
    group: "pay",
    title: "Gratuity provision",
    description: "Gratuity earned by each employee at a month end against what the books hold (monthly provision).",
    right: "payrollView",
    feature: "hr.gratuity",
    filters: ["month"],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "hired", label: "Joined", type: "date" },
      { key: "years", label: "Years counted", type: "num" },
      { key: "base", label: "Salary base", type: "money" },
      { key: "liability", label: "Gratuity earned", type: "money", total: true },
      { key: "payable", label: "Payable if leaving", type: "money", total: true },
      { key: "provided", label: "Provided in books", type: "money", total: true },
      { key: "difference", label: "Not yet provided", type: "money", total: true },
    ],
  },
  headcount: {
    group: "people",
    title: "Employee list & turnover",
    description: "Staff on the books, or who joined / left in a period, with service length.",
    right: "any",
    filters: ["range", "kind"],
    kinds: [
      { value: "active", label: "On the books (to date)" },
      { value: "joined", label: "Joined in the period" },
      { value: "left", label: "Left in the period" },
    ],
    columns: [
      { key: "emp_id", label: "Emp No", type: "int" },
      { key: "name", label: "Name" },
      { key: "department", label: "Department" },
      { key: "designation", label: "Designation" },
      { key: "gender", label: "Gender" },
      { key: "hired", label: "Joined", type: "date" },
      { key: "left", label: "Left", type: "date" },
      { key: "service", label: "Service (years)", type: "num" },
      { key: "phone", label: "Phone" },
      { key: "cnic", label: "CNIC" },
    ],
  },
};

/** Does this rights object (hrRights) unlock the report? */
export function canRunReport(rights, key) {
  const r = HR_REPORTS[key];
  if (!r || !rights) return false;
  if (r.right === "any") return Boolean(rights.view || rights.leaveView || rights.salaryView || rights.loanView || rights.payrollView);
  return Boolean(rights[r.right]);
}

/** Report engine key of an HR report: attendanceSummary → hrAttendanceSummary. */
export const hrEngineKey = (key) => `hr${key[0].toUpperCase()}${key.slice(1)}`;

/** HR report key behind a report engine key, or null when it is not an HR report. */
export const hrReportKey = (engineKey) => Object.keys(HR_REPORTS).find((k) => hrEngineKey(k) === engineKey) ?? null;

/**
 * Catalog columns → report engine columns (ReportViewer): money → currency,
 * int / num → number, date → date, total → showTotal. Minutes become decimal
 * hours ("Late (h)") — lib/reports/hr.js converts the values to match — so
 * the totals and the Excel / PDF exports add up.
 */
export function engineColumns(columns) {
  return columns.map((c) => {
    const col = { field: c.key, headerName: c.type === "minutes" ? `${c.label} (h)` : c.label, width: c.key === "name" ? 28 : 16 };
    if (c.type === "money") col.type = "currency";
    else if (c.type === "date") col.type = "date";
    // Employee numbers are codes, not quantities — no thousands separator.
    else if (c.type && c.type !== "text" && c.key !== "emp_id") col.type = "number";
    if (c.total) col.showTotal = true;
    return col;
  });
}
