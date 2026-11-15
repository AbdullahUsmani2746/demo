// scripts/demo/features/hrPayroll.mjs — HR payroll additions (prisma/sql/2026-11-21_hr_payroll_additions.sql),
// run from scripts/demo/test-features.mjs (which owns login, set() and the final feature reset).
// Written per the owner's instruction but NOT yet run.
//   A. switches OFF: every new route refuses (403), reports refused
//   B. switches ON: routes answer; bank formats validate and save
//   C. pure arithmetic: gratuity, PF shares, bank file layout
//   D. leaving: request → Approvals request exists; settlement needs approval first
import { gratuityFor, pfShares, serviceMonths } from "../../../lib/hr/benefits.js";
import { buildBankFile, cleanBankFormats, formatAmount, formatDate, toCsv } from "../../../lib/hr/payroll/bankFile.js";

const HR_ON = { "hr.bankDisbursement": true, "hr.payHistory": true, "hr.taxCertificate": true, "hr.providentFund": true, "hr.gratuity": true, "hr.leavingProcess": true };
const HR_OFF = Object.fromEntries(Object.keys(HR_ON).map((k) => [k, false]));

export async function runHrPayroll({ admin, set, check, prisma }) {
  const emp = await prisma.employee.findFirst({ where: { status: "ACTIVE" }, orderBy: { id: "asc" } });
  const run = await prisma.hrPayrollRun.findFirst({ where: { status: { in: ["APPROVED", "POSTED"] } }, orderBy: { id: "desc" } });

  // ── A. off ────────────────────────────────────────────────────────────────
  await set(HR_OFF);
  const offRoutes = [
    "/api/hr/payroll/bank-formats",
    "/api/hr/tax-certificate",
    "/api/hr/leaving",
    ...(emp ? [`/api/hr/pay-history/${emp.id}`] : []),
    ...(run ? [`/api/hr/payroll/${run.id}/bank-files`] : []),
  ];
  for (const p of offRoutes) check(`hr off: GET ${p} refused`, (await admin("GET", p)).status === 403);
  for (const k of ["hrPayHistory", "hrPfLedger", "hrGratuityProvision"]) check(`hr off: report ${k} refused`, (await admin("GET", `/api/reports/${k}`)).status === 403);

  // ── B. on ─────────────────────────────────────────────────────────────────
  await set(HR_ON);
  for (const p of offRoutes) check(`hr on: GET ${p}`, (await admin("GET", p)).status === 200);
  for (const k of ["hrPayHistory", "hrPfLedger", "hrGratuityProvision"]) check(`hr on: report ${k}`, (await admin("GET", `/api/reports/${k}`)).status === 200);
  const bad = await admin("PUT", "/api/hr/payroll/bank-formats", { formats: [{ name: "X", columns: [{ field: "name", header: "N" }] }] });
  check("bank formats: a layout without the amount is refused", bad.status === 400);
  const before = (await admin("GET", "/api/hr/payroll/bank-formats")).body?.formats;
  const ok = await admin("PUT", "/api/hr/payroll/bank-formats", before);
  check("bank formats: saved back unchanged", ok.status === 200);
  const settings = await admin("GET", "/api/hr/settings");
  check("settings: PF % keeps decimals", settings.body?.settings?.pfEmployeePercent === 8.33);

  // ── C. arithmetic ────────────────────────────────────────────────────────
  const S = { gratuityBaseGross: 0, gratuityMonthDays: 30, gratuityDaysPerYear: 30, gratuityMinServiceMonths: 12, gratuityPartYear: 2, pfEmployeePercent: 10, pfEmployerPercent: 5 };
  check("service months 2020-01-15 → 2026-01-14 = 71", serviceMonths("2020-01-15", "2026-01-14") === 71);
  const g = gratuityFor({ hireDate: "2020-01-01", asOf: "2025-12-31", basic: 60000, gross: 90000, settings: S });
  check("gratuity: 5 completed years × 30 days of basic = 300,000", g.amount === 300000 && g.eligible, JSON.stringify(g));
  const g2 = gratuityFor({ hireDate: "2025-06-01", asOf: "2025-12-31", basic: 60000, gross: 90000, settings: S });
  check("gratuity: under the minimum service is not payable", g2.payable === 0 && !g2.eligible);
  const pf = pfShares(50000, S);
  check("PF shares 10% / 5% of 50,000", pf.employee === 5000 && pf.employer === 2500);
  const fmts = cleanBankFormats({ formats: [{ id: "a", name: "A", delimiter: ";", header: false, date_format: "DDMMYYYY", amount_format: "paisa", columns: [{ field: "iban", header: "" }, { field: "amount", header: "" }, { field: "date", header: "" }, { field: "fixed", header: "", value: "SAL" }] }] });
  const file = buildBankFile(fmts.formats[0], [{ emp_id: 1, account: "PK12 3456-78", amount: 1234.5 }], { date: "2026-11-30", runId: 9 });
  check("bank file layout", toCsv(file, ";") === "PK12345678;123450;30112026;SAL", toCsv(file, ";"));
  check("formatDate / formatAmount", formatDate("2026-01-05", "DD-MMM-YYYY") === "05-JAN-2026" && formatAmount(1234.5, "#,##0.00") === "1,234.50");

  // ── D. leaving ───────────────────────────────────────────────────────────
  if (emp) {
    const today = new Date().toISOString().slice(0, 10);
    const r = await admin("POST", "/api/hr/leaving", { employee_id: emp.id, kind: "RESIGNATION", notice_date: today, last_working_day: today, reason: "TEST" });
    check("leaving: request filed", r.status === 201, JSON.stringify(r.body));
    if (r.status === 201) {
      const sep = await prisma.hrSeparation.findUnique({ where: { id: r.body.id } });
      check("leaving: Approvals request (hrSeparation) exists", Boolean(sep?.approval_request_id));
      const calc = await admin("POST", `/api/hr/leaving/${r.body.id}`, { action: "calculate", inputs: {} });
      check("leaving: settlement refused before approval", calc.status === 409);
      // Clean up: withdraw the request and drop the test separation.
      await prisma.approvalRequest.updateMany({ where: { id: sep.approval_request_id }, data: { status: "cancelled" } });
      await prisma.hrSeparation.update({ where: { id: sep.id }, data: { status: "cancelled" } });
    }
  }
  await set(HR_OFF);
}
