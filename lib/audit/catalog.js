// lib/audit/catalog.js — how the audit trail names tables and groups rows.
//
//   AUDIT_LABELS   friendly name of a Prisma model ("TransactionsMaster" →
//                  "Vouchers"); any model not listed is shown humanised
//   AUDIT_PARENTS  a child row belongs to its parent document: a voucher line
//                  to its voucher, an order line to its order, a payslip to its
//                  payroll run … so "the history of voucher 143086" shows the
//                  header and every line change together (AuditLog.doc_model /
//                  doc_id)
//   AUDIT_IGNORED_FIELDS  bookkeeping columns: a change to only these is not a change
//   AUDIT_MODULES  models grouped by area, for filters
//
// Pure data — no imports — so the audit screen and the notification-alert
// builder read it too. A new document type with lines: one AUDIT_PARENTS entry.

export const AUDIT_LABELS = {
  TransactionsMaster: "Vouchers",
  FixedAsset: "Fixed assets",
  FixedAssetMovement: "Fixed asset movements",
  FixedAssetDepreciationRun: "Depreciation runs",
  FixedAssetDepreciationLine: "Depreciation lines",
  FixedAssetDisposal: "Fixed asset disposals",
  FaCategoryDefault: "Fixed asset category defaults",
  Transactions: "Voucher lines",
  OrderMaster: "Orders",
  OrderDetail: "Order lines",
  ACNO: "Accounts",
  MACNO: "Main accounts",
  Item: "Items",
  Godown: "Godowns",
  User: "Users",
  Employee: "Employees",
  Department: "Departments",
  Company: "Company",
  Settings: "Settings",
  BomMaster: "BOMs",
  BomDetail: "BOM lines",
  productionPlanMaster: "Process orders",
  productionPlanDetail: "Process order lines",
  productionPlanIssue: "Process order issues",
  productionPlanOutput: "Process order output",
  productionPlanChangeLog: "Process order changes",
  ProductionCostEntry: "Production cost entries",
  QualityMaster: "Quality checks",
  QualityDetail: "Quality check lines",
  QualityDetailDetail: "Quality check results",
  ReqMaster: "Requisitions",
  ReqDetail: "Requisition lines",
  SaleReturnRemark: "Sale return remarks",
  InvoiceKnockoff: "Invoice knock-offs",
  ServiceInvoiceLink: "Service invoice links",
  InvoiceKnockoffRun: "Knock-off runs",
  ApprovalRequest: "Approval requests",
  ApprovalRule: "Approval rules",
  PermissionGrant: "Permission grants",
  DataScope: "Data scopes",
  DepartmentScope: "Department scopes",
  PeriodLock: "Period locks",
  PeriodLockLog: "Period lock log",
  NotificationEvent: "Notification events",
  NotificationRule: "Notification recipients",
  NotificationAlert: "Notification alerts",
  menus: "Menus",
  employee_menu: "Employee menus",
  HrAttendance: "Attendance",
  HrPunch: "Attendance punches",
  HrShift: "Shifts",
  HrShiftAssignment: "Shift assignments",
  HrHoliday: "Holidays",
  HrDevice: "Attendance machines",
  HrLeaveType: "Leave types",
  HrLeaveBalance: "Leave balances",
  HrLeaveRequest: "Leave requests",
  HrPayComponent: "Pay components",
  HrSalaryStructure: "Salary structures",
  HrSalaryLine: "Salary lines",
  HrLoan: "Advances & loans",
  HrLoanRecovery: "Loan recoveries",
  HrLoanEvent: "Loan timeline",
  HrPayrollRun: "Payroll runs",
  HrPayslip: "Payslips",
  HrPayrollPayment: "Salary payments",
  HrTaxSlab: "Income-tax slabs",
};

