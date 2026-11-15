// components/HR/payroll/payslipPdf.js — payslips as a PDF (one A4 page each).
// Browser only: jspdf + jspdf-autotable are loaded when a payslip is printed.

import { LOAN_KINDS } from "@/lib/hr/loans/schedule";

const money = (n) => (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRAND = [128, 0, 0];

function monthText(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function page(doc, autoTable, { company, month, slip }) {
  const d = slip.data;
  const e = slip.employee;
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(company?.name || "Payslip", 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (company?.address) doc.text(company.address, 14, 19, { maxWidth: W - 90 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`PAYSLIP — ${monthText(month).toUpperCase()}`, W - 14, 15, { align: "right" });

  doc.setTextColor(30, 41, 59);
  autoTable(doc, {
    startY: 32,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.2 },
    columnStyles: { 0: { textColor: [100, 116, 139], cellWidth: 32 }, 2: { textColor: [100, 116, 139], cellWidth: 32 } },
    body: [
      ["Employee", `${e.name} (#${e.id})`, "Department", e.department ?? "—"],
      ["Designation", e.designation ?? "—", "CNIC", e.cnic ?? "—"],
      ["Paid days", `${d.days.paid} of ${d.days.employed}`, "EOBI no.", e.eobi_no ?? "—"],
      ["Bank", d.bank?.bank ? `${d.bank.bank} · ${d.bank.account ?? ""}` : d.bank?.method ?? "—", "Salary (gross)", money(d.salary.gross)],
    ],
  });

  const earn = [["Basic salary", money(d.basic)]];
  for (const x of d.earnings) if (x.amount) earn.push([x.name, money(x.amount)]);
  if (d.overtime.amount) earn.push([`Overtime (${(d.overtime.minutes / 60).toFixed(1)} h)`, money(d.overtime.amount)]);
  for (const x of d.adjustments.filter((a) => a.kind === "EARNING")) earn.push([x.label, money(x.amount)]);
  const ded = [];
  for (const x of d.deductions) if (x.amount) ded.push([x.name, money(x.amount)]);
  if (d.eobi.employee) ded.push(["EOBI", money(d.eobi.employee)]);
  if (d.pf?.employee) ded.push(["Provident fund", money(d.pf.employee)]);
  if (d.tax.month) ded.push(["Income tax", money(d.tax.month)]);
  for (const l of d.loans) if (l.amount) ded.push([`${LOAN_KINDS[l.kind]?.short ?? "Loan"} #A-${l.loan_id}`, money(l.amount)]);
  for (const x of d.adjustments.filter((a) => a.kind === "DEDUCTION")) ded.push([x.label, money(x.amount)]);
  const rows = Math.max(earn.length, ded.length);
  const body = [];
  for (let i = 0; i < rows; i++) body.push([...(earn[i] ?? ["", ""]), ...(ded[i] ?? ["", ""])]);
  body.push([
    { content: "Total earnings", styles: { fontStyle: "bold" } },
    { content: money(slip.total_earnings), styles: { fontStyle: "bold" } },
    { content: "Total deductions", styles: { fontStyle: "bold" } },
    { content: money(slip.total_deductions), styles: { fontStyle: "bold" } },
  ]);
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    head: [["Earnings", "Rs", "Deductions", "Rs"]],
    body,
    theme: "grid",
    headStyles: { fillColor: BRAND, textColor: 255 },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 1: { halign: "right" }, 3: { halign: "right" } },
  });

  const y = doc.lastAutoTable.finalY + 8;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, y, W - 28, 16, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("NET PAY", 20, y + 10);
  doc.setTextColor(...BRAND);
  doc.text(`Rs ${money(slip.net)}`, W - 20, y + 10, { align: "right" });

  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const notes = [
    `Attendance: ${d.days.present} present · ${d.days.late} late · ${d.days.half} half · ${d.days.absent} absent · ${d.days.leave} leave (${d.days.unpaid_leave} unpaid) · ${d.days.late_cut} day(s) cut for lates`,
    d.tax.taxable ? `Income tax: taxable this month ${money(d.tax.taxable)} · projected for the year ${money(d.tax.projected)} · year's tax ${money(d.tax.annual)}` : null,
    "This is a computer-generated payslip and needs no signature.",
  ].filter(Boolean);
  notes.forEach((t, i) => doc.text(t, 14, y + 26 + i * 5, { maxWidth: W - 28 }));
}

/** Build and download payslips. `slips` = [{ employee, data, total_earnings, total_deductions, net }]. */
export async function downloadPayslips({ company, month, slips, fileName }) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  slips.forEach((slip, i) => {
    if (i) doc.addPage();
    page(doc, autoTable, { company, month, slip });
  });
  doc.save(fileName || `payslips-${month}.pdf`);
}