// child model → [parent model, field on the child holding the parent's id]
export const AUDIT_PARENTS = {
  Transactions: ["TransactionsMaster", "tran_id"],
  FixedAssetMovement: ["FixedAsset", "asset_id"],
  FixedAssetDisposal: ["FixedAsset", "asset_id"],
  FixedAssetDepreciationLine: ["FixedAssetDepreciationRun", "run_id"],
  ServiceInvoiceLink: ["TransactionsMaster", "tran_id"],
  OrderDetail: ["OrderMaster", "order_no"],
  BomDetail: ["BomMaster", "bom_id"],
  productionPlanDetail: ["productionPlanMaster", "plan_id"],
  productionPlanIssue: ["productionPlanMaster", "plan_id"],
  productionPlanOutput: ["productionPlanMaster", "plan_id"],
  productionPlanChangeLog: ["productionPlanMaster", "plan_id"],
  ProductionCostEntry: ["productionPlanMaster", "plan_id"],
  QualityDetail: ["QualityMaster", "master_id"],
  QualityDetailDetail: ["QualityMaster", "master_id"],
  ReqDetail: ["ReqMaster", "tran_id"],
  SaleReturnRemark: ["TransactionsMaster", "tran_id"],
  InvoiceKnockoff: ["InvoiceKnockoffRun", "run_id"],
  employee_menu: ["Employee", "employee_id"],
  HrAttendance: ["Employee", "employee_id"],
  HrPunch: ["Employee", "employee_id"],
  HrShiftAssignment: ["Employee", "employee_id"],
  HrLeaveBalance: ["Employee", "employee_id"],
  HrLeaveRequest: ["Employee", "employee_id"],
  HrSalaryStructure: ["Employee", "employee_id"],
  HrLoan: ["Employee", "employee_id"],
  HrLoanRecovery: ["HrLoan", "loan_id"],
  HrLoanEvent: ["HrLoan", "loan_id"],
  HrPayslip: ["HrPayrollRun", "run_id"],
  HrPayrollPayment: ["HrPayrollRun", "run_id"],
};

export const AUDIT_IGNORED_FIELDS = new Set([
  "updated_at", "updatedAt", "updatedOn", "last_sync", "sync_status", "lastLogin", "last_login",
]);

export const AUDIT_MODULES = [
  { key: "finance", label: "Finance", models: ["TransactionsMaster", "Transactions", "ACNO", "MACNO", "InvoiceKnockoff", "InvoiceKnockoffRun", "PeriodLock", "PeriodLockLog"] },
  { key: "fixedAssets", label: "Fixed assets", models: ["FixedAsset", "FixedAssetMovement", "FixedAssetDepreciationRun", "FixedAssetDepreciationLine", "FixedAssetDisposal", "FaCategoryDefault"] },
  { key: "sales", label: "Orders", models: ["OrderMaster", "OrderDetail", "SaleReturnRemark"] },
  { key: "production", label: "Production & stock", models: ["Item", "Godown", "BomMaster", "BomDetail", "productionPlanMaster", "productionPlanDetail", "productionPlanIssue", "productionPlanOutput", "productionPlanChangeLog", "ProductionCostEntry", "QualityMaster", "QualityDetail", "QualityDetailDetail", "ReqMaster", "ReqDetail"] },
  { key: "hr", label: "HR & payroll", models: ["Employee", "HrAttendance", "HrPunch", "HrShift", "HrShiftAssignment", "HrHoliday", "HrDevice", "HrLeaveType", "HrLeaveBalance", "HrLeaveRequest", "HrPayComponent", "HrSalaryStructure", "HrSalaryLine", "HrLoan", "HrLoanRecovery", "HrLoanEvent", "HrPayrollRun", "HrPayslip", "HrPayrollPayment", "HrTaxSlab"] },
  { key: "admin", label: "Users & setup", models: ["User", "Department", "Company", "Settings", "ApprovalRequest", "ApprovalRule", "PermissionGrant", "DataScope", "DepartmentScope", "NotificationEvent", "NotificationRule", "NotificationAlert", "menus", "employee_menu"] },
];

/** "productionPlanMaster" → "Production Plan Master" when it has no label. */
export function auditLabel(model) {
  if (AUDIT_LABELS[model]) return AUDIT_LABELS[model];
  return String(model)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
